# Tools

Tools that test the page in headless Chrome. They prove that a change leaves the picture as it was, or show how it changed. They are not part of the site: the Pages workflow leaves `tools/` out.

What to look at in a change, and why (stills, flight, the wrap, GPU time), is in [docs/development.md](../docs/development.md#judging-a-change). This file says how the tools do it.

`make-stars.py`, which builds the star catalogue, is described in [The star catalogue](../docs/development.md#the-star-catalogue). Everything else here is about testing.

They need Node 22 and a Chrome or Chromium. There is no npm dependency and no Python.

```sh
node tools/sky.mjs check --base origin/main     # every check, this tree against main
node tools/sky.mjs help                         # all commands and options
```

## Commands

Every command that loads the page takes `--page DIR`: the directory that holds `index.html`. The default is this repository. A local server serves it (no cache, the right MIME types for `.js`, `.mjs`, `.css`, `.glsl`, `.bin`), so pages that load modules and shader files work too.

Output goes to a folder of its own for each run, under `tools/out/` (ignored by git): `tools/out/check/<time>-<pid>/`, for example. `--out` names another place.

`--base` takes a directory, or a git revision of this repository (`origin/main`, `HEAD~1`, a SHA). A revision is exported with `git archive` into a temporary directory, which is deleted at the end.

| Command | What it does |
|---|---|
| `trace [--view NAME \| --q QUERY] [--frames N] [--ms MS] [--size WxH] [--out FILE]` | Writes the GL trace of a view of `views.json` to the end of its run, or of a query (default: the page as it opens, flying, 12 frames of 16 ms). The size is 480x270 unless `--size` says otherwise. |
| `trace-diff A B [--ignore CLASSES] [--max N]` | Compares two traces. Prints the first differences by canvas, frame and call, then a summary. Exit status 0 if identical, 1 if not. |
| `stills [--views a,b] [--base DIR\|REV] [--size WxH]` | Stills of the views in `tools/views.json`, and `index.html` to look at them. With `--base`, also the base's stills, the difference of each, and a difference picture (x8). |
| `img-diff A.png B.png [--out D.png] [--gain G] [--box x,y,w,h]` | Mean and max difference of two pictures (8-bit levels), the share of pixels that differ by more than 2 and 8 levels, and the worst tile of an 8 x 8 grid. |
| `look [--only a,b] [--page DIR\|REV] [--size WxH] [--from DIR] [--sheet [--base DIR\|REV]]` | The look invariants: a still of each view of `look.json`, measured against its limits. See [Look invariants](#look-invariants). |
| `check [NAME...] [--base DIR\|REV] [--size WxH] [--ignore CLASSES]` | Runs `look` on the GPU (unless names are given without `look`; on SwiftShader it is skipped, with a line saying so), then the checks below, or those named. One line each, `PASS`, `FAIL` or `SKIP`, then a last line `PASS` or `FAIL` for the whole set. Exit status 0 only if none fails. |
| `drive SCRIPT.json` | A scripted capture, for anything else. See below. |
| `d3d [page\|programs\|switch\|fxc] [--base DIR\|REV] [--runs N] [--q QUERY] [--size WxH] [--frames N] [--limit S] [--shot S --out PREFIX] [--weather W] [--at S]` | On WSL only: the start on Windows Chrome's Direct3D 11, the wait for a weather chosen after it, or each program's compile alone (see [Direct3D 11 on Windows](#direct3d-11-on-windows)). Not one of the checks. |
| `d3dperf [--base DIR\|REV] [--rounds N] [--views a,b] [--frames N] [--size WxH] [--speed KMH] [--fail RATIO] [--limit S]` | On WSL only: the frame time on Direct3D 11 of six views, the page against the base (default `origin/main`) in turns, a verdict for each and one line for the pull request (see [Frame time on Direct3D 11](#frame-time-on-direct3d-11-d3dperf)). Not one of the checks. |
| `perf [--q QUERY] [--size WxH] [--dpr R] [--mobile] [--cpu N] [--no-gpu] [--seconds S]` | Real time, without the fake clock: the time from navigation to the first draw of each canvas and to its first picture (the first draw to the canvas itself), the tasks of the main thread over 50 ms until then (the longest, and the time blocked: the sum of their time over 50 ms), the quality level and the canvas's size, the frame rate, the GPU time per kind of draw (median and p90), and the mean GPU time of all draws per frame shown. `--dpr` sets the device pixel ratio (a phone's, 2.6 for example), `--mobile` the mobile viewport and touch (a coarse pointer), `--cpu N` the main thread N times slower (DevTools' CPU throttling, as a phone's). With `stats` in the query it prints the page's overlay at the end. `--no-gpu` leaves out its own GPU timing of each draw (a query round each), for pages that time themselves (`stats=bench3`). It waits for the end of the page's loading (`data-sky`) and a first picture before it measures the frames. With `timing` in the query (`--q 'quality=low&timing'`), it also prints the page's console lines of its loading (`console: Sky: …`), the parts of the start. Use it on the GPU, before and after a change; other runs that share the GPU make it vary by 10 to 20 %. |

The default size is 1280x720 on the GPU and 480x270 on SwiftShader; a view may set its own (`dpr2-fhd`).

Every page the tools load gets `quality=max` in its query, unless the query names a level (`quality=low`, or `quality=auto` for the automatic choice): the pictures are those of before there were levels, and the same on every machine.

## The views

`views.json` holds the fixed views. Each runs its own frames from a fresh page: 46 frames of 50 ms for a still, so that the running mean settles (see [Judging a change](../docs/development.md#judging-a-change)). `speed=0` is added to every view that does not set a speed.

| View | What it takes |
|---|---|
| `default` | the page's defaults, at rest |
| `dusk`, `night-moon`, `night-dark` | twilight; a full moon over clouds; a moonless night (the stars, `uNight`) |
| `crescent` | a crescent moon (`moon=4`) in the evening: the earthshine term |
| `haze4` | strong haze: the table of multiple scattering is built again |
| `overcast-0.5km`, `in-cloud` | under the cloud deck; inside the cloud at 1.5 km |
| `cirrus1`, `up-cirrus-11.5km` | thick cirrus; cirrus overhead from near its base |
| `sea-low-sun`, `gale`, `clear` | sun glitter at 0.3 km; wind of 15 m/s; no cloud at all |
| `near-clouds-3km` | low clouds seen from near |
| `at-the-wrap` | a still at 255.999 km, where the way flown wraps |
| `dpr2-fhd` | a device pixel ratio of 2 at 1280x720 with `pixels=fhd`: the drawing-size cap applies, and the page enlarges the picture of 1920x1080 to the canvas of 2560x1440 (3 frames) |
| `dpr1.5-fhd` | a still of the overcast deck under cirrus at a ratio of 1.5 at 1792x1008 with `pixels=fhd`: the picture of 1920x1080 enlarged 1.4 times to 2688x1512, as on a WQHD-limited 4K screen at 150 % |
| `flight` | 40 frames of 16 ms at 900 km/h |
| `banked` | the aircraft banked 30 degrees and climbing 4, at rest: the rolled camera |
| `turning` | 40 frames of 16 ms at 900 km/h in a turn at a bank of 25 degrees, heading 135 |
| `time-lapse` | the play button, pressed after 2 frames |
| `drag` | a mouse drag across the hero after 2 frames |
| `south-night`, `midnight-sun-69.6` | other places: the Southern Cross high at 33.9 S on the UTC clock; the midnight sun at 69.6 N |
| `weather-random` | a weather drawn by the die from a seed (`weather=random&seed=1`: altocumulus over cumulus), at 4 km |
| `ui-en`, `ui-ja` | the text and the controls in English and in Japanese. `ui-ja` is skipped, with a line saying so, on a machine without a Japanese font |

## The checks

| Check | Needs `--base` | Passes when |
|---|---|---|
| `trace` | yes | The GL trace of every view, to the end of its run, equals the base's. `--ignore` applies. |
| `stills` | yes | Every view gives the base's picture exactly (max difference 0). |
| `wrap` | no | No seam where the way flown wraps at 256 km. The pictures are compared tile by tile (8 x 8), so that a seam in one part of the picture shows. Two stills 2.8 m apart across the wrap differ no more than two stills 2.8 m apart elsewhere (worst tile at most 1.5 times, plus 1 level). A flight across the wrap, after 27 and 61 frames, matches stills at those places within the same margin of a flight elsewhere. |
| `loop` | no | The drawing stops at rest (no frame queued); nothing is drawn in a hidden tab; drawing starts again when the tab is shown. |
| `res` | no | With `?res=0.5`, the picture is drawn at half size in flight and at full size soon after the aircraft stops. No frame is shifted against a still at that place (the best shift within 6 pixels is 0, 0), and the settled picture is within 0.9 levels (mean) of the still, drawn at the settled picture's exposure (`?expo=`, read from `window.__exposure`; a page without them, like main, is compared as it comes). Without `res`, at `quality=high`, slow frames (60 ms) make the picture smaller, and fast ones (16 ms) restore it; at `max` it keeps the canvas's size. |
| `flight` | no | Two flights of 61 frames (cruise, and near the clouds at 3 km) each stay within a limit (mean levels, per renderer, below) of a settled still at the place reached, drawn at the exposure the flight ended with (`?expo=`; a page without `window.__exposure` is compared as it comes). The flight's exposure over its last 20 frames also moves no more than 0.01 stops (no pumping). With a base, each also does no worse than the base's (at most 1.1 times, plus 0.03). |
| `steer` | no | Steering. Flights along headings 0, 90, 180 and 270 (61 frames at 900 km/h), a turn at a bank of 45 degrees (121 frames at 300 km/h) and a whole circle (60 degrees at 200 km/h, frames of 32 ms) reach the place and heading of the check's own sum of the turn (within 1 mm), the circle closes (within 10 m and 0.6 degrees), and each last frame is within the flight check's cruise limit of a still drawn directly there (heading, eye, bank, `?expo=`). The banked turn keeps the detail of a level turn by the rudder over the same first view (the mean step between neighbouring pixels, against their stills, at most 0.03 less), measured over the same part of the view: the level turn's box, turned by the camera's roll. A banked flight on a diagonal across the wrap matches its still within the wrap check's margin of one elsewhere. The sun stays where the camera puts it (within 3 px) after the rudder key turns the heading by about 20 degrees and the bank key banks 30, and its direction does not change. Looking ahead at 0.3 km, the sea's horizon tilts by the bank (0, 30, 60 degrees, within 1). A climb of 5 degrees reaches the altitude of the sum and matches the picture settled there; a climb into 13 km levels off. Stills at bank 0, 30 and 60 at a low sun (`banked-*.png`) are for looking at. The HUD (`hud=1`): its glass, fixed to the airframe, in views ahead, 20 degrees aside, up and down, banked and climbing, and one on a phone's profile (411x781 at a ratio of 2.625): its anchor (`window.__hud()`) is where the camera puts the nose within 1 px, and the glass is in view (`airframe`); its horizon line lies on the camera's plane of zero pitch within 1 px at both edges of the picture, and so does the green line found in the picture; the flight path marker drawn is at the nose within 1 px, and with the eye 20 degrees aside it has moved by the camera's shift of the nose within 1 px; looking 90 degrees aside the glass is out of view and the HUD's canvas holds only the helmet's readouts (pixels painted, none outside their zones, `helmet`); looking ahead at 0.3 km over a clear sea, the sea's horizon in a still without the HUD lies below the HUD's line by the dip of the altitude (0.56 degrees) within 2 px. `window.__flight()` gives the page's flight. |

The trace and the stills of a view come from one run of it, so the two checks together load each view once per page.

Without `--base`, the checks that need one are skipped (`SKIP`), and the others still run. A check that fails prints its numbers; its pictures are in its own folder of the run.

**The trace and the stills prove different things.** Equal traces mean that the page sent WebGL the same commands with the same values, and got the same buffers back. Equal stills mean that the composited picture is the same, with the CSS around the canvas and the overlays. A CSS filter on the canvas changes the stills and not the trace; a frame drawn in another order may change the trace and not the stills.

## Look invariants

`look.json` holds the flaws the owner reported, one entry each: the view (the query of the debug overlay, as reported), the date, what was wrong, the measures with their limits, and the commits where the flaw was seen (`bad`) and fixed (`fixed`). `look` renders each view once (one still of 46 frames of 50 ms at 1280x720, the registry's `size`; two entries with the same query share it) and prints a line per entry:

- `PASS`: every measure within its limits.
- `FAIL`: a measure out of its limits (marked `!`), or the page logged errors.
- `KNOWN`: a known open flaw (`expected: "fail"`) still fails. It does not fail the run.
- `PASS?`: a known open flaw passes. The run fails until the mark is removed (or the limit is set where the fix leaves it).

The last line is the one to paste into a pull request: `look: 9 PASS, 5 KNOWN, 0 FAIL at efd2b2f` (`+changes` when `index.html` has uncommitted changes). Exit status 0 when no entry is `FAIL` or `PASS?`.

The limits are absolute: no base is needed, and a flaw that was merged is still flagged after. They are set from the stills of the bad and the fixed commits, with a margin both ways; they change only on purpose, in a commit that says why. `--page REV` renders a commit (exported like a base): `look --page 9041c58 --only overcast-rows-11km` shows the proof of an entry. `--from DIR` measures the stills of an earlier run again, without Chrome (to try a limit). `--sheet` writes `sheet.png`, the stills of every entry in one picture; with `--base REV`, each row is base | page (`look --sheet --base origin/main` for a pull request).

It takes about 90 s on the GPU for the 19 entries (18 stills). It is not meant for SwiftShader: there the stills take minutes each, and the limits were set on the GPU.

An entry whose query sets `speed` is not a still: its 46 frames are flown (stars dragged in flight, for example).

A measure with `against: NAME` is divided by the same measure of entry NAME's still (over `againstRegion`, else the same region): a ratio between two views, such as the Earth's band looking up and looking level. `--only` brings that entry along.

The measures (`lib/measures.mjs`), each on a region `[x, y, w, h]` (fractions of the picture), in 8-bit sRGB levels as shown:

| Measure | What it gives | What it cannot tell |
|---|---|---|
| `lumaPct` | The `p`-th percentile of the luma. A moonlit night is dark; sunlit tops are near white; the sky at 40 km is near black. | Whether the brightness is right for the scene: it holds a limit, not a photograph's value. |
| `brightColour` | The mean r/g, b/g or saturation (`of`) of the brightest pixels (over the `p`-th percentile), of their levels as shown (not of linear light: `meanColour`): white tops near 1, 1 and 0. | Which pixels are cloud: in a view with sun glitter or a bright sky, those are the brightest. |
| `regularity` | The rebound of the luma's autocorrelation, in square windows of the region (the largest over them): how far the autocorrelation rises again after falling, along any direction. A lattice or rows rebound 0.9 to 2; natural cloud 0.3 to 0.6. Each window alone, so that the period may change with perspective. | A regular pattern larger than half a window (64 px), or one in a small part of a window. A single large cloud edge can rebound too (the many-clouds view at 3 km gives 0.58 on main). |
| `spectrumPeak` | The sharpest peak of the luma's power spectrum, in the same windows: a frequency's power over the median of those about it (within 4 bins), for periods of 6 to 40 px (`pmin`, `pmax` set others). A tile of noise shown again and again: 45 to 60 (the middle clouds' cells from 40 km on main at 4dfadd8: 46.7); natural cloud 10 to 25 (18.5 once fixed). Over periods of 2 to 5 px, a lattice of dots that the mean over frames kept (`base-lattice-*` on main at 5aa9d12): 263 to 6013; grain and cloud 15 to 40. | A repeat with fewer than some three periods in a window (128 px), or one whose period changes much across it. Keep the horizon out of the region: its edge is a peak too. |
| `speckDensity`, `specksCv` | The dark (or bright, `dark: false`) specks: blobs whose local contrast (against a box of `k` px) is beyond `t`, of 4 px or more. Their count per 10 000 px, and the spread of their areas (coefficient of variation). | The count depends on the size of the picture (keep the registry's size). The spread did not separate the fields of equal specks from the fixed decks (1.2 to 1.6 on both): only the count is used. |
| `grain` | The root mean square of the luma's local contrast over 3 x 3 px (`k` = 1), in % of the region's median luma: the finest detail. A pepper of dark pixels that the mean over frames left on a deck's base in flight: 2.6 at civil twilight, 1.3 at noon (`base-grain-*` on main at ca77500); the smooth base's own texture 0.3 to 0.5. | Which detail is noise: fine texture, sharp edges and the horizon count too. Keep the region on a smooth part. |
| `verticalWalls` | The share of the strong edges (over the `p`-th percentile of the gradient) that are near-vertical and run down at least `run` px. | Walls that are not shaded as edges; a tower outside the region. Natural turrets give some (0.004 on the clouds before #104). |
| `edgeRatio` | The horizontal gradient against the vertical one: clouds seen obliquely are below 1. | It moved little for the needle tower (0.66 against 0.60). Kept for views where walls fill the region. |
| `relief` | The mean gradient of the luma inside the cloud mask, over the mean luma, at scales of 1, 2 and 4 px: knobs, shade and folds. | The cloud mask (luma at least `cloudLuma`, saturation at most `cloudSat`) is rough: grey sky near the sun and haze pass it. Grain and noise count as relief. |
| `blobSize` | The connected parts of the cloud mask: the area-weighted mean of their areas, as a share of the region. Large merged heaps: large. | Clouds that touch are one blob; only for views down onto clouds over the sea, where the mask is clean. |
| `meanColour` | The colour of the whole region in the page's linear light: each level undone with the power 2.2 the page encodes with, the mean of each channel, their ratio b/g (`of: 'bg'`, default) or r/g (`rg`). The twilit Earth from 40 km: 2.97 (navy) on main at cda9faa. Undone with the sRGB curve instead, whose straight foot near black flattens dim colours, the same picture gives some 2.2. | Whether the colour is the camera's or the scene's: it holds the colour as shown, after the white balance and the look. |
| `cover` | The share of the region in the cloud mask. | The same rough mask. |
| `coverRise`, `coverFall` | For an entry with a `sweep` (one still for each value of a parameter of the page, `NAME@VALUE.png`): the largest rise and the largest fall of `cover` between neighbouring stills. The slider from heaps to a sheet: steady growth, no fall. | One view: a raft that comes into it at once is a step of a few hundredths. |
| `exposureStep` | For an entry with a `sweep`: the largest change of the exposure (`window.__exposure`, log2, in stops) between neighbouring stills. `look` keeps each still's exposure beside it (`NAME.json`). A sweep of the sun's height: the meter does not jump. | Whether the picture looks right at each step: only that the exposure moves steadily. Stills from `--from DIR` need their `NAME.json` (a run before this measure has none). |
| `lumaRise` | For an entry with a `sweep`: the largest rise of the region's mean luma from any still to a later one, in levels of 255. A sweep of the sun's height, going down: the picture never grows brighter (about 0). | Parts of the picture: the sky half may rise while the Earth half falls and the mean holds (give a `region`). Nor whether the picture is too dark: a black frame passes. |
| `flatPlate` | The largest connected part of the bright pixels (luma at least `luma`, 150) whose relief (the mean of the luma's steps over `k` px, 7) is under `grad` (3), as a share of the region: a flat pale plate among knobbly clouds. | A smooth sheet far off, or a bright calm sea, counts too: keep the region near. |
| `clumping` | The cover of the cloud mask in the windows of a grid (`nx` by `ny`, 8 by 5) over the region: the standard deviation over the windows, over their mean. An even sprinkle of heaps: low; clusters and clear lanes: high. | The same rough mask. Perspective: far windows hold more sea per pixel, so compare one view with itself. A single large cloud also gives a high value: use it with views from far above. |
| `detailScale` | The lag at which the autocorrelation falls to 0.5, over the picture's width: the size of the detail. | It is dominated by the finest grain; it did not separate the cumulus before and after #104. |
| `lineDip` | A thin dark line across the region: per row, the dip of rows y, y + 1 below the rows on both sides, the median over `cols` strips, the largest over rows. | A line across less than half the strips; a line that is not darker than both sides. |
| `columnJump` | A straight seam down the region: the largest step between the mean luma of neighbouring columns, in levels. A seam fixed in the world that the view crosses upright. | A seam that is not upright in the picture; a cloud's straight edge (one in the region gives a step of its own). |
| `patchStops` | The contrast of light and dark patches across the region, in stops: the 95th less the 5th percentile of log2 of the mean luminance (linear) of the blocks of a grid (`nx` by `ny`, 24 by 14), without the blocks that hold a pixel of luma `top` (250) or more (the sun's disc). With `flat`, less the plane that fits the blocks best: a gradient across the frame does not count. An altostratus from below: 0.2 to 0.3 as an even card, 0.4 to 0.9 with thick and thin places (photographs: 0.35 to 1.2). | What the patches are: a cloud's edge against the sky, or the horizon in the region, is a contrast too. Detail finer than a block (a 24th of the region) does not count. |
| `stars` | The points of light per 10 000 px: pixels at least `t` levels (default 12) over the mean of their surroundings (`k` px, default 4) and the brightest in 5 x 5 px. Levels as shown, so a darker night that hides the stars lowers it. | Which points are stars: glints and sparkles on the sea count too, so use it on the sky. Like `speckDensity`, it depends on the picture's size. |
| `starShape` | How drawn out the brightest points of light are: for the `n` (default 12) points of `stars` furthest over their surroundings (at least `t`, default 30), the ratio of the long axis of their light's second moments to the short one (over the median of a window's rim, where at least a quarter of the point's), the median over the points. A point 1.1 to 1.4; a streak 2 and more. | Which points are stars, as for `stars`; two stars within a few pixels are one long point. |
| `texture` | The contrast of detail some 5 to 50 px across: the luma, cleared of points (a median over `2 m + 1` px square, `m` 2), averaged over boxes of `2 k1 + 1` and `2 k2 + 1` px (`k1` 2, `k2` 24), the RMS of their difference over the mean of the larger. Streaks of cirrus against the sky some 0.02 to 0.1; a flat veil or a clear sky by day under 0.01. | Whether the detail is cloud: the horizon, the sea's waves and a moon's edge count too, so keep them out of the region. On a dark night the grain of the picture alone gives 0.02 to 0.03. |
| `fringe` | Foam beside the white of the whitecaps: the pixels within `k` px (default 10) of a white one (luma at least `white`, 235) that are brighter than their surroundings (over the mean of 33 x 33 px by more than `t`, 25) without being white, per white pixel. Whitecaps as flat white blobs on dark water: 0.43 at 15 m/s from 0.3 km (main at e18ddb1); with trails of foam torn into streaks behind them: 0.69. | Which bright pixels are foam: glitter and a bright mirrored sky beside a whitecap count too; and how real the trails look. |

## The fake clock

Every page (except under `perf`) runs on a fake clock, so that two runs give the same frames:
- `performance.now()`, `requestAnimationFrame` and `cancelAnimationFrame` advance or act only when the tool steps a frame (`__step(n, ms)` in the page).
- `setTimeout`, `setInterval` and `requestIdleCallback` run on the fake clock too: in a step, the timers due run first (in the order of their time), then the animation frames. The page's fades of the overlays (6 s and 4 s) wait for the fake clock.
- `Date` starts at 2026-11-15 00:00 UTC and advances with the fake clock. The page reads the date for its default day, and the wall clock for the frame time that sets its drawing size in flight.
- The time zone is UTC and the language `en-US` (Chrome's `--lang`, and the DevTools locale), `Math.random` is seeded (mulberry32), and local storage is cleared.
- CSS transitions and animations are turned off: they would run on the real clock.
- The text and the controls over the hero (`.title`, `.panel`, `.hint`, `.fs`) and the scroll bar are hidden from the first frame on, except in the views marked `ui`.

**When is the page ready?** At the load event; where an element has `data-sky`, when its value is `ready` (`failed` stops the run); and when the network has been quiet for 300 ms (no request in flight, as the DevTools Network domain counts them), so that files fetched after the load, one after another, are in. (A request of a `blob:` or `data:` URL, such as a worker made from a script's text, is not counted: DevTools never sees it finish.) A page that loads in parts should still mark itself `data-sky="loading"` in its markup: a pause longer than 300 ms between two requests would otherwise end the wait. While it says `loading` after the load event, the tools run the timers due and the animation frames it asks for, every 10 ms, without moving the fake clock (`__loading()` in the page): the page's loading, which waits a frame at a time, goes on, and all of it is frame 0. Its own frames must not start before it says `ready` (the page's `kick()` waits for the end of the loading). Then the tools let two real frames of the browser pass, so that the resize and intersection observers have run, before the first fake frame.

## The GL trace

The trace records what the page asks of WebGL, per canvas, in order: every call of every method of the context, with its arguments and its result. It also records `getContext` and every change of a canvas's size.

- Objects get names in the order they are made: `prog1`, `shader3`, `tex7`, `fb2`. A uniform location is named by its program and name: `prog1.uSun`.
- Numbers are written as the 32-bit floats that the GPU receives (the shortest decimal that gives the same float). Enums are named where an argument is an enum.
- A shader's text is named by a hash (`src:…`); each text is given once, at the end of the file.
- A large array (an upload) is written as its type, length and a hash of its bytes. An upload from an image, a canvas, a bitmap or an `ImageData` is written with a hash of its pixels.
- After each frame, every texture that the frame drew into is read back and hashed (`readback tex7 level 0 RGBA16F 480x420 = #…`, SHA-256 cut to 64 bits), and so is the canvas, if it was drawn. A 3D texture drawn layer by layer gets one hash for all its layers. A texture that the page deletes in the frame it drew into (the 1x1 targets that warm a program up, a target of one pass) is read back just before `deleteTexture`, so its line stands before that call: after it, the texture can no longer be attached. A texture the trace cannot read back (an unknown format or size, a texture that cannot be attached, a failed `readPixels`) is an error of the run, not a line that two traces could share; the error names the GL error or the framebuffer status.
- The read-back keeps the GL errors already pending for the page's own `getError`, and takes all of its own errors off the queue (WebGL keeps one flag per kind, so a failed call can leave two), so that one failed read-back does not fail the next.
- A call made outside a stepped frame after the setup (in an event or an observer) is marked `outside a frame:`: when it runs depends on the browser.

Frame 0 is everything before the first fake frame: the whole loading (compiling, linking, building the noise, weather and wave textures, drawing the first frame once as a probe).

The trace leaves out the calls whose number depends on how fast the GPU is, not on the page: the sync objects (`fenceSync`, `getSyncParameter`, `clientWaitSync`, `waitSync`, `deleteSync`, `isSync`), `flush`, and `getProgramParameter` and `getShaderParameter` with `COMPLETION_STATUS_KHR`. A page that polls them while it loads still gives the same trace run after run. Frame k ends after the timers and the animation frames of the k-th step.

On one renderer, the same page gives the same trace byte for byte, run after run: the trace has no time in it and no GPU noise. The GPU and SwiftShader give different pixels, and the page asks some things that depend on the renderer (extensions). So compare traces of one renderer with each other; `--ignore readback` compares the commands alone, across renderers.

`trace-diff` and `check trace` can ignore classes of difference:

| Class | Ignores |
|---|---|
| `shader` | the text of shaders (the calls that pass a text still count) |
| `line` | `#line` directives in shader texts |
| `comments` | comments, blank lines and spacing in shader texts (for moves of shader code) |
| `readback` | the hashes of what the frames drew |
| `query` | calls that only ask (`get…`, `is…`, `checkFramebufferStatus`), for example a different order of `getUniformLocation` |
| `start` | frames 0 and 1: a change to the loading may do the same work in another order, or do in frame 0 what the first frame did (make the pictures, upload a table, read the meter). The frames after must be the same |

Example: `node tools/sky.mjs trace-diff a.trace b.trace --ignore shader,readback`. A difference is printed like this:

```
canvas sky, frame 1, call 113 of 133 in A, 113 of 133 in B:
    uniform1f(prog1.uExposure, 0.57246)
    uniform1f(prog1.uLook, 1.4)
  - uniform1f(prog1.uAlt, 11)
  + uniform1f(prog1.uAlt, 10)
```

## drive scripts

```json
{ "q": "time=17&speed=0", "w": 1280, "h": 720, "hide": true,
  "steps": [["step", 46, 50], ["shot", "a.png"], ["eval", "document.title"], ["draws"],
            ["mouse", {"type": "mousePressed", "x": 600, "y": 300, "button": "left", "clickCount": 1}],
            ["size", 800, 600], ["frames", 2], ["sleep", 100], ["shot", "b.png", {"x": 0, "y": 0, "width": 200, "height": 100}]] }
```

A file may also hold a list of such scripts: they run one after another in the same Chrome (one wait in the queue), each printed after its `name`, each on its own `page` directory if it gives one (else `--page`).

`step` takes frames and ms; `shot` a file and an optional clip; `eval` prints the value of a JavaScript expression in the page; `draws` prints the draw calls so far per canvas (to the screen, offscreen, and the size of the largest offscreen draw since the last draw to the screen: the size the picture is drawn at); `mouse` sends a DevTools `Input.dispatchMouseEvent`; `size` changes the viewport; `frames` waits for real browser frames; `sleep` waits real ms. Optional: `dpr`, `mobile` (true: the mobile viewport and touch, as `perf --mobile`), `seed`, `realDate` (true: the real `Date`).

## Environment

| Variable | Meaning |
|---|---|
| `SKY_GPU` | `1`: draw on the GPU. Unset or `0`: SwiftShader, Chrome's software renderer, which works anywhere (CI too) and gives the same pixels on every run. |
| `SKY_GPU_ADAPTER` | On WSL2, the D3D12 adapter to use (default `NVIDIA`). |
| `SKY_CHROME` | The Chrome to start. Else the newest Chromium in Playwright's cache (`~/.cache/ms-playwright`), else `google-chrome` or `chromium` on PATH. |
| `SKY_CHROME_LIBS` | Directories put before `LD_LIBRARY_PATH` for Chrome, where it lacks system libraries. |
| `SKY_WRAP` | The queue for heavy runs: a path to a program that runs its arguments (like `heavy`). Default: `~/.claude/bin/heavy` if it exists. `none`: no queue. |
| `SKY_MEMORY_MAX` | The memory cap under the queue (default `3G`). |
| `SKY_TIMEOUT` | The time limit in seconds (defaults: trace 900, stills 2400, look 3600, check 5400, drive 900, perf 300). |
| `SKY_READY_MS` | How long to wait for the page to be ready (default 180000). |

With a queue, the command runs again inside it: `heavy timeout --foreground -k 10 T systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0 -p TasksMax=500 -p RuntimeMaxSec=… node tools/sky.mjs …` (without `systemd-run` where there is none). It prints one line when it queues. The queue and everything under it run in a process group of their own, and the command passes `SIGINT`, `SIGTERM` and `SIGHUP` on to that group: Ctrl-C stops the run and frees the queue's slot. Without a queue, the command runs directly, with its own time limit.

Chrome always dies with the command: it is started in a process group of its own, under `setpriv --pdeathsig KILL`, and the group is killed on exit, on a signal and on an error. If Chrome or the page's renderer dies, every call waiting on it fails at once, and the run ends with the reason. Its profile goes in a short temporary directory (`/tmp/sky-…`): Chrome puts sockets there, and a long path makes it fail at start. Do not set `TMPDIR` to a long path. A run killed outright leaves its profile behind; each run removes this user's `sky-…` and `sky-base-…` folders older than a day.

### WSL2

With `SKY_GPU=1` and `/dev/dxg` present, the tools start Chrome with `--use-angle=gl-egl --ignore-gpu-blocklist` and set `GALLIUM_DRIVER=d3d12` and `MESA_D3D12_DEFAULT_ADAPTER_NAME` (from `SKY_GPU_ADAPTER`). Mesa then renders through D3D12 on the GPU; without `GALLIUM_DRIVER` it falls back to llvmpipe, on the CPU. `DISPLAY` is removed: with it, headless Chrome got no WebGL2. These flags live in `renderer()` in `lib/browser.mjs`. Every command prints the renderer: on the GPU it names the adapter (`D3D12 (…)`). Without a Japanese font, `ui-ja` is skipped. This GPU stack ignores the alpha of `blendColor` (see the [GLSL rules](../docs/development.md#glsl-rules)); SwiftShader does not.

## Direct3D 11 on Windows

Chrome and Edge on Windows draw WebGL through ANGLE on Direct3D 11, which
compiles shaders with Microsoft's HLSL compiler: far slower than this
machine's stack for large programs (see the GLSL rules in
[development.md](../docs/development.md#glsl-rules)). On WSL, `d3d` runs
Windows Chrome itself, headless (`--headless=new --use-angle=d3d11`, no
window, no focus), with a profile of its own in the Windows temporary
directory and the program cache off, one Chrome at a time. The page is
served from WSL (Windows reaches its localhost) and posts what it measures
back over HTTP. Each run ends after `done` or `--limit` s (default 300);
then exactly its own processes are killed (found by the profile's path,
never by name) and its profile is deleted. `SKY_WIN_CHROME` names another
Chrome (default `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`).

- `d3d page`: the page with `?timing&res=1` (and `--q`): its console lines
  (each program compiled, the textures, the first picture, in seconds since
  the page was opened), then the GPU time of `--frames` frames (default 60,
  `EXT_disjoint_timer_query_webgl2`) at `--size` (default 1920x1080):
  their mean, median and p90. Read the mean: in some views the frames
  alternate between cheap and dear ones, nearly half of each, and the
  median jumps from one kind to the other from run to run.
  With `--shot S`, instead of the GPU time: the canvas as a PNG, S s (real
  time) after the first picture, at the canvas's size (the page's own
  drawing size at this window's device pixel ratio of 1; no `res=1`), written to `PREFIX-<page>-<run>.png`. In flight, that is a
  picture of S s flown on Direct3D 11.
- `d3d switch`: the page as for `page`; `--at` s (default 5) after the
  first picture it chooses the weather `--weather` (default
  `altocumulus`) in the panel, and prints how long after the choice the
  console says `middle clouds built` (a weather without middle clouds
  waits 8 s), the longest gap between animation frames from the choice to
  1 s after that, and every gap over 100 ms. With `--runs` over 1, a last
  line per page gives the median and range of the first picture, the wait
  and the longest gap. The control is a weather without middle clouds
  (`--weather fair`, whose haze is the page's own: another haze rebuilds
  a table, some 0.4 s of script in slices between the frames).
- `d3d programs`: each program the page links at its start (with `--q`),
  alone: the time to compile and link it, and of its first draw into one
  target and into all its outputs (ANGLE compiles a program again for a
  draw into more than one target). The programs and the text of their
  fragment shaders come from a first run of the page itself, which posts
  `window.__programs()` (makeSky's names, and each fragment shader as
  given to `shaderSource`: the middle clouds' lines chosen, the quality's
  defines in), so the tool does not make the sources a second way. A page
  from before `window.__programs` (an older `--base`) gives the
  fragment shaders of its `linkProgram` calls instead, named by their
  script and the defines without a value after `#version`. The middle
  clouds' programs that a worker compiles ahead are not among them.
- `d3d fxc`: the same programs, each compiled alone by Microsoft's HLSL
  compiler, as ANGLE does on Direct3D 11: one run of the page for its
  programs, one of a harness that links each and keeps the HLSL ANGLE
  handed the compiler (the part `COMPILER INPUT HLSL` of
  `WEBGL_debug_shaders`; this Chrome alone gets
  `--enable-privileged-webgl-extensions`), then `D3DCompile` of Windows'
  own `d3dcompiler_47.dll` from PowerShell (`ps_5_0`, optimization level
  2, ANGLE's macro `ANGLE_ENABLE_LOOP_FLATTEN`), `--runs` times, the
  pages' programs in turns. It prints, for each program and page, the
  compiler's CPU time in s (median and range of the runs) and the number
  of instructions, the page's time against the base's, and their sum.
  The files live in a folder of the Windows temporary directory of the
  run's own (`sky-fxc-<pid>`), deleted at its end. The compile runs on
  one CPU core and takes seconds, not a whole start (a minute or so for
  two pages and three runs, after the two Chromes): measure a change of a
  shader here first, then its start with `d3d page`. Other work on the
  machine moves a time by some 0.5 s of 8: compare medians of several
  runs. A link of `d3d programs` takes longer, as it also holds the
  driver's work (2026-11-27: the scene 7.1 s here, its link 8.9 s).

With `--base`, the base and the page take turns, `--runs` times each. Every
line names the renderer: it must say `Direct3D11`. Headless Chrome did
not lose the context even where a draw held the GPU process for 143 s
(also with `--gpu-watchdog-timeout-seconds=2`), where a browser with a
window does: watch the times of the second compiles, not for a loss.

Measured on the owner's machine on 2026-11-24, main at 9de3e45:
`d3d programs`, two runs, link in s: `fs (CIRRUS_PASS)` 9.0 and 9.3,
`fs` 8.2 and 8.2, `fs (CLOUD_PASS)` 5.3 and 5.1, `ice` 3.3 and 3.4 (its
draw into three targets 3.6), `fs (SKY_LIGHT)` 2.6 and 2.7, `noise` 0.9,
`fs (SHADOW_MAP)` 0.3, `fs (TOPS_MAP)` 0.25. The harness's draw of `fs`
alone ends in GL error 1282, and its copy of `fs (AIR_LUT)` does not
compile; the page draws both. In the page (`d3dperf`, a window of
1920 x 1080, 15 runs), the first picture comes 12.9 to 14.1 s after the
navigation; `fs (CLOUD_PASS)` is ready at 9.2 to 9.8 s, `fs` at 10.8 to
12.4 s, `fs (CIRRUS_PASS)` at 12.0 to 13.4 s. The frame times of the
views of `d3dperf` are below.

Earlier, on 2026-11-19 (`d3d programs`, each
program alone, in s: its link, then its first draw into all its targets):
main's `fs` 6.4 and 6.0; round 19's 98.9 and 114.9; 7d1a635's 124.0 and
121.5; now `fs` 8.9 and `fs (CIRRUS_PASS)` 9.7, one target each, and
`ice` 3.9 and 4.4 (three targets). `d3d page`, three runs each at
2560 x 1440, the first picture: main 17.1 to 18.7 s, round 19 253 to
297 s, 7d1a635 252 to 292 s, now 13.4 to 17.2 s.

The low clouds of #33, round 21 (2026-11-19, against main a257ec2):
`d3d programs`, link in s: `fs (CLOUD_PASS)` 3.9, `fs` 7.4 (main 6.8),
`fs (CIRRUS_PASS)` 8.5, `fs (SKY_LIGHT)` 2.6, `fs (TOPS_MAP)` 1.3, one
target each (the harness's draw of `fs` alone ends in GL error 1282; the
page draws it). Round 20 rebased on that main did not link: its `fs`
read 20 textures, where Direct3D 11 allows 16. `d3d page`, three runs at
2560 x 1440: the first picture 12.5 to 13.7 s (main 10.9 to 12.8 s), the
GPU time per frame 24.1 to 24.9 ms (main 16.5 to 16.9 ms).

### Frame time on Direct3D 11 (`d3dperf`)

Microsoft's compiler may fold or flatten a branch after a harmless-looking
edit: the frame gets a fifth slower on Direct3D 11 with the same picture,
and GL shows nothing (see the GLSL rules). `d3dperf` watches for it, on
the owner's machine; GitHub's runners have no such GPU.

```sh
node tools/sky.mjs d3dperf                  # this tree against origin/main, some 10 minutes
node tools/sky.mjs d3dperf --views tower --rounds 7
```

It times eight views, flying at 50 km/h (the page draws nothing at rest;
at that speed a view moves some 20 m while it is timed), with `res=1`, at
`quality=max`, in a window of `--size` (default 1920x1080, drawn at
1898 x 982): `default` (11 km), `overcast` (11 km over a deck),
`heaps-3km`, `tower` (a tower close ahead at 3 km), `cirrus` (12.5 km,
level inside the cirrus), `night` (a full moon over clouds), `altocumulus`
(the middle clouds' cells from 11 km) and `altocumulus-0.3km` (the same
from below, looking up 30 degrees). Each round
runs the base, then the page: one Windows Chrome each (as `d3d`), which
goes through the views in its tab, so the later views' programs may
come from the GPU process's cache. A view times `--frames` frames (default
120) after the first picture and 10 more; its frame time is their mean.
The verdict of a view takes the median of the `--rounds` rounds (default
5, at least 3) on each side, and their ratio, page over base. The ratio is
known to within the larger run-to-run spread of the two sides (the range
of the rounds as a share of their median; from five rounds on, without the
lowest and the highest). `PASS`: the ratio, plus that spread, is at most
`--fail` (default 1.10, the working limit of one pull request). `FAIL`:
the ratio, less the spread, is over it. Else `undecided`, with the range
the ratio may have: run it again, with more rounds or that view alone; it
is never a pass. The start comes as information: the first picture and the
three programs ready last (seconds since the navigation, the first view of
each round only, whose programs are compiled cold), page against base.
The last line is for the pull request's description:

```
d3dperf: 8 views, worst 1.00x (cirrus), 0 FAIL, 0 undecided, spread up to 3.2 % at 9de3e45 vs origin/main (9de3e45)
```

Exit status 0 when every view passes, 1 when one fails, 3 when none fails
and one is undecided; 0 with a `SKIP` line on a machine without Windows
Chrome. Every frame's GPU time is kept in `frames.json` in the run's
folder (`tools/out/d3dperf/…`, or `--out DIR`). Run nothing else on the GPU
meanwhile: the tools' GL runs on WSL share it.

It is not one of the checks: it needs Windows Chrome, it takes minutes,
and it measures time, which drifts with the machine's load, where `check`
compares pictures and traces that do not drift.

Measured on 2026-11-24 (main at 9de3e45; drawn at 1898 x 982; the median
of five rounds, ms; the spread of three runs of main against itself):

| View | main | spread, main against main | 8582b03 (before #113 and #117) | a copy of main without the `UNSEEN` of `all` |
|---|---|---|---|---|
| `default` | 16.1 to 16.3 | 0.2 to 1.5 % | 14.5 | 17.6 (1.08x, undecided) |
| `overcast` | 12.8 to 12.9 | 0.2 to 0.5 % | 10.8 | 13.5 (1.05x, PASS) |
| `heaps-3km` | 16.5 to 16.6 | 0.2 to 0.8 % | 17.9 | 21.6 (1.30x, FAIL) |
| `tower` | 16.0 to 16.6 | 0.3 to 3.5 % | 12.7 | 18.1 (1.095x, undecided) |
| `cirrus` | 17.7 to 17.8 | 0.1 to 0.7 % | 16.9 | 21.0 (1.18x, FAIL) |
| `night` | 15.3 to 16.2 | 0.1 to 6.0 % | 13.2 | 16.6 (1.09x, undecided) |

Main against main passed twice, and once was undecided in `night` (1.05x)
with no FAIL. `tower` and `night` have two states: their frames
alternate between cheap and dear ones (14 and 19 ms in `tower`, 12 and
17 ms in `night`), and the share of each changes from run to run (in
`night` a fifth to two fifths cheap), so a run's mean takes one of two
values (16.0 or 16.5 ms in `tower`, 15.1 or 16.1 ms in `night`). Their
spread is the largest; the median of five rounds is seldom moved by it.


## Timings and limits

Measured on the owner's machine (WSL2, RTX 3090, 16 CPU threads) on 2026-11-16, with `main` at fa1fa6c against itself. Other runs shared the machine, so take the times as rough.

| Run | GPU (1280x720) | SwiftShader (480x270) |
|---|---|---|
| `trace` of the page as it opens (12 frames, 480x270) | 4 to 5 s | 14 to 15 s |
| `check` (all six; `ui-ja` skipped) | 6.3 min | 43 min |
| of which `trace` and `stills` (20 views, page and base, one run each) | 4.8 min | 24 min |
| of which `wrap` | 39 s | 7.7 min |
| of which `loop`, `res`, `flight` | 6 to 32 s each | 0.7 to 7 min each |

A trace of the page as it opens is 3065 lines, 138 kB. The same page gave the same trace byte for byte, twice on each renderer.

The limits, from `main` and from copies of it broken on purpose (8-bit levels; "worst tile": the largest mean over an 8 x 8 grid):

| Check, measure | `main`, GPU | `main`, SwiftShader | broken, GPU | broken, SwiftShader | limit |
|---|---|---|---|---|---|
| `wrap`: worst tile of stills across the wrap (elsewhere) | 0.93 (1.24) | 0.61 (0.77) | 4.07 | 4.07 | 1.5 x elsewhere + 1 |
| `wrap`: worst tile at frame 27 of a flight, across (elsewhere) | 2.84 (2.80) | 3.46 (3.50) | 6.21 | 6.52 | 1.5 x elsewhere + 1 |
| `res`: settled picture against the still, mean | 0.63 (0.71 with the exposure meter) | 0.61 | 1.03 | 1.15 | 0.9 |
| `flight`: cruise, mean | 1.13 (1.21 with the exposure meter, same exposure) | 1.16 | 2.79 | 2.10 | 1.8 |
| `flight`: exposure range over the last 20 frames, stops | (none) | (none) | | | 0.01 (0.0024 cruise, 0.0030 at 3 km, GPU) |
| `flight`: near the clouds, mean | 1.09 | 1.34 | 4.73 | 4.53 | 1.6 (GPU), 1.9 (SwiftShader) |

The broken copies: for `wrap`, the sea's gusts read at `x / 250.0` instead of `x / WEATHER_KM` (a seam on the sea only); for `res`, the mean at rest trusting 3 frames instead of 63; for `flight`, `uWay` always 0 (no reprojection). With a base, `flight` also fails above 1.1 times the base's mean plus 0.03.

Other copies broken on purpose, each caught: the loop stopping one frame early (`trace`: frame 39 of every still view; `stills`: max 1 to 6), `HERO_PIXELS.fhd` changed (`trace` and `stills` of `dpr2-fhd`), the earthshine doubled in the shader (`stills` of `crescent` only, max 22; the trace sees the shader text in every view), a CSS filter on the canvas (`stills` only: the trace is identical), the loop never stopping (`loop`), the picture kept small after a stop (`res`).

## Files

| File | What it holds |
|---|---|
| `sky.mjs` | The command line; the queue and the time limit. |
| `make-stars.py` | Builds the star catalogue (not a test tool; see above). |
| `views.json` | The fixed views. |
| `lib/browser.mjs` | Finding and starting Chrome (the renderer flags), the DevTools connection, the local server. |
| `lib/page.mjs` | The driver: a page in a fresh tab on the fake clock, ready, stepped, shot. |
| `lib/inpage.mjs` | The script that runs in the page first: the fake clock, the draw counts, the GL trace. |
| `lib/trace.mjs` | The trace file: writing, reading, comparing. |
| `lib/png.mjs` | PNG reading and writing (Node's zlib), picture differences, the shift between two pictures. |
| `lib/run.mjs` | Running a view; the commands `trace`, `stills`, `drive`, `perf`; base revisions. |
| `lib/checks.mjs` | The checks and their limits. |
| `look.json` | The look invariants: the flaws reported, their views, measures and limits. |
| `lib/look.mjs`, `lib/measures.mjs`, `lib/sheet.mjs` | The command `look`; the measures of a still; the contact sheet. |
| `test/measures.test.mjs` | Unit tests of the measures on synthetic pictures, and of the registry: `node --test tools/test/*.test.mjs`. |
| `lib/d3d.mjs` | The command `d3d`: Windows Chrome on Direct3D 11, its harness pages, its cleanup. |
| `lib/d3dperf.mjs` | The command `d3dperf`: its views, the rounds in turns, the verdict. |
| `test/d3dperf.test.mjs` | Unit tests of `d3dperf`'s arithmetic (the medians, the spread, the verdict, the summary line). |
