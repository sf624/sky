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
becomes the middle of the range (`time=abc` gives 12). `alt` is the
exception: its slider is not even in km (see below), so the page reads it
itself, clamps it to the range and keeps it as given (to the metre); a
value that is not a number gives the default. `time` and `moon` are also
kept as given when they are in range (they run unrounded while playing, and the
debug overlay shows them so).

| Parameter | Range, step | Default | Meaning |
|---|---|---|---|
| `time` | 0 to 24, 0.05 | 15 | Time, hours, on the clock that `clock` names: local solar time (the sun is due south at 12 north of the tropics, due north south of them), or UTC |
| `date` | 1 to 365, 1 | today | Day of the current year (a UTC date on the UTC clock) |
| `moon` | 0 to 29.5, 0.5 | from the date | Age of the moon, days |
| `lat` | -90 to 90, 0.1 | 35 | Latitude of the observer, degrees, north positive |
| `lon` | -180 to 180, 0.1 | 135 | Longitude of the observer, degrees, east positive. Only the UTC clock uses it: at a given local solar time the sky is the same at every longitude |
| `haze` | 0 to 6, 0.05 | 1 | Multiplier on the aerosol (an optical depth of 0.09 at 550 nm at 1, a clear day; see [The air](design.md#the-air)) |
| `wind` | 1 to 15, 0.5 | 6 | Wind over the sea, m/s |
| `alt` | 0.3 to 40, any | 11 | Altitude of the eye, km. The slider is even in km (20 m a step) up to 13 km and even in log(h) above; the value beside it takes a number typed in m or km |
| `speed` | 0 to 3000, 50 | 900 | Speed, km/h. 0 stands still, and drawing stops once the picture is clean |
| `cloud` | 0 to 1, 0.01 | 0.5 | Amount of low cloud |
| `mid` | 0 to 1, 0.01 | 0 | Amount of middle cloud (altocumulus, altostratus; see [design.md](design.md#middle-clouds)). Nothing of it is compiled until it is over 0 |
| `cirrus` | 0 to 1, 0.01 | 0.4 | Amount of high, thin cloud |

These are read directly.

| Parameter | Default | Meaning |
|---|---|---|
| `yaw` | the sun's direction as a `yaw`, + 65 | Direction of view, degrees: 0 south, 90 west, -90 east. A larger `yaw` turns the view to the right (clockwise seen from above) |
| `pitch` | -8 | Elevation of the view, degrees, up positive. Not clamped (a drag clamps to 89) |
| `heading` | `yaw` - 60 | Direction flown at the start, degrees, as `yaw` (0 south, 90 west; the HUD shows it as a compass bearing, 180 more). The aircraft can turn from it (see [design.md](design.md#steering)) |
| `bank` | 0 | The aircraft's bank, degrees, right wing down positive, clamped to ±60. In flight it turns; at speed 0 it only tilts the view |
| `climb` | 0 | The aircraft's climb, degrees, nose up positive, clamped to ±15. In flight the altitude changes; at speed 0 it only tilts the view |
| `stick` | none | `1`: shows the steering stick, which otherwise shows only on a touch screen (`pointer: coarse`) |
| `hud` | stored choice, else off | `1`: shows the HUD, `0`: hides it (see [design.md](design.md#the-hud)). Not stored; the panel's switch and `H` store their choice |
| `at` | `0,0` | Starting place, `x,z` in km on the weather map (wrapped to 0 to 256) |
| `weather` | none | A weather of the panel's list, by its id: `clear`, `fair`, `mixed`, `overcast`, `cirrus`, `altocumulus`, `ac-cumulus`, `altostratus` (see `WEATHERS` and [design.md](design.md#weathers)). It sets `cloud`, `mid`, `cirrus`, `haze`, `wind`, the middle layer's record and the place; those parameters, given with it, win. `random` draws one from `seed`. Another value counts as none |
| `seed` | drawn at random | With `weather=random`: a whole number that gives the weather, its values and its place. Without it, the page draws a seed and adds it to the address |
| `pixels` | stored choice, else `wqhd` | The hero's drawing limit: `fhd`, `wqhd` or `4k`. Not stored |
| `enlarge` | on | `0`: the canvas stays as large as the picture at every level, and the browser stretches it to the screen, as before the page enlarged it itself at `high` and `max` (see [design.md](design.md#the-drawing-size)). For comparing on a screen finer than the drawing limit |
| `quality` | stored choice, else `auto` | The quality level: `low`, `mid`, `high`, `max` or `auto` (see [design.md](design.md#quality-levels)). A level that does not start falls back to the one below. Not stored. The tools add `quality=max` to every page they load, unless the query names a level |
| `lang` | stored choice, else the browser's language | The page's language: `ja` or `en`. Not stored |
| `sound` | stored choice, else `off` | Background sound: `off`, `airliner`, `airliner-whine` (the panel's "Near engines") or `wind`. Another value counts as none given. It starts at the first click or key press. Not stored |
| `volume` | stored choice, else 0.5 | Volume of the sound, 0 to 1 (clamped). Not stored |
| `res` | none: dynamic | 0 to 1: fixes the hero's drawing scale while it moves, relative to the canvas (0: dynamic). At rest it is drawn in full |
| `expo` | none: the meter | The exposure, log2, held fixed (for tests: the tools compare a flight with a still at the exposure the flight ended with). `window.__exposure` reads the exposure of the last frame |
| `rate` | `960` | The speed of time while playing, a factor of real time: `1` (real time), `60`, `600`, `960` or `3600`. Other values are ignored |
| `play` | none | `1` starts playing at load |
| `debug` | stored choice, else off | `1`: shows the debug overlay, `0`: hides it (see [Reporting a flaw](#reporting-a-flaw-with-the-debug-overlay)). Not stored; the `I` key stores its choice |
| `stats` | none | Present (`?stats`, or `stats=1`): a small overlay of what the hero costs on the device (frames a second, the GPU's time, the script's time by part of the frame, the level, the canvas and the sizes drawn, the first picture and when each part of the start ended, GPU memory, failures, the GPU's name), to read off a phone (see [design.md](design.md#quality-levels)). `stats=bench` also holds the drawing scale at 1, 0.71, 0.5 and 0.35 in turn and shows the frames a second at each; `stats=bench3` measures the frame with each part taken away and with each candidate cut, at full scale, by the frames a second (some 40 to 60 s after the first picture; touch nothing). `stats=0` is none |
| `timing` | none | Present (`?timing`): the loading prints its parts to the console as each ends, and every 5 s the programs it still waits for (see [design.md](design.md#from-the-address-bar-to-the-first-frame)) |
| `clock` | `solar` | `utc`: `time` and `date` are UTC, and `lon` places the observer (see [design.md](design.md#sun-moon-and-sky-in-the-js)). Anything else: local solar time |
| `now` | none | `1` does what the now button does: today's date, the present time and the moon's age for the date, playing in real time (on the UTC clock, the date and the time in UTC). It wins over `time`, `date` and `moon`; a `rate` given with it wins over real time |

With `date` and no `moon`, the moon's age follows the given date.

These are for tests only: they set the low layer's record (see
[design.md](design.md#low-clouds)), which no control sets yet. Their names
and ranges may change. The page clamps each to its range, and the depth
and the towers to what fits under the top of the low clouds' shell.

| Parameter | Range | Default | Meaning |
|---|---|---|---|
| `low.base` | 0 to 2.25 | 0 | km added to the level of the low clouds' bases (0.75 to 0.9 km at 0) |
| `low.depth` | 0.4 to 1.5 | 1 | A factor on the layer's depth; at most `(3.8 - low.base) / 1.8` |
| `low.form` | -1 to 1 | 0 | A bias on the amount that turns heaps into a sheet: -1 heaps at every amount, 1 a sheet |
| `low.smooth` | 0 to 1 | 0 | How even a sheet is: 0 cells (stratocumulus), 1 one even sheet with long swells (stratus) |
| `low.towers` | 0 to 1 | 1 | The share of the towers that grow; 0 with `low.base` over 0.1 |

Stratus, for tests: `cloud=1&low.form=1&low.smooth=1`, with `low.base` and
`low.depth` as they are (a base at 0.75 to 0.9 km, the lowest the shell
holds, and a sheet some 0.6 km deep, an optical depth of about 20). With
`cloud` from 0.6 to 0.9 the sheet has gaps. `low.depth=0.5` gives a thin
sheet, greyer from above and lighter from below.

The middle layer's record, likewise for tests (no control sets it; a
weather of the list sets it, and these win over the weather):

| Parameter | Range | Default | Meaning |
|---|---|---|---|
| `midform` | 0 to 1 | 1 | 0 a sheet (altostratus), 1 cells (altocumulus); between them both, each by its share |
| `midbase` | 5 to 9 | 5.2 | The layer's base, km |
| `middepth` | 0.1 to 2.5 | 1.2 - 0.8 `midform` | The layer's depth, km |
| `midrolls` | 0 to 1 | 0 | How far the cells stand in ranks of small elements |

The page keeps seven choices in `localStorage`: `sky.pixels` (the drawing
limit), `sky.quality` (the quality level chosen in the panel; none when
it is automatic), `sky.lang` (the language, set by the panel's language
select), `sky.sound` and `sky.volume` (the sound and its volume), and
`sky.hud` (`1` or `0`: the HUD, set by its switch and `H`) and `sky.debug`
(`1` or `0`: the debug overlay, set by `I`). The
address wins over all of them. With the automatic level it also keeps
`sky.qualityAuto`: the level reached and the highest it may step up to,
as JSON (`{"level":"mid","ceiling":"high"}`), and `sky.qualityTrying`:
a level that has started and not yet drawn for 10 s (see
[design.md](design.md#quality-levels)). Each is read and written inside `try`: without storage
the page works and forgets.

The page does not check `yaw` and `pitch`: a value that is not a number
makes them NaN (`params.get('yaw') * RAD`), and the camera with them.
`heading`, `bank`, `climb` and the parts of `at` fall back to 0.
`window.__flight()` returns the flight as it is (heading, eye, bank and
climb in degrees, altitude and place in km, the sun's direction and the
camera), for the tools; `window.__hud()` the HUD's anchor and horizon line as drawn, whether its
glass is in view and where its readouts are
(see [design.md](design.md#the-hud)). `window.__debug()` returns what the debug overlay shows
(below), on or off.

## Reporting a flaw with the debug overlay

A screenshot of a flaw does not say where the aircraft was, which way it looked or what the
sliders said. With `?debug=1` (or the `I` key, which keeps its choice like `H`), a block of
monospace text appears at the top left, over a dark backing, and the title is hidden. It shows:

- the build: the commit, and on a pull request's preview its number (`9041c58 PR #12`; `dev` on a
  local copy). The Pages workflow replaces the `dev` of `<meta name="build">` when it publishes;
- the GPU's name, the canvas's size in pixels and in CSS px, the device pixel ratio, the quality level
  drawn, the time between frames (smoothed; `at rest` when nothing is drawn) and the exposure (log2);
- the query line: every parameter that shapes the picture, with the values now (date, time, clock,
  `lat`, `lon`, `alt`, the place `at`, `yaw`, `pitch`, `heading`, `bank`, `climb`, `speed`, `cloud`,
  `mid`, `cirrus`, `haze`, `wind`, `moon`, `quality`, `pixels`, `hud`, `lang`, the middle layer's
  `midform`, `midbase`, `middepth` and `midrolls` where they are not their first values (a weather
  sets them), and `res` when it was given);
- a `Copy URL` button, which puts the whole address on the clipboard.

To see what a screenshot showed, type its query line after `?`, add `speed=0` (the line has the
speed flown at), and let the picture settle. The picture then matches the one that was flown to
within a few levels: the clouds' lighting of a settled flight and of a fresh load differ a little (see the `flight` check).
The exposure is metered afresh; the overlay shows the one in use, and `expo=` pins it. The size of the
canvas comes from the window and the device pixel ratio, which an address cannot set. While time
plays (`play=1`), the time shown is the one at that moment. `window.__debug()` returns `{ build, query,
url, renderer, canvas, css, dpr, quality, choice, frameMs, exposure }` for the tools. Off, the overlay
holds no element and does no work: the picture is the same.

## Judging a change

**The tools.** [`tools/`](https://github.com/sf624/sky/blob/main/tools/README.md) (in the repository, not on the site) does the checks below from
the command line, in headless Chrome on a fake clock: stills of a fixed
set of views against a base, the wrap, the loop, the drawing size, flight
against a still, and a GL trace that shows whether a change sends the
same commands to WebGL. For example
`node tools/sky.mjs check --base origin/main`.

**The look invariants.** `node tools/sky.mjs look` renders the views of
the flaws the owner reported (`tools/look.json`), one still each, and
measures each against absolute limits. No base is needed, so a flaw
that was merged once is still flagged afterwards. It takes about a
minute and a half on the GPU. Run it before pushing any change of
`index.html`, and put its lines (`PASS`, `FAIL`, `KNOWN`) and its last
line (`look: 9 PASS, 5 KNOWN, 0 FAIL at <commit>`) in the pull
request's description. `check` runs it first. A pull request that
changes the picture also carries the contact sheet of the registry,
before | after (`look --sheet --base origin/main`, one picture), with
what changed described in words, and shows it to the owner. It is a
local test: it needs a GPU to run in that time. The measures, and what
each cannot tell, are in
[tools/README.md](../tools/README.md#look-invariants).

**When the owner reports a flaw.** Add it to `tools/look.json` in the
pull request that fixes it:
- the view: the query line of the debug overlay (see above), as it was
  reported, with the date and one line of what was wrong;
- a measure of the flaw, on a region of the picture, with a limit;
- the proof: the measure fails on a commit with the flaw (`look --page
  <commit> --only <name>`) and passes on the fix, with a margin. Write
  both commits in the entry (`bad`, `fixed`) and the numbers in the pull
  request.

Where no measure separates the two, keep the view without measures: it
stays on the contact sheet. A flaw that is reported but not yet fixed
gets `expected: "fail"`: `look` reports it as `KNOWN` and does not fail.
Once it passes, `look` fails (`PASS?`) until the mark is removed. A limit
changes only on purpose, in a commit that says why.

**Reading a failure.** The line names the entry and each measure's value
and limit; a `!` marks the measures out of their limits. The stills are
in the folder printed at the end (`tools/out/look/…`, or `--out`).
Compare the still with one of the commit named in the entry's `fixed`.
`look --from DIR` measures the stills of a folder again without
rendering them.

**Stills.** The hero is a mean over frames, so one frame is noisy. For a
still, set `speed=0` and let it settle: after the last change it draws 39
frames and stops (`SETTLE + RELIGHT`, and the frame of the change), or
more while the exposure moves. From page load, step about 48 frames
before the screenshot: the first frame is only metered, and the next ones
may start the mean again (a restart if the drawing size grows). Hide the
overlays (`.title`, `.panel`, `.hint`, `.fs`) for a clean picture. The
canvas is made with `preserveDrawingBuffer`, so `canvas.toDataURL()`
reads what is shown.

**The exposure in tests.** The exposure follows the meter. Its blocks are
read back a fixed number of frames after they are drawn (`METER_LAG`),
not when a fence has passed, and the exposure adapts by the page's clock.
So a harness on a fake clock that steps frames gets the same exposure,
and the same frames, run after run, with no pause between frames.

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
fly across it, for example `?at=255.5,0&heading=90&speed=3000`. Fly a
turn too (`?bank=45&speed=300`), and a climb (`?climb=10&alt=3`): the
camera then rolls, and the eye moves up or down between frames.

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
- A program compiled after the start (the middle clouds') waits while
  the user looks on: compile it ahead where it takes seconds, without
  adding to the start's own compiling (see `ahead` in
  [design.md](design.md#middle-clouds)), and measure the wait with
  `node tools/sky.mjs d3d switch`.
- CPU work over a few ms is a job (a generator that yields every little
  while), run by `slices` at start and by `finish` later.
- GPU work at start goes in `batches`, with a fence after each.
- No `readPixels`, `getError` or `finish` that waits for the GPU while the
  page loads.
- On Windows (ANGLE on Direct3D 11) a program is compiled at link for one
  target, and again at its first draw into two or more, on the GPU
  process's main thread: the whole browser waits, and a long compile
  there loses the context (7d1a635's scene: 124 s at link and 121 s
  more at its first frame, measured; on the owner's browser,
  `CONTEXT_LOST_WEBGL` right then). So the large programs draw into one target: the
  scene writes its distance as the depth, the cirrus's pass its numbers
  as the bits of one target and the depth (see
  [design.md](design.md#from-the-address-bar-to-the-first-frame)). The
  ice program needs three targets, the air's table (`airProg`) seven
  (four where the GPU has fewer): each is drawn once into a pixel of as
  many as soon as it links (`warm`), and its second compile runs while the
  scene's programs still compile. Every draw of the air's table binds the
  same count of targets (spare layers fill the draws that write fewer):
  another count is another compile. `?timing` prints where the time goes;
  `node tools/sky.mjs d3d` measures it on Windows from WSL (see
  [tools/README.md](../tools/README.md#direct3d-11-on-windows)).

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

On Direct3D 11 (Chrome and Edge on Windows) the frame can grow where GL
shows nothing: Microsoft's compiler may fold or flatten a branch after a
harmless-looking edit, and the frame gets a fifth slower with the same
picture (see the GLSL rules). Before a pull request that changes what is
drawn is shown, run `node tools/sky.mjs d3dperf` on the owner's machine
(WSL with Windows Chrome; it skips elsewhere): six views, the branch
against `origin/main` in turns, some 7 minutes. Put its last line
(`d3dperf: 6 views, worst …`) in the pull request's description. A view
fails above 1.10 times main's frame time, the working limit for one pull
request; an `undecided` view is not a pass: run it again (`--views`,
`--rounds`). See
[tools/README.md](../tools/README.md#frame-time-on-direct3d-11-d3dperf).

Each frame of the hero is six draws: the first stage of the clouds'
light (the low clouds' pass, `fs` with `CLOUD_PASS` and `uStage` 0, a
quarter of the pixels), the cirrus's pass and the low clouds' (with
`CIRRUS_PASS`, `CLOUD_PASS`), the scene (`fs`) into the frame texture,
`mean`, and `show` (the passes only with their clouds; at `high` and `max`
on a canvas with more pixels than the picture, the two draws of `enlarge`
instead of `show`); at most every 100 ms a
fifth, the exposure `meter` (64 x 36 texels, 0.01 ms at 1920 x 1080, measured
November 2026; reading it back costs about 2 ms of the main thread here,
none of the GPU's); and a frame that needs a new map of the clouds'
shadow draws it first (see
[design.md](design.md#the-clouds-shadow)). The two draws of `fs` are
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

`enlarge`, measured in November 2026 (`perf --dpr 1.5`, 2560 x 1318 CSS
pixels, flying, the overcast deck): from a picture of 2676 x 1378 to a
canvas of 3840 x 1977, 0.23 ms for the enlargement and 0.11 ms for the
sharpening, where `show` took 0.03 ms. On Direct3D 11 (`d3d page`, a
window of 3840 x 2160 with `pixels=fhd`, three runs each, alternated), a
frame took 18.3 to 18.5 ms enlarged to 3818 x 2062 and 18.1 to 18.5 ms
with `enlarge=0`: within the noise.

Measured again at 2560 x 1440 (`perf`, `res=1`, flying, three runs, the
scene's median) in November 2026: the default view by day (`date=172&time=15`)
12.5 ms, a full moon over clouds (`date=80&time=0&moon=14&cloud=0.5&pitch=-10&yaw=0`)
13.8 ms. The night work had taken them to 17.0 and 19.0 ms (the sparkles'
unrolled loops, see the GLSL rules); before it they were 12.4 and 13.5 ms.

At 1905 x 1080, the scene without low clouds (`cloud=0`) took 2.8 ms,
without cirrus (`cirrus=0`) 5.6 ms, and without either 2.5 ms. So in the
default view the low clouds take about half of the scene; the air, the
sea and the sky take most of the rest; the cirrus costs little. Close over
the clouds (`alt=3&cloud=0.7`) the scene took 4.5 ms.

The clouds' shadow, measured on the same GPU at 2560 x 1440 (`res=1`,
flying) in November 2026, after the exposure and haze of round 10: three
runs each, alternated with main, medians of the scene's GPU time:

| View | Scene before | Scene after | Shadow map, per draw |
|---|---|---|---|
| Cruise (the defaults) | 12.4 to 12.7 ms | 13.0 to 13.2 ms (+0.55) | 0.71 ms |
| 4 km, low sun (`alt=4&cloud=0.6&date=320&time=16.5&yaw=61.2&pitch=-5`) | 10.2 to 10.4 ms | 11.5 to 11.6 ms (+1.2) | 1.44 ms |
| Under the base (`alt=0.3&cloud=0.7&date=320&time=15.5&yaw=51.2&pitch=4`) | 15.5 to 15.7 ms | 15.9 to 16.0 ms (+0.35) | 1.27 ms |
| `cloud=0` | | the same picture and the same draws | not drawn |

Of that, the soft shadow on the sea (`seaShadow`, eight reads of the map
per pixel of sea) is about 0.12 ms in the 4 km view.

In flight the map is drawn every 0.5 km (every 2 s at 900 km/h): it adds
next to nothing to the mean. A frame whose light, altitude or cloud
amount changes draws it, so a time-lapse or a moving slider pays it on
every frame. Its cost follows `SHADOW` squared and its steps (24 to 96,
more for a low light); the scene's share is the `SHAFTS` samples.

The numbers to tune, all in `index.html`:

| Name | Value | What it sets |
|---|---|---|
| `SHADOW` (JS) | 1024 | texels per side of the light's map: its cost and sharpness |
| `COLUMN` (JS) | 512 | texels per side of the map of the columns (straight up) |
| `SHADOW_STALE` (JS) | 0.5 km | how far the aircraft flies before a map is drawn again |
| `SHADOW_K` (`fs`) | 40 km | where the maps' texels are four times as wide as at the eye |
| `SHADOW_N` (`fs`) | 16 | the heights a map keeps a depth for, every 275 m from `CB` (four to a layer) |
| `SHADOW_DS` (`fs`) | 0.2 km | the length of a step along a line of the map (24 to 96 steps) |
| `SHADOW_ENC` (`fs`) | 4 | the depth at which the stored value is one half |
| `SHAFTS` (`fs`) | 16 | samples of the map along a view ray below the tops |
| `SHADOW_PEN` (`fs`) | 0.035 rad | the width of a shadow's soft edge on the sea, per km from the cloud |
| `SHADOW_OCC` (`fs`) | 1.5 km | the height that soft edge is measured from |
| `SHADOW_TAPS` (`fs`) | 8 | reads of the map per pixel of sea, for that soft edge |

Those numbers are older than the detail of the low clouds near the eye
(#33, November 2026), which trades time for the picture. Flying, `res=1`,
the scene in ms at 2560 x 1440 (both stages; main in brackets, one stage),
median of two runs, 18 November 2026, round 13 of #33 on main 005ecb2:

| View | 2560 x 1440 |
|---|---|
| Default (cruise) | 22.0 (18.0) |
| `alt=2&cloud=0.7` | 30.2 (16.4) |
| Tops from 4.6 km (`alt=4.6&cloud=1&time=15&date=321&pitch=-15`) | 14.4 (12.9) |
| Among clouds at 1.8 km (`alt=1.8&cloud=0.7&time=13&date=172&pitch=0&yaw=100`) | 28.0 (15.1) |
| Under a deck at 0.6 km (`alt=0.6&cloud=0.78&time=17&date=319&yaw=130&pitch=25`) | 26.3 (17.8) |
| 5 km, looking down 20 degrees (`alt=5&cloud=0.8&date=321&pitch=-20`) | 19.1 (14.2) |

Round 12 (the 3D body of heaps) took 33.3, 60.2, 35.1, 56.3, 39.3 and 43.4
ms in the same views on its own main (06d2cad), and a third more rebased
on this one.
Round 13 kept its picture and took half the time, where it went:

- The clouds' light was worked out inside the march's loop, and each
  pixel of a group the GPU runs together that met a cloud at another step
  made the others wait through its light in turn. It is worked out after
  the loop now: the first stage took a third of the time (17.5 to 5.8 ms
  at `alt=2`), the same picture.
- Along outlines, a few pixels whose first-stage texels had met another
  cloud worked their light out in full and made their whole group wait
  (12 ms at `alt=2`). They take the best of the twelve texels round
  those now.
- Rays marched clear air in steps of at most 60 m near the eye. Above the
  tops of `uTops` they stride down to them; the second stage starts each
  ray at the nearest cloud that the first stage's rays round it met, and
  skips the march where none of them met any (see design.md).
- What was worked out before the march (the cirrus, the phases) was held
  in registers through it, and fewer pixels ran at once. Code that is
  never run counts too: a search of sixteen texels in the second stage
  made the first stage 5 ms slower. Round 12 rebased on main with the
  night's work took a third longer for that alone.
- The moved weather map (`WARP`) cost a read that the next two waited for
  on every step; it is made once per amount of cloud (`uWarped`).

Round 20 of #33 (19 November 2026, on main f2b0707) measured where the
time of the clouds goes, with debug builds that leave one term of their
light out or make it a constant (2560 x 1440, `res=1`, flying, mean of two
runs; the first stage at half size, then the second):

| View | Both stages | All the light's marches | Of which: second stage's fallback |
|---|---|---|---|
| `alt=2&cloud=0.7` | 4.5 + 32.8 ms | 6.1 ms | 3.5 ms |
| Among clouds at 1.8 km | 4.3 + 29.5 ms | 5.0 ms | 2.6 ms |
| Under a deck at 0.6 km | 7.8 + 22.6 ms | 2.5 ms | 0.9 ms |
| Cruise | 3.3 + 15.3 ms | 0.8 ms | 0 ms |

So the march to the clouds and through them is most of it (some 28 ms at
`alt=2`), not their light: the light's steps cost a fifth at most, and
most of that in the second stage, where a few pixels along outlines work
their light out in full (the fallback) and make their group wait. Each
term alone (the depth towards the light, the sky's, the depth behind,
the column, the first two fine steps) is 1 to 2 ms there. Round 20
replaced the marched columns (`overhead`) and the far part of the depth
behind by the depth maps (see design.md), which took 1 to 2.6 ms off:

| View | main | round 16 | round 19 | round 20 |
|---|---|---|---|---|
| Default (cruise) | 13.2 | 22.6 | 18.5 | 17.4 |
| `alt=2&cloud=0.7` | 11.6 | 34.2 | 36.4 | 34.1 |
| Tops from 4.6 km | 9.6 | 14.6 | 17.7 | 16.8 |
| Among clouds at 1.8 km | 10.8 | 32.7 | 33.6 | 31.2 |
| Under a deck at 0.6 km | 12.5 | 26.4 | 30.8 | 29.0 |
| 5 km, looking down 20 degrees | 11.1 | 20.6 | 22.2 | 20.7 |
| 4 km, `cloud=0.8&time=12&pitch=-15` | 11.9 | 22.0 | 22.6 | 21.0 |

(One run each, the same session; others share the GPU, and a second
session gave 1 to 1.7 ms between rounds 19 and 20.) A layer of the light's
map takes 0.4 to 1.2 ms (median), the lowest up to 2.9 ms, as the whole
map of round 19 did; the column's 0.1 to 0.2 ms. In flight one layer is
drawn a frame, four every 0.5 km of each map; a change of the light (the
time-lapse) draws the light's four layers in one frame, some 4 to 5 ms
(round 19: 1 to 3 ms), and a change of the cloud amount both maps.

Round 21 (19 November 2026, on main a257ec2, whose cirrus is a pass of
its own) moved the low clouds into a pass of their own (`CLOUD_PASS`) to
start on Direct3D 11; the frame costs the same as round 20 rebased there
(2560 x 1440, `res=1`, flying, one run each, ms; main a257ec2 in
brackets): cruise 21.0 (16.0), `alt=2` 37.0 (14.0), tops from 4.6 km
20.0 (11.7), among clouds at 1.8 km 34.6 (13.5), under a deck 33.3
(16.6), 5 km looking down 23.3 (12.4), 4 km 23.5 (13.4); round 20 on its
own main took 1.5 to 4.3 ms less, as main's cirrus does there. The first
picture comes 6.9 to 7.2 s after navigation (main 4.9 s, round 20 on its
main 6.1 s, rebased 7.6 to 7.8 s).

The cirrus's map, ice and way are built once, by their own program
(`ice`), during the loading (or when cirrus is first shown, if the page
starts without it). Measured with `perf` at 1920 x 1080 on the RTX 3090 on
2026-11-18 (round 13 of the cirrus), two runs each, alternated: the first
picture came 5.25 to 5.33 s after navigation with `cirrus=0.5`, as round
12 (5.25 to 5.32 s), against 3.69 to 3.84 s for `main`; with `cirrus=0`,
4.33 to 4.39 s against round 12's 4.47 to 4.53 s and `main`'s 3.59 to
3.77 s (the ice program is then not compiled, but the scene's program
holds the cirrus's code). Round 16 (the stirred frame, the erosion,
the sheets' turned cells, frayed heads and broken strands) made the ice
program larger: the first picture with `cirrus=0.5` came 0.75 s later
than round 15's. Most of that was not the GPU's time (without the ice's
work, the first picture came only some 0.15 s sooner) but the driver
finishing the larger program: its three calls of `iceSystems` and two
of `iceStrands` were each a copy, and every loop was unrolled. Round 17
calls each once and keeps the ice's loops as loops (`ICE_N`); measured
on 2026-11-18, two runs each, alternated, all on main f2b0707 except
round 15 (on 0d4e736), at 1920 x 1080: the first picture with
`cirrus=0.5` came 5.41 to 5.73 s after navigation, against round 16's
6.78 to 6.85 s, round 15's 5.79 to 6.08 s and main's 3.91 to 3.93 s
(the machine was some 0.4 s slower that hour than in the morning); the
frame took 8.76 to 8.79 ms at the default view (round 16: 8.79 to
8.83), 9.95 to 10.01 ms just under the shell (round 16: 10.36 to 10.43,
round 15: 9.98 to 10.05) and, at 2560 x 1440 at the cruise view
(`date=319&at=150,90`), 15.61 to 15.67 ms (round 16: 15.57 to 15.62,
main 13.70 to 13.71). Round 18 (the depth a low sun's light meets read
towards the sun: one more `lite` read of both decks, where the sun is
under some 30 degrees), measured the same day against round 17 and main
in the same hour, two runs each: the first picture with `cirrus=0.5`
4.93 to 4.97 s (round 17: 5.00 to 5.01, main 3.46); the frame 8.93 to
8.94 ms at the default view (8.82 to 8.84; main 7.78), 10.14 to 10.15 ms
under the shell (10.02 to 10.06; main 5.00 to 5.07), 15.78 to 15.82 ms
at the cruise view at 2560 x 1440 (15.66 to 15.70; main 13.72 to
13.77), and at dusk 7.50 to 7.52 ms from the ground and 9.31 to 9.34 ms
from 11 km (7.34 to 7.37 and 9.17 to 9.21). Round 19 (the turning wind,
`ciWarp`, read at every place the cirrus is read, and where the cirrus
and its tails gather, `ciGather`, once per deck and pixel), measured the
same day against round 18 and main in the same hour, two runs each: the
first picture with `cirrus=0.5` 5.38 to 5.48 s (round 18: 4.95 to 5.03;
main 3.48 to 3.50) and with `cirrus=0` 4.51 to 4.63 s (4.10 to 4.12);
the frame 9.53 ms at the default view (8.87 to 8.94; main 7.71 to
7.73), 11.67 to 11.80 ms under the shell (10.07 to 10.12; main 5.00 to
5.07) and 16.78 to 16.82 ms at the cruise view at 2560 x 1440 (15.79 to
15.82; main 13.72 to 13.75). Gradient noise of some 128 and 51 km for the
turning wind took the frame under the shell to 17.3 ms and the first
picture to 7.5 s: four shear waves (`CI_WAVES`) replaced it. The loops
with bounds the compiler cannot know (`LONG_N`, the cirrus's march)
changed nothing here, measured on 2026-11-19 against round 19,
two runs each: the same stills and GL trace, the frame 15.1 to 15.4 ms at
the default view at 2560 x 1440, 20.3 to 20.4 ms under the shell and 16.7
to 16.8 ms at the cruise view, and the first picture 5.6 to 5.7 s at 1920
x 1080 (Mesa did not unroll those loops). The cirrus's own pass
(`CIRRUS_PASS`), measured on 2026-11-19 against 7d1a635 at 2560 x 1440,
two runs each, the pass and the scene together: the frame 15.1 to 15.2 ms
at the default view (15.2 to 15.3), 18.5 to 18.7 ms under the shell
(20.3 to 20.4) and 16.5 ms at the cruise view (16.7), and the first
picture 5.6 to 6.4 s (6.6 to 7.0). The machine's times drift by several tenths
from run to run and with other work on the GPU. The cirrus's loops are
kept from being unrolled (`CI_N`; unrolled, the driver took some 0.6 s
more to finish the scene's program). Each call of `ciDensity` is a copy,
so the march, the second read of a long crossing and the depth the sun's
light feels (`cirrusDepth`) read it `lite`; the mean age and the strands'
phase are drawn as further targets of the ice's own pass. The scene takes
8.8 ms a frame at 1920 x 1080 with `cirrus=0.5` at the default view
(round 12: 9.1; `main` 7.7), and 9.0 ms just under the shell looking up
(`alt=11.9&pitch=28&cirrus=0.6`; round 12: 14.3, round 11: 7.6): the
hairs are three reads of a texture (`uIcePhase`) where round 12 drew
explicit strands on two ways in three octaves. Most of the rest is not the building
(some 0.25 s of GPU time for the ice) but the driver finishing the large
ice program at its first draw (about 0.3 s); it was 1.7 s while the ice
was part of the `noise` program, which every page draws. A renderer
without a GPU builds the textures a quarter as wide (see
[design.md](design.md#cirrus)). Views with `cirrus=0` build nothing.

On a slower GPU, when frames take longer than 40 ms (25 frames a second),
the dynamic resolution draws a smaller picture while the view moves, down
to 0.35 of the canvas per side (see
[design.md](design.md#the-drawing-size)).

**By quality level** (see [design.md](design.md#quality-levels)). Measured
on the RTX 3090 on 2026-11-19 with `perf` (`res=1`, flying, the default
view, on main 52edce9; the mean GPU time of all draws per frame shown,
two runs each). At 2560 x 1440 each level draws its own canvas; "all
pixels" draws every level at 2560 x 1440 (its `pixels` and `dpr` lifted
for the measure), the cost per pixel that `cost` in `QUALITY` holds.
The phone is 412 x 915 CSS pixels at a device pixel ratio of 2.6 (`perf
--size 412x915 --dpr 2.6`).

| Level | 2560 x 1440 window | all pixels (2560 x 1440) | phone |
|---|---|---|---|
| `low` | | 2.9 to 3.3 ms (the frame at 1280 x 720) | 1.5 ms (368 x 816; the frame 184 x 408) |
| `mid` | | 4.3 to 4.4 ms (the frame at 1280 x 720) | |
| `high` | 12.9 ms (1920 x 1080) | 21.0 ms | 7.6 ms (824 x 1830) |
| `max` | 21.9 ms (2560 x 1440) | 21.9 ms | 8.0 ms (824 x 1830) |

(`low` and `mid` measured on 2026-11-19 before `low` left out the
cirrus's march near the eye and its shadows; before the frame was drawn
at half size, `low` took 7.0 ms for all pixels and 2.7 to 3.2 ms at the
phone's size, `mid` 9.1 ms.)

Small canvases keep this GPU busy for only part of a draw: at 0.3 million
pixels the old `low` took 2.7 ms, where its cost per pixel at 3.7 million
gave 0.6 ms. A phone's GPU, some fifty times slower, is busy throughout, so
its time follows the cost per pixel more than this GPU's at the same
size: compare levels by the column "all pixels". The first picture comes
some 7 s after navigation at every level on this machine, most of it the
driver finishing the programs at their first draws; on Direct3D 11 (`d3d
page`, 1898 x 982, one run each, before the last cuts) `low` 13.2 s, `mid`
17.2 s, `high` 17.1 s, `max` 18.5 s.

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
- **Precision stated in every shader.** Each fragment shader starts with
  `precision highp float;`, `precision highp int;` and `highp` for each
  kind of sampler it reads. Desktop GPUs compute everything at full
  precision, but in a fragment shader of OpenGL ES the default for `int`
  and `uint` is `mediump` (16 bits are allowed: the integer hash
  `ihash`, the bits packed into the passes' targets) and for
  `sampler2D` `lowp`, and phones' GPUs may take them at their word.
- **Every extension optional, with a fallback.** The shaders use no
  `#extension`. The JS asks for:
  - `OES_texture_float_linear`: else the filtered tables are RGBA16F;
  - `EXT_color_buffer_half_float` or `EXT_color_buffer_float`: else the
    frames and the clouds' depth maps are RGBA8, and also if their
    framebuffer turns out incomplete;
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
  - The density profile: `densities()` in `fs`, and in the JS
    (`boundaryLayer`, `mieUp`, `mieDensity`) for `buildDepths`,
    `buildMultiScatter` and the depth table in `makeSky`.
  - The depth table: `DEPTH_MU`, `DEPTH_R` and `H_TOP` (1132.2544, from
    `RG` and `RT`) in `fs`; `NM`, `NR` and `H` in `makeSky`.
  - Constants in both the JS and `fs`: `RG`, `RT`, `HR`, `HM`, `BETA_M`,
    `MIE_EXT`, `MIE_PHASE`, `MIE_G_UP`, `NMU`, `NH`, `MS_MU_MIN`, `GRID`, `SLOTS`,
    `LN_FLUX_MAX`, `WEATHER_KM`, and `ISUN` (20, also in the JS's
    earthshine). `RG` is also in the `mean` shader.
  - The integer hash `ihash` (lowbias32): in the `noise`, `ice`, `waves`
    and `fs` shaders.
  - The layout of the cirrus's textures (the ice's four kinds in RGBA;
    the way as the gradient at twice its angle, and the ice's mean age
    with its weight; the map's channels):
    `iceField`, `iceWay`, `iceFibres` and `ciMap` in the `ice` shader,
    `ciDensity` in `fs`.
  - `WEATHER_KM` and `ICE_KM`: in the `ice` shader too.
  - erf after Winitzki: `iceErf` in the `ice` shader, `ciPhi` in `fs`.
  - The size of the noise, 128: `NOISE` in the JS; in `fs`, `TEXEL_KM`
    (`BASE_KM / 128.0`).
  - The size of the weather map, 1024: `WEATHER` in the JS;
    `WEATHER_KM / 1024.0` in `addSea`.
  - The wind's direction, towards (2, 1): in the `noise` shader (`pw`), in
    the `waves` shader (`WIND`, an angle) and in `fs` (`WIND`, a vector).
  - The cirrus's frames, along (3, 1) and across (-1, 3) for the upper
    deck, along (1, 1) for the lower: in the `ice` shader (the bands of
    `ciMap`, and `ICE_KM`, half a unit of the upper frame) and in `fs`
    (`ciTile`).
- **One flat loop over a neighbourhood.** On Mesa's D3D12 driver (WSL),
  two nested loops over the cells around a point (`for i in -2..0`, `for j
  in -1..1`) came out wrong: the cirrus's streaks were cut along the
  cells' edges, where the same sum written as one loop over nine cells
  was right, and SwiftShader got both right. The code keeps one loop
  over a neighbourhood where it needs one.
- **No `mod()` for a lattice that wraps.** On the same driver, `mod(x, p)`
  of a whole number `x` equal to `p` gave `p` in places, not 0, and the
  cirrus's noise had a seam along that lattice line. `iceNoise` and the
  heads' cells in `iceSystems` and the strands' cells in `iceSheets`
  wrap by hand,
  `c - p * floor((c + 0.5) / p)`.
- **`fs` is six programs.** `makeSky` compiles it again with
  `CLOUD_PASS` defined: that `main` draws the low clouds along each ray
  (`clouds`, both stages of their light) before the scene, which reads
  them; with `SHADOW_MAP`: the clouds' depth maps (the shadow and the
  columns) with the same cloud field; with `TOPS_MAP` (the map of the
  tops). A change to the field changes all
  of these, and the scene's (the sea reads it). The depth maps' program
  has its uniforms set apart (`S` in `makeSky`): a new uniform that the
  cloud field reads must be set there too. With `CIRRUS_PASS`: the cirrus
  along each ray (`highCloud`) before the scene, which reads it
  (`cirrusLight`); with `SKY_LIGHT`: the sky's light on the clouds. The
  passes and `SKY_LIGHT` get the scene's uniforms by name: the fixed ones
  (`C`, then `fixedFor`) and the view's and the frame's (`view` in
  `draw`); `TOPS_MAP` gets the fixed ones too. Set a fixed uniform of `fs`
  with `C`, never on `prog` alone. (From #113 on, the map of the tops set its
  textures' units by hand and left out the noise's until fixed: it read the
  heaps' discs from unit 0, stood too low, and the march strode through
  every heap above the smallest domes.)
- **Loops in code that rarely runs get a bound the compiler cannot know.**
  The compiler unrolls a loop of constant bounds, and the unrolled code
  makes the whole shader heavier for the GPU even where a branch skips it:
  the moon's sparkles (`sparkle`, drawn only at night) cost 4.5 ms of 17 by
  day at 2560 x 1440 until their loops ran to `one`, a 1 the compiler
  cannot see (November 2026).
- **A branch that changes nothing at its bound gets a bound the compiler
  cannot know (`UNSEEN`).** Microsoft's compiler (below) knows that a share
  made by `smoothstep` lies from 0 to 1. Where a branch's terms mix to
  nothing at its bound (the sheet's in `cloudShape`, `mix(cells, shape,
  form)` skipped at a form of 1), it drops the test and runs the branch
  everywhere: every read of the heaps' field read the sheet's noise too,
  and the first stage of the clouds took a quarter longer on Direct3D 11
  than with the test kept (#113, November 2026). GL kept the branch. Other
  compilers may fold such a test differently too: `UNSEEN` changed no
  picture there, while the same on the test for `all` moved some 150 pixels
  of a still by up to 17 levels, and was left out then. The test for
  nothing but heaps (`all`, the form at 1) is such a test too. Until #117
  a term from the weather map stood in it and hid it from the compiler;
  without that term the sheet's noise was read at every read of the field
  again, and the frame of the default view took a fifth longer on
  Direct3D 11 (18.4 against 15.3 ms at 1898 x 982) while GL showed 5 %.
  With `UNSEEN` it is 15.9 ms, and a few pixels of a still on GL move by
  up to 4 levels. So measure a change of the field on Direct3D 11 as well
  (`d3dperf`, the page against main in turns): GL does not show what its
  compiler folds. A value given to the field from outside is the same
  trap: the layer's form set in a branch on a uniform (`if (uLow.z >= 0.0)
  a.form = uLow.z`) took the frame over a deck to 1.05 times main's on
  Direct3D 11 (11.70 against 11.19 ms, `overcast` of `d3dperf`), alone of
  six such edits; as a bias inside the form's `smoothstep` it costs
  nothing measurable (1.007). Taken out again in a copy of 9de3e45, the `UNSEEN` of
  `all` cost 1.30 times main's frame among the heaps at 3 km, 1.18 inside
  the cirrus at 12.5 km and 1.08 in the default view (1898 x 982,
  2026-11-24).
- **A factor of 0 does not keep the picture.** A term that a uniform
  switches off at the page's defaults (`x += even * jitter`) still changes
  what the compiler makes of the code round it. Three cases, on this
  machine's GL (the stratus step of #84): a second `hash(gl_FragCoord.xy + 7.13 * uPass + c)`
  beside the light's own moved that one's value in its last bit, and a
  few pixels of the default still by up to 8 levels; with another
  argument (`gl_FragCoord.yx + 9.37 * uPass + c`) the still is main's.
  A second use of the heaps' noise (`sn`, `sm`) in the sheet's branch
  moved a still by 2 levels (written another way, `1 - (1 - r) / (2 -
  w)`, it does not), and so did the sheet's relief as `mix(cells, swells,
  smooth)` in place of two terms with their own factors.
  So check every view against main after such an edit (`check stills`),
  and change one expression at a time when it fails.
- **Each program small enough for Microsoft's compiler.** ANGLE on
  Direct3D 11 (Chrome and Edge on Windows) gives each program to
  Microsoft's HLSL compiler (FXC), which inlines every call: each call of
  a function is a copy. Its time grows far faster than the program.
  Measured on the owner's machine (RTX 3090, 2026-11-19; `D3DCompile` of
  ANGLE's HLSL, timed alone): main's scene 7.8 s; the scene with the
  cirrus of round 19 162 s, of 7d1a635 165 s; that scene without the
  cirrus 11.8 s, the cirrus alone (its pass, as below) 27.3 s. So the
  cirrus is a program of its own (`CIRRUS_PASS`), compiled beside the
  scene's at once: with the changes below, 11.0 and 8.4 s. A new call of a large function (`ciDensity`, `ciHair`,
  `cirrusDepth`) in either program shows as seconds there: make it in a
  loop that already makes it (as the scene reads the clouds' and the
  sea's shadows and the glare's depth in one loop: 13.7 s with three
  calls, 8.4 s with one), or in the other program. Measured on the scene
  of 7d1a635 (165 s): its flat reads as a loop the compiler cannot unroll
  133 s (one copy of their body, not two); the last place and warp kept
  from call to call in globals (`ciPlace`, `ciWarp`), removed, 105 s;
  both 57 s. Global state that many copies read and write costs much:
  keep such functions pure. It costs at run time too: a global that a
  call may leave as it was is kept from call to call through every loop
  that reads the field. Set at every call of `cloudShape`, the heaps'
  (#113) took the frame under heaps at 0.3 km on Direct3D 11 from 39.5 to
  31.6 ms (main 31.8). Unrolling small loops did not help (the
  gather unrolled 180 s; every small loop of the cirrus's pass unrolled
  26 s against 21). In the whole scene, the bounds the compiler cannot
  know (`LONG_N`, `CI_N`) and vectors in place of arrays written at a
  loop's index (round 19 to 7d1a635) changed nothing measurable (162
  against 165 s). In the cirrus's pass alone, the march and the veil's
  octaves with constant bounds (as in round 19) took 15.3 s against 10.1:
  the cirrus's loops keep `CI_N`. `LONG_N` changed nothing (the scene 8.1
  s with it and without). No loop whose bound the compiler cannot know
  writes an array at its index: FXC must unroll a loop that writes an
  array at an index it cannot know (its warning X3550), and cannot unroll
  one whose bound it cannot know (error X3511). Write a vector instead
  (ANGLE turns a vector's index into a switch). Several loops in the
  clouds' march, each with its read of the field (the sky's two
  directions, `tauB`, the light's steps), stopped the compiler with that
  error (X3511, on the march's loop) in round 20 of #33; one loop with
  one read compiles. A program reads at most 16 textures there
  (`MAX_TEXTURE_IMAGE_UNITS`; the scene of round 20 rebased on the
  cirrus's pass read 20 and did not link): pass a map to a function as an
  argument (`mapDepth`) so that a program counts only the maps it reads,
  and keep what passes hand on in layers of one texture (`uPasses`).
  Round 21 of #33 (2026-11-19, `d3d programs`, link in s): the scene 7.4
  to 8.2, the low clouds' pass 3.9 to 4.7, the cirrus's pass 8.5 to 8.6,
  `SKY_LIGHT` 2.6 to 2.7 (5.7 more in the scene's program, timed alone
  with FXC), `TOPS_MAP` 1.3 to 1.4. The GPU process compiles
  several at once, and the first picture waits for their sum more than
  for the longest. The heaps of #113 (November 2026) made the field
  longer; each read of it is a copy, so the light's steps and the four
  reads of the mirror are each one loop with one read, and the map of the
  tops searches all its heights in one loop (four calls of the search,
  each with five calls of the field, had made it link in 0.8 s with the
  heaps, against 0.2 to 0.3 s now). One loop is not always the faster
  frame, though: the 8 steps of the way to the shadow's map past the
  light's steps, as 8 more steps of the light's loop (#113), made the
  clouds' pass link in 5.0 s alone against 6.9 s with a loop of their
  own, but the frame over a deck took 14 % longer on Direct3D 11 (12.8
  against 11.2 ms, `overcast` of `d3dperf`), 6 % under the moon and 3 %
  among heaps, where those steps read nothing with the sun high. GL did
  not change (9.8 against 9.7 ms), nor did FXC's code of the loop much
  (some 25 instructions of 890): the cost comes later, in the driver. So
  they are a loop of their own again; the first picture comes 0.5 to
  1.7 s later (`d3d page`, three runs each: 13.9 to 16.6 s against 13.4
  to 14.9 s). Weigh such a merge with `d3dperf` as well as `d3d programs`. Measure
  a change of `fs` there: `node tools/sky.mjs d3d programs --base
  origin/main` (see [tools/README.md](../tools/README.md#direct3d-11-on-windows)).
- **A cost of `fs` that a quality level changes is a `Q_` define** at its
  top, whose default is `max`'s value; `QUALITY` in the JS gives the lower
  levels' values (see [design.md](design.md#quality-levels)). So `max` compiles to
  the code it was before there were levels (but for the air's table, which
  `airLut` sets at `low`, `high` and `max`), and a new knob is one line in
  each place. Compare a change at `max` (the tools' default) and at `low`.
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
