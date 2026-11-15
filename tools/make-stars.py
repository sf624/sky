#!/usr/bin/env python3
"""Build the star catalogue of index.html from Wikidata.

What it does
  Asks the Wikidata Query Service (https://query.wikidata.org/sparql) for every
  item with an apparent magnitude (P1215) in the V band (qualifier P1227 =
  Q4892529) of at most 6.5 and with right ascension and declination (P6257,
  P6258, degrees, J2000 in effect). It adds the B magnitude of the same items,
  and their classes (P31), keeps real stars only, merges double entries, and
  writes the catalogue in the format of index.html:

    6 bytes per star, little-endian, brightest first:
      RA   u16 = round(ra / 360 * 65536) mod 65536
      Dec  u16 = round((dec + 90) / 180 * 65535)
      V    u8  = round((V + 1.5) / 8 * 255)       (V clamped to -1.5 .. 6.5)
      B-V  u8  = round((B-V + 0.5) / 2.5 * 255)   (B-V clamped to -0.5 .. 2.0)
    The output is that byte string in base64.

The rule
  Every value comes from Wikidata (structured data, licence CC0:
  https://www.wikidata.org/wiki/Wikidata:Copyright). Nothing is copied from
  any other catalogue, and no star is added from another list. A star that
  Wikidata gives no V magnitude gets an ESTIMATE from its other bands on
  Wikidata (rules and tests below, "Estimated magnitudes"), marked in the
  table. A star without a B magnitude gets the median B-V of the catalogue.

How to run (standard library only; Python 3.8 or later)
    python3 tools/make-stars.py --cache wikidata-cache --index index.html
  --cache DIR   where the answers are kept (default wikidata-cache). A second
                run with the same cache needs no network. The first run sends
                one request a minute (about 70 requests, some of them slow).
  --index FILE  replace the base64 inside <script id="stars"> of that file.
  --out FILE    write the base64 there (default: print the summary only).
  --table FILE  write the chosen stars as CSV (qid, ra, dec, v, b, bv, ...).
  --offline     fail instead of using the network.
"""
import argparse, base64, collections, csv, hashlib, json, math, os, re, statistics, struct, sys, time
import urllib.parse, urllib.request

ENDPOINT = 'https://query.wikidata.org/sparql'
UA = 'star-catalogue-builder/1.0 (Wikidata SPARQL; one request per minute)'
V_BAND, B_BAND = 'Q4892529', 'Q6746395'

