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
| `haze` | 0 to 6, 0.05 | 1 | Multiplier on the aerosol (an optical depth of 0.09 at 550 nm at 1, a clear day; see [The air](design.md#the-air)) |
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
| `expo` | none: the meter | The exposure, log2, held fixed (for tests: the tools compare a flight with a still at the exposure the flight ended with). `window.__exposure` reads the exposure of the last frame |
| `rate` | `960` | The speed of time while playing, a factor of real time: `1` (real time), `60`, `600`, `960` or `3600`. Other values are ignored |
| `play` | none | `1` starts playing at load |
| `timing` | none | Present (`?timing`): the loading prints its parts to the console as each ends, and every 5 s the programs it still waits for (see [design.md](design.md#from-the-address-bar-to-the-first-frame)) |
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
- On Windows (ANGLE on Direct3D 11) a program is compiled at link for one
  target, and again at its first draw into two or more, on the GPU
  process's main thread: the whole browser waits, and a long compile
  there loses the context (7d1a635's scene: 124 s at link and 121 s
  more at its first frame, measured; on the owner's browser,
  `CONTEXT_LOST_WEBGL` right then). So the large programs draw into one target: the
  scene writes its distance as the depth, the cirrus's pass its numbers
  as the bits of one target and the depth (see
  [design.md](design.md#from-the-address-bar-to-the-first-frame)). The
  ice program needs three targets: it is drawn once into a pixel of three
  as soon as it links (`warm`), and its second compile runs while the
  scene's programs still compile. `?timing` prints where the time goes;
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

Each frame of the hero is three draws: the scene (`fs`) into the frame
texture, `mean`, and `show`; at most every 100 ms a fourth, the
exposure `meter` (64 x 36 texels, 0.01 ms at 1920 x 1080, measured
November 2026; reading it back costs about 2 ms of the main thread here,
none of the GPU's); and a frame that needs a new map of the clouds'
shadow draws it first (see
[design.md](design.md#the-clouds-shadow)). The scene is nearly all of it. Measured on an
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
| `SHADOW` (JS) | 1024 | texels per side of the map: its cost and sharpness |
| `SHADOW_STALE` (JS) | 0.5 km | how far the aircraft flies before the map is drawn again |
| `SHADOW_K` (`fs`) | 40 km | where the map's texels are four times as wide as at the eye |
| `SHADOW_H` (`fs`) | 0.6, 1.3, 2.3, 3.5 km | the heights the map keeps a depth for |
| `SHADOW_DS` (`fs`) | 0.2 km | the length of a step along a line of the map (24 to 96 steps) |
| `SHADOW_ENC` (`fs`) | 4 | the depth at which the stored value is one half |
| `SHAFTS` (`fs`) | 16 | samples of the map along a view ray below the tops |
| `SHADOW_PEN` (`fs`) | 0.035 rad | the width of a shadow's soft edge on the sea, per km from the cloud |
| `SHADOW_OCC` (`fs`) | 1.5 km | the height that soft edge is measured from |
| `SHADOW_TAPS` (`fs`) | 8 | reads of the map per pixel of sea, for that soft edge |

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
    frames and the clouds' shadow map are RGBA8, and also if their
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
- **`fs` is three programs.** `makeSky` compiles it again with
  `SHADOW_MAP` defined: that `main` draws the clouds' shadow map with the
  same cloud field. A change to the field changes both. That program's
  uniforms are set apart (`S` in `makeSky`): a new uniform that the cloud
  field reads must be set there too. And with `CIRRUS_PASS` defined: that
  `main` draws the cirrus along each ray (`highCloud`) before the scene,
  which reads it (`cirrusLight`). It gets the scene's uniforms by name:
  the fixed ones (`C`, then `fixedFor`) and the view's (`view` in `draw`).
- **Loops in code that rarely runs get a bound the compiler cannot know.**
  The compiler unrolls a loop of constant bounds, and the unrolled code
  makes the whole shader heavier for the GPU even where a branch skips it:
  the moon's sparkles (`sparkle`, drawn only at night) cost 4.5 ms of 17 by
  day at 2560 x 1440 until their loops ran to `one`, a 1 the compiler
  cannot see (November 2026).
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
  keep such functions pure. Unrolling small loops did not help (the
  gather unrolled 180 s; every small loop of the cirrus's pass unrolled
  26 s against 21). In the whole scene, the bounds the compiler cannot
  know (`LONG_N`, `CI_N`) and vectors in place of arrays written at a
  loop's index (round 19 to 7d1a635) changed nothing measurable (162
  against 165 s). In the cirrus's pass alone, the march and the veil's
  octaves with constant bounds (as in round 19) took 15.3 s against 10.1:
  the cirrus's loops keep `CI_N`. `LONG_N` changed nothing (the scene 8.1
  s with it and without). Measure
  a change of `fs` there: `node tools/sky.mjs d3d programs --base
  origin/main` (see [tools/README.md](../tools/README.md#direct3d-11-on-windows)).
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
