# Developing Sky

How to run the page, how to judge a change, and the rules the code keeps.
For how a frame is made, see [design.md](design.md). Plans and known
flaws are in the [issues](https://github.com/sf624/sky/issues), not in
this directory: these documents describe the code as it is. A change that
alters what they describe updates them in the same pull request.

## Running the page

`index.html` is the whole program. There is no build step and nothing to
install. Open it from a file (`file://`), or serve the directory with any
static web server, for example `python3 -m http.server`.

The published page:

- `main`: https://sf624.github.io/sky/
- a pull request `N`: https://sf624.github.io/sky/pr/N/

## URL parameters

A view can be given in the address, for example
`?time=17.5&cloud=0.7&yaw=120&pitch=-10`.

These set the slider with the same id. The browser clamps the value to the
slider's range and rounds it to its step. A value that is not a number
becomes the middle of the range (`time=abc` gives 12).

| Parameter | Range, step | Default | Meaning |
|---|---|---|---|
| `time` | 0 to 24, 0.05 | 15 | Local solar time, hours (the sun is due south at 12) |
| `date` | 1 to 365, 1 | today | Day of the current year |
| `moon` | 0 to 29.5, 0.5 | from the date | Age of the moon, days |
| `haze` | 0 to 6, 0.05 | 0.35 | Multiplier on the aerosol (Mie) density |
| `wind` | 1 to 15, 0.5 | 6 | Wind over the sea, m/s |
| `alt` | 0.3 to 13, 0.1 | 11 | Altitude of the aircraft, km |
| `speed` | 0 to 3000, 50 | 900 | Speed, km/h. 0 stands still, and drawing stops once the picture is clean |
| `cloud` | 0 to 1, 0.01 | 0.5 | Amount of low cloud |
| `cirrus` | 0 to 1, 0.01 | 0.4 | Amount of high, thin cloud |

These are read directly.

| Parameter | Default | Meaning |
|---|---|---|
| `yaw` | the sun's direction as a `yaw`, + 65 | Direction of view, degrees: 0 south, 90 west, -90 east. A larger `yaw` turns the view to the right (clockwise seen from above) |
| `pitch` | -8 | Elevation of the view, degrees, up positive. Not clamped (a drag clamps to 89) |
| `heading` | `yaw` - 60 | Direction flown, degrees, as `yaw` |
| `at` | `0,0` | Starting place, `x,z` in km on the weather map (wrapped to 0 to 256) |
| `pixels` | stored choice, else `wqhd` | The hero's drawing limit: `fhd`, `wqhd` or `4k`. Not stored |
| `lang` | stored choice, else the browser's language | The page's language: `ja` or `en`. Not stored |
| `sound` | stored choice, else `off` | Background sound: `off`, `airliner`, `airliner-whine` (the panel's "Near engines") or `wind`. Another value counts as none given. It starts at the first click or key press. Not stored |
| `volume` | stored choice, else 0.5 | Volume of the sound, 0 to 1 (clamped). Not stored |
| `res` | none: dynamic | 0 to 1: fixes the hero's drawing scale while it moves, relative to the canvas (0: dynamic). At rest it is drawn in full |
| `rate` | `960` | The speed of time while playing, a factor of real time: `1` (real time), `60`, `600`, `960` or `3600`. Other values are ignored |
| `play` | none | `1` starts playing at load |
| `now` | none | `1` does what the now button does: today's date, the present time and the moon's age for the date, playing in real time. It wins over `time`, `date` and `moon`; a `rate` given with it wins over real time |

With `date` and no `moon`, the moon's age follows the given date.

The page keeps four choices in `localStorage`: `sky.pixels` (the drawing
limit), `sky.lang` (the language, set by the panel's language select),
`sky.sound` and `sky.volume` (the sound and its volume). The address wins
over all of them. Each is read and written inside `try`: without storage
the page works and forgets.

The page does not check `yaw` and `pitch`: a value that is not a number
makes them NaN (`params.get('yaw') * RAD`), and the camera with them.
`heading` and the parts of `at` fall back to 0.

## Judging a change

**The tools.** [`tools/`](https://github.com/sf624/sky/blob/main/tools/README.md) (in the repository, not on the site) does the checks below from
the command line, in headless Chrome on a fake clock: stills of a fixed
set of views against a base, the wrap, the loop, the drawing size, flight
against a still, and a GL trace that shows whether a change sends the
same commands to WebGL. For example
`node tools/sky.mjs check --base origin/main`.

**Stills.** The hero is a mean over frames, so one frame is noisy. For a
still, set `speed=0` and let it settle: after the last change it draws 39
frames and stops (`SETTLE + RELIGHT`, and the frame of the change). From
page load, step about 46 frames before the screenshot: the first frames
may start the mean again (the first reset, and a restart if the drawing
size grows). Hide the overlays (`.title`, `.panel`,
`.hint`, `.fs`) for a clean picture. The canvas is made with
`preserveDrawingBuffer`, so `canvas.toDataURL()` reads what is shown.

**Realism.** The goal is a sky that looks real: a picture that could be a
photograph taken from an aircraft window. Compare with real photographs,
not with other renderers or memory. Look at several views: the default,
low sun, near the cloud tops, under the cloud base, cirrus overhead,
night, haze, strong wind.

A change of the picture is checked over a matrix of scenes, each beside a
photograph of the same kind: altitude (about 0.3 km, 3 to 5 km, 11 km) by
time (day, dusk, night) by clouds (low clouds, thin clouds, few and many),
towards the sun and away from it, at rest and in flight. The rule and what
to report are in [`CLAUDE.md`](https://github.com/sf624/sky/blob/main/CLAUDE.md).
The picture comes before the processing load.

**In flight as well as at rest.** Fly over the change (the default speed
is 900 km/h). Look for smears, ghosts and trails at the edges of clouds
(the reprojection), flicker of fine patterns, and jumps when the dynamic
resolution changes (`?res=` fixes it, to compare). A pattern read at
`p.xz + uDrift` must not show a seam when the way flown wraps at 256 km:
fly across it, for example `?at=255.5,0&heading=90&speed=3000`.

**More than one GPU.** GLSL compilers differ. Check that the shaders
compile and draw the same on a software renderer as well (Chrome's
SwiftShader, `--use-angle=swiftshader`). Look at the console: `makeSky`
throws the compiler's log, and the page prints it.

**Cost.** Measure the GPU time before and after (next section).

**The start.** Opening the page must not hold the browser. `node
tools/sky.mjs perf` prints the time to the first picture and the main
thread's tasks over 50 ms until then; run it on a fresh Chrome (each run
starts one) and more than once. On the test machine's GPU only
`getContext` may take over 50 ms (up to about 0.4 s in a browser just
started). The loading (see
[design.md](design.md#from-the-address-bar-to-the-first-frame)) keeps to
these rules, and new work at start should too:
- Compile and link every program at once. Ask for `COMPILE_STATUS`,
  `LINK_STATUS` and uniform locations only once `COMPLETION_STATUS_KHR`
  says the program is done: asking earlier waits for the compiler, which
  can take seconds for `fs` (ANGLE on Direct3D 11, the usual stack on
  Windows).
- CPU work over a few ms is a job (a generator that yields every little
  while), run by `slices` at start and by `finish` later.
- GPU work at start goes in `batches`, with a fence after each.
- No `readPixels`, `getError` or `finish` that waits for the GPU while the
  page loads.

**Sound.** It cannot be judged by looking, and an agent cannot hear it:
measure it, and give a person files to listen to. Render it offline in
headless Chrome: in a page from the same origin, take the text of the
`<script>` that defines `SkySound` from `index.html`, run it, and build
`SkySound.engine(ctx)` on an `OfflineAudioContext` (48 kHz, stereo). Call
`volume`, `fly` and `play` at the times wanted (a speed sweep is `fly`
every 50 ms), then `tick(duration)`, then `startRendering()`; write the
channels to a 16-bit WAV. Check the peak at volume 1 in the loudest state
(0.3 km, 3000 km/h: it must stay below -1 dBFS), the largest jump between
samples in a sweep and at a switch (no larger than in a steady state), the
autocorrelation of 40 s at the noise buffers' lengths (11 s and 10.3 s: no
peak), and a spectrogram. In the real page, check that no `AudioContext`
exists before a click, and that choosing off or hiding the page suspends
it. Keep renders out of the repository.

## GPU time

The GPU time is the time the GPU spends on each draw call. Measure it with
`EXT_disjoint_timer_query_webgl2` around `drawArrays`, while the hero
flies: at rest the page draws nothing. Fix the drawing scale with
`?res=1`, or the dynamic resolution changes the size under you. Other work
on the same GPU moves the numbers by 10 to 20 %: repeat, and compare
medians or minimums.

Each frame of the hero is four draws: the first stage of the clouds'
light (`fs` with `uStage` 0, a quarter of the pixels), the scene (`fs`)
into the frame texture, `mean`, and `show`. The two draws of `fs` are
nearly all of it; the numbers below for the scene are their sum. Measured on an
NVIDIA RTX 3090 (median GPU time per frame, default view, flying), in
November 2026. The page had a scroll bar then, so the drawing sizes are
those of 2560 x 1440 and 3840 x 2160 windows less a scroll bar; the first
row was measured again once the page stopped scrolling (it was 5.5 ms at
1905 x 1080 too). The last was measured with `?pixels=4k`: with the
default limit (WQHD), a 4K window is drawn at 2560 x 1440.

| Drawing size | Scene (`fs`) | `mean` | `show` |
|---|---|---|---|
| 1920 x 1080 | 5.5 ms | 0.08 ms | 0.02 ms |
| 2545 x 1440 | 9.3 ms | | |
| 3825 x 2160 | 19 ms | | |

At 1905 x 1080, the scene without low clouds (`cloud=0`) took 2.8 ms,
without cirrus (`cirrus=0`) 5.6 ms, and without either 2.5 ms. So in the
default view the low clouds take about half of the scene; the air, the
sea and the sky take most of the rest; the cirrus costs little. Close over
the clouds (`alt=3&cloud=0.7`) the scene took 4.5 ms.

Those numbers are older than the detail of the low clouds near the eye
(#33, November 2026), which trades time for the picture. Flying, `res=1`,
the scene in ms at 1920 x 1080 and at 2560 x 1440 (main in brackets; both
stages):

| View | 1920 x 1080 | 2560 x 1440 |
|---|---|---|
| Default (cruise) | 9.8 (4.9) | 15.6 (8.1) |
| `alt=2&cloud=0.7` | 24.3 (5.1) | 40.1 |
| Tops from 4.6 km (`alt=4.6&cloud=1&time=15&date=321&pitch=-15`) | 14.0 (3.5) | 23.5 (5.9) |
| Among clouds at 1.8 km (`alt=1.8&cloud=0.7&time=13&date=172&pitch=0&yaw=100`) | 21.0 (5.1) | 34.7 (7.4) |
| Under a deck at 0.6 km (`alt=0.6&cloud=0.78&time=17&date=319&yaw=130&pitch=25`) | 12.9 (5.8) | 21.2 (10.0) |
| 5 km, looking down 20 degrees (`alt=5&cloud=0.8&date=321&pitch=-20`) | 15.6 (4.7) | 25.8 (6.4) |

Where clouds fill the view from near, the scene costs three to five times
what it did. Of the scene's own draw, the light of the clouds was three
quarters: its slow parts are now worked out at a quarter of the pixels (see
[design.md](design.md#low-clouds)), and the smooth reads of the noise serve
the normals only. Closest to the tops (`alt=2`, among clouds at 1.8 km)
the fine normals and the march are most of what is left, and the scene
still takes over 25 ms at WQHD.

On a slower GPU, when frames take longer than 40 ms (25 frames a second),
the dynamic resolution draws a smaller picture while the view moves, down
to 0.35 of the canvas per side (see
[design.md](design.md#the-drawing-size)).

## GLSL rules

The shaders must run on any WebGL2. The code keeps these rules:

- **Explicit level of detail.** Read textures with `textureLod`,
  `textureGrad` or `texelFetch`, never `texture`. Inside loops and branches
  the implicit derivatives that `texture` needs are undefined, and most of
  the scene is loops and branches.
- **No reversed `smoothstep`.** `smoothstep(edge0, edge1, x)` is undefined
  when `edge0 >= edge1`. Write `1.0 - smoothstep(lo, hi, x)`. The rule
  holds for new code. Two old ones remain in `main`: the sun's disc
  (`smoothstep(0.0050, 0.0043, …)`) and the moon's edge
  (`smoothstep(1.0, 1.0 - 1.5 * pix / MOON_R, rm)`).
- **No constant-alpha blending.** Some drivers ignore the alpha of
  `blendColor`, so `CONSTANT_ALPHA` and `ONE_MINUS_CONSTANT_ALPHA` leave the
  picture as it was. The mean over frames is computed in a shader, with
  two textures that take turns; keep it so, or blend by source alpha.
- **Every extension optional, with a fallback.** The shaders use no
  `#extension`. The JS asks for:
  - `OES_texture_float_linear`: else the filtered tables are RGBA16F;
  - `EXT_color_buffer_half_float` or `EXT_color_buffer_float`: else the
    frames are RGBA8, and also if the framebuffer turns out incomplete;
  - `EXT_texture_filter_anisotropic`: else the wave map is filtered
    without it.
- **Patterns repeat in 256 km.** Anything read at `p.xz + uDrift` repeats a
  whole number of times in `WEATHER_KM` (see
  [design.md](design.md#conventions)).
- **Spheres at the eye's height: `eyeSphere`.** `raySphere` takes
  `dot(o, o) - r * r`, and at 6372 km a float steps by 4 km² there. For a
  sphere at or near the eye's own height, the crossing next to the eye
  then lands a hair ahead or behind it, ray by ray: from the base of the
  cirrus, rings and a disc of rays saw the whole sheet down to the sea.
  `eyeSphere` takes `c` from the heights and the near
  crossing from the far one. `highCloud` uses it.
- **Facts kept twice are changed together.**
  - The density profile, written out five times: `density()` in `fs`, and
    in the JS `buildDepths`, `buildMultiScatter`, `skyLuminance` and the
    depth table in `makeSky`.
  - The phase functions, Mie `g` = 0.8 included: `phases` in `fs` and
    `skyLuminance` in the JS.
  - The depth table: `DEPTH_MU`, `DEPTH_R` and `H_TOP` (1132.2544, from
    `RG` and `RT`) in `fs`; `NM`, `NR` and `H` in `makeSky`.
  - Constants in both the JS and `fs`: `RG`, `RT`, `HR`, `HM`, `BETA_M`,
    `MIE_EXT`, `NMU`, `NH`, `MS_MU_MIN`, `GRID`, `SLOTS`,
    `LN_FLUX_MAX`, `WEATHER_KM`, and `ISUN` (20, also in the JS's
    earthshine). `RG` is also in the `mean` shader.
  - The integer hash `ihash` (lowbias32): in the `noise`, `waves` and
    `fs` shaders.
  - The size of the noise, 128: `NOISE` in the JS; in `fs`, `TEXEL_KM`
    (`BASE_KM / 128.0`) and the cirrus's `T0`, `T1`, `T2`.
  - The size of the weather map, 1024: `WEATHER` in the JS;
    `WEATHER_KM / 1024.0` in `addSea`.
  - The wind's direction, towards (2, 1): in the `noise` shader (`pw`), in
    the `waves` shader (`WIND`, an angle) and in `fs` (`WIND`, a vector).
  - The cirrus's frame, along (3, 1) and across (-1, 3): in the `noise`
    shader and in `fs` (`CI_DIR`, `CI_UNIT`, and the `bend` in `ciDepth`).
- **Comments** are plain English sentences that say what and why. No
  commented-out code, no debug leftovers, no unused functions.

## Publishing

Every change goes through a pull request. The workflow
`.github/workflows/pages.yml` publishes the site on GitHub Pages from the
`gh-pages` branch:

- a push to `main` updates the root, https://sf624.github.io/sky/;
- a pull request from a branch of this repository gets a preview at
  `pr/N/`, linked in a comment when it opens. The preview follows every
  push, about a minute behind, and is removed when the pull request
  closes. Pull requests from forks get no preview.

The whole tree is published except `.git`, `.github` and `tools/`, so
`README.md` and `docs/` are on the site too.

## Licences

- The project is under the MIT licence (`LICENSE`).
- Use only material under MIT-compatible terms: MIT, BSD, Apache-2.0, CC0,
  or the public domain.
- Do not copy code from Shadertoy (its default licence is CC BY-NC-SA),
  from GPL projects, or from any source without a compatible licence.
  Write the code yourself from published ideas (papers, talks, articles),
  and name the source in a comment, as the code does (for example
  "after Hillaire (2020)").
- A piece of code or data by others may come in only under such terms.
  List it in `THIRD_PARTY_NOTICES.md`: a row of its table (the source, its
  version, its licence, where it sits) and its licence text with the
  copyright line, or the attribution or citation its terms ask for. Put a
  one-line comment at the code that names the source and points there.
  A formula or an idea from a paper or a talk needs only the comment.
- Reference photographs are for looking at only: nothing from them goes
  into the page.
- `THIRD_PARTY_NOTICES.md` lists the code and data by others in the
  repository, the star data from Wikidata (CC0) among them. Everything else
  is under the MIT licence.

### The star catalogue

The `stars` block of `index.html` is built by `tools/make-stars.py` (standard
library only):

    python3 tools/make-stars.py --cache wikidata-cache --index index.html

It asks the Wikidata Query Service for stars with a V magnitude of at most
6.5, their B magnitude and their classes, keeps real stars, merges double
entries and writes the six-byte format. The first run sends one request a
minute (about 70 requests, so more than an hour) and keeps every answer in
the cache directory. A second run with the same cache needs no network
(`--offline`) and gives the same bytes. `--table FILE` writes the chosen
stars as CSV; the column `estimate` marks the stars whose V is estimated.

The rule: every value comes from Wikidata. Nothing is copied from another
catalogue, and no star is added because another list has it. Stars that
Wikidata gives no V magnitude get an estimate from the same item's own
other bands (rules and tests in the script). The choices made by hand
(classes that are not stars, items dropped or kept) are data at the top of
the script, with their reasons.

## Plans and known flaws

They live in the [issues](https://github.com/sf624/sky/issues). Open one
for a follow-up rather than writing it here or in a comment.