# ---- Decisions (made by reading the classes and statements of the items) ----
# An item is dropped when it is an instance of one of these: not a star.
NOT_STAR = {
    'Q11387': 'open cluster', 'Q168845': 'star cluster', 'Q11276': 'globular cluster',
    'Q650001': 'super star cluster', 'Q736194': 'stellar association', 'Q12046080': 'moving group',
    'Q9262': 'asterism', 'Q190438': 'dwarf galaxy', 'Q190397': 'irregular galaxy', 'Q318': 'galaxy',
    'Q2488': 'spiral galaxy', 'Q3272595': 'flocculent spiral galaxy', 'Q1491746': 'galaxy group',
    'Q204107': 'galaxy cluster', 'Q11282': 'H II region', 'Q203958': 'reflection nebula',
    'Q854857': 'diffuse nebula', 'Q207436': 'supernova remnant', 'Q3937': 'supernova',
    'Q582000': 'type Ia supernova', 'Q6458': 'nova', 'Q4366498': 'recurrent nova',
    'Q22247': 'gamma-ray burst', 'Q46587': 'active galactic nucleus', 'Q44559': 'exoplanet',
    'Q30014': 'outer planet', 'Q3504248': 'inner planet', 'Q3901935': 'inferior planet',
    'Q121750': 'gas giant', 'Q1319599': 'ice giant', 'Q6440': 'stellar kinematics',
}
# Items that carry a non-star class next to a star class, but are stars (their
# V, B and Gaia magnitudes agree, or the class is a mistake).
KEEP_ITEMS = {
    'Q5010398': 'CE Camelopardalis, a supergiant, also typed reflection nebula',
    'Q10848090': 'a star also typed active galactic nucleus',
    'Q3781695': 'a star also typed open cluster',
}
# Items dropped by hand: not a steady naked-eye star, or a wrong statement.
DROP_ITEMS = {
    'Q66477379': 'V statement is wrong (0.128, a copy of the I band)',
    'Q88445025': 'an ultraviolet source in a cluster, not a star',
    'Q78939486': 'an ultraviolet source with round coordinates, not a star',
    'Q3271890': 'R Horologii, Mira variable listed at maximum',
    'Q1071564': 'Chi Cygni, Mira variable listed at maximum',
    'Q257904': 'R Cassiopeiae, Mira variable listed at maximum',
    'Q2608961': 'U Orionis, Mira variable listed at maximum',
    'Q14555183': '132 Tauri, coordinates are wrong (RA equals Dec)',
    'Q66531079': 'no label, V only, typed X-ray source; unverifiable',
    'Q66476612': 'no label, V only; unverifiable',
    'Q66476624': 'no label, V only; unverifiable',
    'Q66476847': 'no label; its other magnitudes (G 15.3) contradict V 5.43',
    'Q2023845': 'Collinder 135, an open cluster',
    'Q85469156': 'typed low-mass star; its magnitudes (V est. 1.8) belong to no known star',
    'Q14166043': 'GM Lupi, V 6.4 contradicts its other magnitudes',
    'Q10513052': 'debris disk of HD 69830, not a star',
    'Q2090157': 'Alpha Centauri A, already part of the system item Q12176 (0.014 degrees away)',
    'Q1052548': 'Alpha Centauri B, already part of the system item Q12176',
}

