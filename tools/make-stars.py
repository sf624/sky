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
  Wikidata gives no V magnitude is left out. A star without a B magnitude gets
  the median B-V of the catalogue.

How to run (standard library only; Python 3.8 or later)
    python3 tools/make-stars.py --cache wikidata-cache --index index.html
  --cache DIR   where the answers are kept (default wikidata-cache). A second
                run with the same cache needs no network. The first run sends
                one request a minute (about 20 requests; about half an hour).
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
    'Q14166043': 'GM Lupi, V 6.4 contradicts its other magnitudes',
    'Q10513052': 'debris disk of HD 69830, not a star',
    'Q2090157': 'Alpha Centauri A, already part of the system item Q12176 (0.014 degrees away)',
    'Q1052548': 'Alpha Centauri B, already part of the system item Q12176',
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
            w.writerow(['qid', 'ra', 'dec', 'v', 'b', 'bv', 'bv_used'])
            for r in rows:
                w.writerow([r['qid'], r['ra'], r['dec'], r['v'], r['b'] if r['b'] is not None else '',
                            '' if r['bv'] is None else round(r['bv'], 3), round(r['bv_used'], 3)])
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