# The stars whose V magnitude is estimated (item: bands used, V, B-V), as found when this
# was written (2026-11-15). The script recomputes them from the cached answers and
# warns if the result differs from this list.
ESTIMATED = {
    'Q1048396': ('J,K', 1.96, 0.11),
    'Q1029146': ('B,R', 3.86, -0.04),
    'Q1195617': ('B,R', 4.12, 0.52),
    'Q2701373': ('G,J,K', 4.13, 0.46),
    'Q3236079': ('B,R', 4.21, 0.26),
    'Q1504634': ('G,J,K', 4.22, 0.27),
    'Q4552068': ('B,R', 4.25, 0.32),
    'Q105297613': ('G,J,K', 4.39, 1.35),
    'Q4547757': ('G,J,K', 4.57, 1.28),
    'Q5097879': ('B,R', 4.58, 0.47),
    'Q1187579': ('B,R', 4.76, 0.95),
    'Q3304286': ('G,J,K', 4.80, 0.32),
    'Q1091502': ('G,J,K', 4.81, 1.20),
    'Q5174527': ('B,R', 4.82, 0.41),
    'Q4637405': ('B,R', 4.83, 0.41),
    'Q4552052': ('G,J,K', 4.97, 0.46),
    'Q14067': ('B,R', 4.98, 0.34),
    'Q10940877': ('B,R', 5.01, 0.64),
    'Q6829258': ('B,R', 5.02, 0.02),
    'Q520086': ('B,R', 5.04, 0.42),
    'Q75918085': ('G,J,K', 5.05, 0.36),
    'Q4547329': ('B,R', 5.06, 0.46),
    'Q10939752': ('B,R', 5.07, 0.46),
    'Q3599762': ('B,R', 5.09, 0.37),
    'Q10939740': ('G,J,K', 5.10, 1.29),
    'Q5174410': ('B,R', 5.12, 0.65),
    'Q10338086': ('G,J,K', 5.13, 0.43),
    'Q5652824': ('B,R', 5.15, 0.43),
    'Q5652698': ('B,R', 5.16, 0.44),
    'Q2609100': ('B,R', 5.16, 0.45),
    'Q11089336': ('G,J,K', 5.16, 1.03),
    'Q8179094': ('G,J,K', 5.18, 0.46),
    'Q2608125': ('B,R', 5.18, 0.48),
    'Q9553043': ('G,J,K', 5.20, 0.41),
    'Q6828863': ('G,J,K', 5.21, 0.29),
    'Q3773259': ('G,J,K', 5.22, 0.20),
    'Q10371430': ('B,R', 5.23, 0.41),
    'Q3599718': ('B,R', 5.23, 0.41),
    'Q2545903': ('B,R', 5.25, 0.68),
    'Q5651832': ('G,J,K', 5.25, 1.07),
    'Q6808890': ('B,R', 5.26, 0.21),
    'Q7219957': ('G,J,K', 5.30, 0.29),
    'Q10891384': ('B,R', 5.34, 0.93),
    'Q5177247': ('J,K', 5.37, -0.08),
    'Q1748822': ('G,J,K', 5.38, 0.95),
    'Q2399549': ('B,R', 5.38, 0.86),
    'Q10849743': ('G,J,K', 5.40, 0.40),
    'Q9550799': ('B,R', 5.43, 0.78),
    'Q2545922': ('G,J,K', 5.44, 0.59),
    'Q2403318': ('B,R', 5.59, 0.49),
    'Q10848540': ('G,J,K', 5.59, 0.50),
    'Q2608909': ('G,J,K', 5.60, 1.19),
    'Q510219': ('B,R', 5.64, 0.54),
    'Q9554020': ('B,R', 5.66, 0.83),
    'Q8179169': ('B,R', 5.66, 0.96),
    'Q526138': ('B,R', 5.67, 0.83),
    'Q6819578': ('G,J,K', 5.72, 0.33),
    'Q1051945': ('B,R', 5.73, 0.41),
    'Q1747931': ('B,R', 5.74, 0.29),
    'Q2661937': ('G,J,K', 5.77, 0.66),
    'Q10940444': ('G,J,K', 5.79, 0.48),
    'Q14861084': ('B,R', 5.79, 0.87),
    'Q2403444': ('B,R', 5.80, 0.74),
    'Q5681154': ('B,R', 5.82, 0.41),
    'Q10940896': ('G,J,K', 5.84, 0.48),
    'Q4639038': ('G,J,K', 5.88, 0.59),
    'Q1097319': ('B,R', 5.88, 0.35),
    'Q1097299': ('G,J,K', 5.89, 0.53),
    'Q3598980': ('G,J,K', 5.89, 0.39),
    'Q10850742': ('G,J,K', 5.89, 0.60),
    'Q11099675': ('G,J,K', 5.90, 0.59),
    'Q17460801': ('B,R', 5.91, 0.51),
    'Q1051937': ('B,R', 5.95, 0.43),
    'Q15938911': ('G,J,K', 5.96, 0.94),
    'Q10950122': ('G,J,K', 5.97, 1.22),
    'Q6853438': ('B,R', 5.99, -0.01),
    'Q3781670': ('G,J,K', 6.00, 0.61),
    'Q3598962': ('G,J,K', 6.02, 0.95),
    'Q3882142': ('G,J,K', 6.02, 0.93),
    'Q8179755': ('B,R', 6.04, 0.79),
    'Q10939750': ('B,R', 6.06, 0.82),
    'Q15939645': ('B,R', 6.06, 0.58),
    'Q1070720': ('B,R', 6.10, 0.74),
    'Q2402864': ('B,R', 6.13, 0.42),
    'Q15939711': ('G,J,K', 6.13, 0.59),
    'Q1749023': ('G,J,K', 6.14, 1.18),
    'Q1749004': ('G,J,K', 6.17, 0.42),
    'Q430426': ('B,R', 6.24, 0.55),
    'Q15939677': ('B,R', 6.25, 0.44),
    'Q11180212': ('B,R', 6.26, 0.44),
    'Q60845613': ('B,R', 6.26, 0.46),
    'Q5653066': ('B,R', 6.29, 0.48),
    'Q5961803': ('B,R', 6.32, 0.66),
    'Q8179429': ('G,J,K', 6.33, 0.56),
    'Q66492036': ('G,J,K', 6.34, 0.51),
    'Q66492716': ('G,J,K', 6.39, 0.56),
    'Q66491814': ('G,J,K', 6.42, 1.05),
    'Q14858817': ('B,R', 6.42, 0.41),
    'Q66493154': ('G,J,K', 6.44, 0.58),
    'Q15949861': ('B,R', 6.45, 0.32),
    'Q10849254': ('B,R', 6.47, 0.46),
}

# ---- Query service ----------------------------------------------------------
CACHE = 'wikidata-cache'
OFFLINE = False
_last = [0.0]


def fetch(query):
    """Run a SPARQL query; answers are cached on disk, keyed by the query text."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha256(query.encode()).hexdigest()[:20] + '.json')
    if os.path.exists(path):
        with open(path, encoding='utf8') as f:
            return json.load(f)['results']['bindings']
    if OFFLINE:
        raise SystemExit('not in the cache (offline): ' + query[:200])
    for attempt in range(6):
        wait = 65 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        req = urllib.request.Request(
            ENDPOINT, data=urllib.parse.urlencode({'query': query}).encode(),
            headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
        try:
            with urllib.request.urlopen(req, timeout=70) as r:
                raw = r.read()
            data = json.loads(raw)
        except Exception as e:
            print('query failed (%s), trying again' % e, file=sys.stderr)
            continue
        with open(path, 'wb') as f:
            f.write(raw)
        return data['results']['bindings']
    raise SystemExit('the query failed 6 times: ' + query[:200])


def qid(b, k):
    return b[k]['value'].rsplit('/', 1)[-1]


# V ranges, narrow enough to finish within the service's 60 s limit. The range
# filter needs decimal literals and the two hints, or the query times out.
SLICES = [(-1.6, 3.0), (3.0, 4.0), (4.0, 4.6), (4.6, 5.1), (5.1, 5.5), (5.5, 5.7), (5.7, 5.9),
          (5.9, 6.1), (6.1, 6.2), (6.2, 6.3), (6.3, 6.4), (6.4, 6.5001)]


def slice_query(lo, hi):
    return f"""SELECT ?item ?v ?ra ?dec ?ep WHERE {{
  hint:Query hint:optimizer "None" .
  ?s ps:P1215 ?v .
  hint:Prior hint:rangeSafe true .
  FILTER(?v >= {lo} && ?v < {hi})
  ?item p:P1215 ?s .
  ?s pq:P1227 wd:{V_BAND} .
  ?item p:P6257 ?rs . ?rs ps:P6257 ?ra .
  ?item p:P6258 ?ds . ?ds ps:P6258 ?dec .
  OPTIONAL{{ ?rs pq:P6259 ?ep }}
}}
"""


def noband_query(lo, hi):
    """The same, for magnitudes that carry no band qualifier at all (rare)."""
    return slice_query(lo, hi).replace(
        '?s pq:P1227 wd:%s .' % V_BAND, 'FILTER NOT EXISTS { ?s pq:P1227 ?band }')


def values_query(items, body, select):
    return 'SELECT %s WHERE {\n VALUES ?item { %s }\n %s\n}\n' % (
        select, ' '.join('wd:' + x for x in items), body)


def chunks(seq, n=2400):
    return [seq[i:i + n] for i in range(0, len(seq), n)]


# ---- Pipeline -----------------------------------------------------------------
def collect():
    """V band items first, then items whose magnitude has no band qualifier
    (only those not already found). Each list is sorted by magnitude."""
    items = collections.OrderedDict()
    orders = []
    for make in (slice_query, noband_query):
        found = collections.OrderedDict()
        for lo, hi in SLICES:
            for b in fetch(make(lo, hi)):
                q = qid(b, 'item')
                if q in items:
                    continue
                it = found.setdefault(q, {'v': [], 'ra': [], 'dec': [], 'noband': make is noband_query})
                v = float(b['v']['value'])
                if v not in it['v']:
                    it['v'].append(v)
                for k in ('ra', 'dec'):
                    x = float(b[k]['value'])
                    if x not in it[k]:
                        it[k].append(x)
        orders += sorted(found, key=lambda q: found[q]['v'][0])
        items.update(found)
    return items, orders


def sep_deg(a, b):
    d2r = math.pi / 180
    c = (math.sin(a[1] * d2r) * math.sin(b[1] * d2r)
         + math.cos(a[1] * d2r) * math.cos(b[1] * d2r) * math.cos((a[0] - b[0]) * d2r))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


# ---- Estimated magnitudes ---------------------------------------------------
# Some real stars have no V magnitude on Wikidata, only other bands. For those
# the V magnitude and the colour are ESTIMATED from the item's own magnitudes
# and a generic colour relation. Nothing else is used.
#   B and R known (R band, item Q15977411):  B-V = (B - R) / BR_FACTOR,  V = B - (B-V).
#     For ordinary stars V-R is about 0.56 of B-V, so B-R is about 1.56 of B-V.
#     Tested on 1001 stars that have B, V and R on Wikidata, a factor of 1.8
#     fits better (error of V: mean +0.03, standard deviation 0.23 for V 3.3 to 5;
#     with 1.56 it is -0.07 and 0.28), so 1.8 is used.
#   Only J and K (J band Q15991308, K band Q2520419), and a blue star (J-K < 0.3):
#     V = K + 4.1 (J - K),  B-V = 0.45 (V - K).
#     Tested on 653 stars with J-K < 0.1: error of V mean -0.07, standard
#     deviation 0.48. Rough.
# Stars found this way are marked in the table (column "estimate") and are
# listed when the script runs. They never replace a star that has a V magnitude.
J_BAND, K_BAND, R_BAND = 'Q15991308', 'Q2520419', 'Q15977411'
BR_FACTOR = 1.8
JK_SLOPE, JK_BV, JK_MAX_COLOUR, JK_MIN_COLOUR = 4.1, 0.45, 0.3, -0.2
#   G band (item Q66659648, label "G band") and J, K known, but no B and R:
#     V = G + offset(J-K), the offset being the median of V - G in bins of J-K, measured on
#     2022 stars that have G, J, K and V on Wikidata (spread of V - G inside a bin, as
#     1.48 x median absolute deviation: 0.04 to 0.09 for J-K below 0.9, 0.24 above;
#     about 3% of the stars are outliers). B-V = 0.45 (V - K) as above.
#     This rule comes before the J,K rule when the item has a G magnitude.
G_BAND = 'Q66659648'
G_OFFSET = [(-0.2, 0.1, 0.033), (0.1, 0.3, 0.065), (0.3, 0.6, 0.206), (0.6, 0.9, 0.333), (0.9, 1.5, 0.737)]
# A J,K estimate is refused when the item's own R magnitude says otherwise
# (R - V more than 0.6 is not a blue or white star), or the colour is absurd.
JK_MAX_R_MINUS_V = 0.6
J_SLICES = [(-3.0, 3.5), (3.5, 4.5), (4.5, 5.5)]
B_SLICES = [(-2.0, 3.5), (3.5, 4.3), (4.3, 4.8), (4.8, 5.2), (5.2, 5.6), (5.6, 6.0), (6.0, 6.4), (6.4, 7.0)]


def jk_query(lo, hi):
    """Items with J and K magnitudes but no V magnitude at all."""
    return f"""SELECT ?item ?j ?k ?ra ?dec WHERE {{
  hint:Query hint:optimizer "None" .
  ?s ps:P1215 ?j .
  hint:Prior hint:rangeSafe true .
  FILTER(?j >= {lo} && ?j < {hi})
  ?item p:P1215 ?s .
  ?s pq:P1227 wd:{J_BAND} .
  ?item p:P1215 ?ks . ?ks pq:P1227 wd:{K_BAND} . ?ks ps:P1215 ?k .
  FILTER NOT EXISTS {{ ?item p:P1215 ?vs . ?vs pq:P1227 wd:{V_BAND} }}
  ?item p:P6257 ?rs . ?rs ps:P6257 ?ra .
  ?item p:P6258 ?ds . ?ds ps:P6258 ?dec .
}}
"""


def br_query(lo, hi):
    """Items with B and R magnitudes but no V magnitude at all."""
    return f"""SELECT ?item ?b ?r ?ra ?dec WHERE {{
  hint:Query hint:optimizer "None" .
  ?s ps:P1215 ?b .
  hint:Prior hint:rangeSafe true .
  FILTER(?b >= {lo} && ?b < {hi})
  ?item p:P1215 ?s .
  ?s pq:P1227 wd:{B_BAND} .
  ?item p:P1215 ?rr . ?rr pq:P1227 wd:{R_BAND} . ?rr ps:P1215 ?r .
  FILTER NOT EXISTS {{ ?item p:P1215 ?vs . ?vs pq:P1227 wd:{V_BAND} }}
  ?item p:P6257 ?rs . ?rs ps:P6257 ?ra .
  ?item p:P6258 ?ds . ?ds ps:P6258 ?dec .
}}
"""


def estimates(log=print):
    """Returns {qid: dict(ra, dec, v, bv, est)} for stars without a V magnitude."""
    cand = collections.OrderedDict()

    def add(b, keys):
        it = cand.setdefault(qid(b, 'item'), {k: [] for k in ('b', 'r', 'j', 'k', 'ra', 'dec')})
        for k in keys:
            x = float(b[k]['value'])
            if x not in it[k]:
                it[k].append(x)
    for lo, hi in B_SLICES:
        for b in fetch(br_query(lo, hi)):
            add(b, ('b', 'r', 'ra', 'dec'))
    jk = []
    for lo, hi in J_SLICES:
        for b in fetch(jk_query(lo, hi)):
            jk.append(qid(b, 'item'))
            add(b, ('j', 'k', 'ra', 'dec'))
    jk = [q for q in dict.fromkeys(jk) if not cand[q]['b']]
    # J, K items that also have B and R are left to the B, R rule.
    has_br = collections.defaultdict(set)
    r_of, g_of = {}, {}
    for ch in chunks(jk):
        for b in fetch(values_query(ch, '?item p:P1215 ?s. ?s pq:P1227 ?band; ps:P1215 ?val. FILTER(?band IN (wd:%s, wd:%s, wd:%s))' % (B_BAND, R_BAND, G_BAND), '?item ?band ?val')):
            has_br[qid(b, 'item')].add(qid(b, 'band'))
            if qid(b, 'band') == R_BAND:
                r_of.setdefault(qid(b, 'item'), float(b['val']['value']))
            if qid(b, 'band') == G_BAND:
                g_of.setdefault(qid(b, 'item'), float(b['val']['value']))
    jk = [q for q in jk if not {B_BAND, R_BAND} <= has_br[q]]
    ids = [q for q in cand if cand[q]['b']] + jk
    classes = collections.defaultdict(set)
    for ch in chunks(ids):
        for b in fetch(values_query(ch, '?item wdt:P31 ?c.', '?item ?c')):
            classes[qid(b, 'item')].add(qid(b, 'c'))
    out = {}
    for q in ids:
        c = cand[q]
        if q in DROP_ITEMS or set(classes[q]) & set(NOT_STAR) or not c['ra'] or not c['dec']:
            continue
        if not (0 <= c['ra'][0] < 360 and -90 <= c['dec'][0] <= 90):
            continue
        if c['b'] and c['r']:
            bv = (c['b'][0] - c['r'][0]) / BR_FACTOR
            v, how = c['b'][0] - bv, 'B,R'
            if not -0.5 <= bv <= 2.5:
                continue
        elif (c['j'] and c['k'] and q in g_of
              and any(lo <= c['j'][0] - c['k'][0] < hi for lo, hi, _ in G_OFFSET)):
            colour = c['j'][0] - c['k'][0]
            v = g_of[q] + [off for lo, hi, off in G_OFFSET if lo <= colour < hi][0]
            bv, how = JK_BV * (v - c['k'][0]), 'G,J,K'
            if not -0.4 <= bv <= 1.9:
                continue
        elif c['j'] and c['k'] and JK_MIN_COLOUR <= c['j'][0] - c['k'][0] < JK_MAX_COLOUR:
            v = c['k'][0] + JK_SLOPE * (c['j'][0] - c['k'][0])
            bv, how = JK_BV * (v - c['k'][0]), 'J,K'
            if not -0.4 <= bv <= 1.0 or (q in r_of and r_of[q] - v > JK_MAX_R_MINUS_V):
                continue
        else:
            continue
        if v > 6.5:
            continue
        out[q] = {'ra': c['ra'][0], 'dec': c['dec'][0], 'v': v, 'bv': bv, 'est': how}
    log('stars without a V magnitude, estimated from other bands: %d' % len(out))
    return out


def build(log=print):
    items, order = collect()
    log('items with V band magnitude <= 6.5 and coordinates: %d' % len(items))
    bmag = collections.defaultdict(list)
    classes = collections.defaultdict(set)
    for ch in chunks(order):
        for b in fetch(values_query(ch, '?item p:P1215 ?bs. ?bs pq:P1227 wd:%s. ?bs ps:P1215 ?b.' % B_BAND, '?item ?b')):
            bmag[qid(b, 'item')].append(float(b['b']['value']))
    for ch in chunks(order):
        for b in fetch(values_query(ch, '?item wdt:P31 ?c.', '?item ?c')):
            classes[qid(b, 'item')].add(qid(b, 'c'))
    stats = collections.Counter()
    rows = []
    for q in order:
        it = items[q]
        v = it['v'][0]
        if v > 6.5:
            continue
        cl = classes.get(q, set())
        if not (all(0 <= x < 360 for x in it['ra']) and all(-90 <= x <= 90 for x in it['dec'])):
            stats['coordinates out of range'] += 1
            continue
        if q in DROP_ITEMS:
            stats['dropped by hand: ' + DROP_ITEMS[q]] += 1
            continue
        bad = cl & set(NOT_STAR)
        if bad and q not in KEEP_ITEMS:
            for c in sorted(bad):
                stats['dropped class: ' + NOT_STAR[c]] += 1
            continue
        # Items with several coordinate statements: the middle one.
        ra = statistics.median(it['ra'])
        dec = statistics.median(it['dec'])
        b = bmag.get(q)
        bv = b[0] - v if b else None
        if bv is not None and not -1.0 <= bv <= 3.0:
            stats['B-V out of range (-1..3), treated as missing'] += 1
            bv = None
        rows.append({'qid': q, 'ra': ra, 'dec': dec, 'v': v, 'b': b[0] if b else None, 'bv': bv})
    # Double entries: two items within 0.01 degrees; keep the brighter.
    rows.sort(key=lambda r: (r['v'], r['qid']))
    kept = []
    grid = collections.defaultdict(list)
    for r in rows:
        cx, cy = int(r['ra']), int(r['dec'] + 90)
        dup = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for k in grid.get(((cx + dx) % 360, cy + dy), []):
                    if sep_deg((r['ra'], r['dec']), (k['ra'], k['dec'])) < 0.01:
                        dup = True
        if dup:
            stats['double entries merged'] += 1
            continue
        grid[(cx, cy)].append(r)
        kept.append(r)
    med = statistics.median(r['bv'] for r in kept if r['bv'] is not None)
    stats['B-V missing, median used (%.3f)' % med] = sum(1 for r in kept if r['bv'] is None)
    for r in kept:
        r['bv_used'] = med if r['bv'] is None else r['bv']
    # Estimated stars: never in place of a star that has a V magnitude.
    for q, e in sorted(estimates(log).items(), key=lambda x: x[1]['v']):
        near = [k for k in kept if abs(k['dec'] - e['dec']) < 0.02 and sep_deg((e['ra'], e['dec']), (k['ra'], k['dec'])) < 0.01]
        if near:
            stats['estimates not used (a star is already there)'] += 1
            continue
        kept.append({'qid': q, 'ra': e['ra'], 'dec': e['dec'], 'v': e['v'], 'b': None, 'bv': e['bv'],
                     'bv_used': e['bv'], 'est': e['est']})
        stats['estimated V (B,R / G,J,K / J,K), used'] += 1
    kept.sort(key=lambda r: (r['v'], r['qid']))
    used = {r['qid']: (r['est'], r['v'], r['bv_used']) for r in kept if r.get('est')}
    same = used.keys() == ESTIMATED.keys() and all(
        used[q][0] == e[0] and abs(used[q][1] - e[1]) < 0.011 and abs(used[q][2] - e[2]) < 0.011
        for q, e in ESTIMATED.items())
    if not same:
        log('WARNING: the estimated stars differ from the list ESTIMATED in this script (%d against %d)'
            % (len(used), len(ESTIMATED)))
    for k, n in sorted(stats.items()):
        log('  %s: %d' % (k, n))
    log('stars in the catalogue: %d' % len(kept))
    return kept


def encode(rows):
    out = bytearray()
    for r in rows:
        ra = round(r['ra'] / 360 * 65536) % 65536
        dec = round((r['dec'] + 90) / 180 * 65535)
        v = round((min(6.5, max(-1.5, r['v'])) + 1.5) / 8 * 255)
        bv = round((min(2.0, max(-0.5, r['bv_used'])) + 0.5) / 2.5 * 255)
        out += struct.pack('<HHBB', ra, dec, v, bv)
    return base64.b64encode(bytes(out)).decode()


def main():
    global CACHE, OFFLINE
    ap = argparse.ArgumentParser(description='Build the star catalogue from Wikidata.')
    ap.add_argument('--cache', default='wikidata-cache')
    ap.add_argument('--index')
    ap.add_argument('--out')
    ap.add_argument('--table')
    ap.add_argument('--offline', action='store_true')
    a = ap.parse_args()
    CACHE, OFFLINE = a.cache, a.offline
    rows = build()
    b64 = encode(rows)
    print('base64: %d characters, sha256 %s' % (len(b64), hashlib.sha256(b64.encode()).hexdigest()[:16]))
    if a.out:
        with open(a.out, 'w') as f:
            f.write(b64)
    if a.table:
        with open(a.table, 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(['qid', 'ra', 'dec', 'v', 'b', 'bv', 'bv_used', 'estimate'])
            for r in rows:
                w.writerow([r['qid'], r['ra'], r['dec'], r['v'], r['b'] if r['b'] is not None else '',
                            '' if r['bv'] is None else round(r['bv'], 3), round(r['bv_used'], 3), r.get('est', '')])
    if a.index:
        with open(a.index, encoding='utf8') as f:
            html = f.read()
        pat = re.compile(r'(<script id="stars" type="application/octet-stream">)[^<]*(</script>)')
        if not pat.search(html):
            raise SystemExit('no <script id="stars"> block in ' + a.index)
        html = pat.sub(lambda m: m.group(1) + b64 + m.group(2), html, count=1)
        with open(a.index, 'w', encoding='utf8') as f:
            f.write(html)
        print('updated', a.index)


if __name__ == '__main__':
    main()
