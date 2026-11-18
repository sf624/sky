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
| `check [NAME...] [--base DIR\|REV] [--size WxH] [--ignore CLASSES]` | Runs the checks below, or those named. One line each, `PASS`, `FAIL` or `SKIP`, then a last line `PASS` or `FAIL` for the whole set. Exit status 0 only if none fails. |
| `drive SCRIPT.json` | A scripted capture, for anything else. See below. |
| `d3d [page\|programs] [--base DIR\|REV] [--runs N] [--q QUERY] [--size WxH] [--frames N] [--limit S]` | On WSL only: the start on Windows Chrome's Direct3D 11 (see [Direct3D 11 on Windows](#direct3d-11-on-windows)). Not one of the checks. |
| `perf [--q QUERY] [--size WxH] [--seconds S]` | Real time, without the fake clock: the time from navigation to the first draw of each canvas and to its first picture (the first draw to the canvas itself), the tasks of the main thread over 50 ms until then (the longest, and the time blocked: the sum of their time over 50 ms), the frame rate, and the GPU time per kind of draw (median and p90). It waits for the end of the page's loading (`data-sky`) and a first picture before it measures the frames. Use it on the GPU, before and after a change; other runs that share the GPU make it vary by 10 to 20 %. |

The default size is 1280x720 on the GPU and 480x270 on SwiftShader; a view may set its own (`dpr2-fhd`).

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
| `dpr2-fhd` | a device pixel ratio of 2 at 1280x720 with `pixels=fhd`: the drawing-size cap applies (3 frames) |
| `flight` | 40 frames of 16 ms at 900 km/h |
| `time-lapse` | the play button, pressed after 2 frames |
| `drag` | a mouse drag across the hero after 2 frames |
| `ui-en`, `ui-ja` | the text and the controls in English and in Japanese. `ui-ja` is skipped, with a line saying so, on a machine without a Japanese font |

## The checks

| Check | Needs `--base` | Passes when |
|---|---|---|
| `trace` | yes | The GL trace of every view, to the end of its run, equals the base's. `--ignore` applies. |
| `stills` | yes | Every view gives the base's picture exactly (max difference 0). |
| `wrap` | no | No seam where the way flown wraps at 256 km. The pictures are compared tile by tile (8 x 8), so that a seam in one part of the picture shows. Two stills 2.8 m apart across the wrap differ no more than two stills 2.8 m apart elsewhere (worst tile at most 1.5 times, plus 1 level). A flight across the wrap, after 27 and 61 frames, matches stills at those places within the same margin of a flight elsewhere. |
| `loop` | no | The drawing stops at rest (no frame queued); nothing is drawn in a hidden tab; drawing starts again when the tab is shown. |
| `res` | no | With `?res=0.5`, the picture is drawn at half size in flight and at full size soon after the aircraft stops. No frame is shifted against a still at that place (the best shift within 6 pixels is 0, 0), and the settled picture is within 0.9 levels (mean) of the still, drawn at the settled picture's exposure (`?expo=`, read from `window.__exposure`; a page without them, like main, is compared as it comes). Without `res`, slow frames (60 ms) make the picture smaller, and fast ones (16 ms) restore it. |
| `flight` | no | Two flights of 61 frames (cruise, and near the clouds at 3 km) each stay within a limit (mean levels, per renderer, below) of a settled still at the place reached, drawn at the exposure the flight ended with (`?expo=`; a page without `window.__exposure` is compared as it comes). The flight's exposure over its last 20 frames also moves no more than 0.01 stops (no pumping). With a base, each also does no worse than the base's (at most 1.1 times, plus 0.03). |

The trace and the stills of a view come from one run of it, so the two checks together load each view once per page.

Without `--base`, the checks that need one are skipped (`SKIP`), and the others still run. A check that fails prints its numbers; its pictures are in its own folder of the run.

**The trace and the stills prove different things.** Equal traces mean that the page sent WebGL the same commands with the same values, and got the same buffers back. Equal stills mean that the composited picture is the same, with the CSS around the canvas and the overlays. A CSS filter on the canvas changes the stills and not the trace; a frame drawn in another order may change the trace and not the stills.

## The fake clock

Every page (except under `perf`) runs on a fake clock, so that two runs give the same frames:
- `performance.now()`, `requestAnimationFrame` and `cancelAnimationFrame` advance or act only when the tool steps a frame (`__step(n, ms)` in the page).
- `setTimeout`, `setInterval` and `requestIdleCallback` run on the fake clock too: in a step, the timers due run first (in the order of their time), then the animation frames. The page's fades of the overlays (6 s and 4 s) wait for the fake clock.
- `Date` starts at 2026-11-15 00:00 UTC and advances with the fake clock. The page reads the date for its default day, and the wall clock for the frame time that sets its drawing size in flight.
- The time zone is UTC and the language `en-US` (Chrome's `--lang`, and the DevTools locale), `Math.random` is seeded (mulberry32), and local storage is cleared.
- CSS transitions and animations are turned off: they would run on the real clock.
- The text and the controls over the hero (`.title`, `.panel`, `.hint`, `.fs`) and the scroll bar are hidden from the first frame on, except in the views marked `ui`.

**When is the page ready?** At the load event; where an element has `data-sky`, when its value is `ready` (`failed` stops the run); and when the network has been quiet for 300 ms (no request in flight, as the DevTools Network domain counts them), so that files fetched after the load, one after another, are in. A page that loads in parts should still mark itself `data-sky="loading"` in its markup: a pause longer than 300 ms between two requests would otherwise end the wait. While it says `loading` after the load event, the tools run the timers due and the animation frames it asks for, every 10 ms, without moving the fake clock (`__loading()` in the page): the page's loading, which waits a frame at a time, goes on, and all of it is frame 0. Its own frames must not start before it says `ready` (the page's `kick()` waits for the end of the loading). Then the tools let two real frames of the browser pass, so that the resize and intersection observers have run, before the first fake frame.

## The GL trace

The trace records what the page asks of WebGL, per canvas, in order: every call of every method of the context, with its arguments and its result. It also records `getContext` and every change of a canvas's size.

- Objects get names in the order they are made: `prog1`, `shader3`, `tex7`, `fb2`. A uniform location is named by its program and name: `prog1.uSun`.
- Numbers are written as the 32-bit floats that the GPU receives (the shortest decimal that gives the same float). Enums are named where an argument is an enum.
- A shader's text is named by a hash (`src:…`); each text is given once, at the end of the file.
- A large array (an upload) is written as its type, length and a hash of its bytes. An upload from an image, a canvas, a bitmap or an `ImageData` is written with a hash of its pixels.
- After each frame, every texture that the frame drew into is read back and hashed (`readback tex7 level 0 RGBA16F 480x420 = #…`, SHA-256 cut to 64 bits), and so is the canvas, if it was drawn. A 3D texture drawn layer by layer gets one hash for all its layers. A texture the trace cannot read back (an unknown format or size, a failed `readPixels`) is an error of the run, not a line that two traces could share.
- The read-back keeps the GL errors already pending for the page's own `getError`.
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

`step` takes frames and ms; `shot` a file and an optional clip; `eval` prints the value of a JavaScript expression in the page; `draws` prints the draw calls so far per canvas (to the screen, offscreen, and the size of the largest offscreen draw since the last draw to the screen: the size the picture is drawn at); `mouse` sends a DevTools `Input.dispatchMouseEvent`; `size` changes the viewport; `frames` waits for real browser frames; `sleep` waits real ms. Optional: `dpr`, `seed`, `realDate` (true: the real `Date`).

## Environment

| Variable | Meaning |
|---|---|
| `SKY_GPU` | `1`: draw on the GPU. Unset or `0`: SwiftShader, Chrome's software renderer, which works anywhere (CI too) and gives the same pixels on every run. |
| `SKY_GPU_ADAPTER` | On WSL2, the D3D12 adapter to use (default `NVIDIA`). |
| `SKY_CHROME` | The Chrome to start. Else the newest Chromium in Playwright's cache (`~/.cache/ms-playwright`), else `google-chrome` or `chromium` on PATH. |
| `SKY_CHROME_LIBS` | Directories put before `LD_LIBRARY_PATH` for Chrome, where it lacks system libraries. |
| `SKY_WRAP` | The queue for heavy runs: a path to a program that runs its arguments (like `heavy`). Default: `~/.claude/bin/heavy` if it exists. `none`: no queue. |
| `SKY_MEMORY_MAX` | The memory cap under the queue (default `3G`). |
| `SKY_TIMEOUT` | The time limit in seconds (defaults: trace 900, stills 2400, check 5400, drive 900, perf 300). |
| `SKY_READY_MS` | How long to wait for the page to be ready (default 180000). |

With a queue, the command runs again inside it: `heavy timeout --foreground -k 10 T systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0 -p TasksMax=500 -p RuntimeMaxSec=… node tools/sky.mjs …` (without `systemd-run` where there is none). It prints one line when it queues. The queue and everything under it run in a process group of their own, and the command passes `SIGINT`, `SIGTERM` and `SIGHUP` on to that group: Ctrl-C stops the run and frees the queue's slot. Without a queue, the command runs directly, with its own time limit.

Chrome always dies with the command: it is started in a process group of its own, under `setpriv --pdeathsig KILL`, and the group is killed on exit, on a signal and on an error. If Chrome or the page's renderer dies, every call waiting on it fails at once, and the run ends with the reason. Its profile goes in a short temporary directory (`/tmp/sky-…`): Chrome puts sockets there, and a long path makes it fail at start. Do not set `TMPDIR` to a long path. A run killed outright leaves its profile behind; each run removes this user's `sky-…` and `sky-base-…` folders older than a day.

### The owner's machine (WSL2, RTX 3090)

```sh
export SKY_CHROME_LIBS=/usr/lib/x86_64-linux-gnu:$HOME/.cache/explain-bash-tools/libs/usr/lib/x86_64-linux-gnu
SKY_GPU=1 node tools/sky.mjs check --base origin/main
```

- Playwright's Chromium lacks the NSS libraries there; they are unpacked under `~/.cache/explain-bash-tools/libs`. `/usr/lib/x86_64-linux-gnu` comes first, so that Mesa is the system's.
- With `SKY_GPU=1` and `/dev/dxg` present, the tools start Chrome with `--use-angle=gl-egl --ignore-gpu-blocklist` and set `GALLIUM_DRIVER=d3d12` and `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA`. Mesa then renders through D3D12 on the GPU; without `GALLIUM_DRIVER` it falls back to llvmpipe, on the CPU. `DISPLAY` is removed: with it, headless Chrome got no WebGL2. These flags live in `renderer()` in `lib/browser.mjs`.
- `~/.claude/bin/heavy` exists, so every run queues there (two heavy runs at a time) under a 3 GB cap.
- Every command prints the renderer: on the GPU it says `D3D12 (NVIDIA GeForce RTX 3090)`.
- No Japanese font is installed, so `ui-ja` is skipped.
- This GPU stack ignores the alpha of `blendColor` (see the [GLSL rules](../docs/development.md#glsl-rules)); SwiftShader does not.

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
  `EXT_disjoint_timer_query_webgl2`) at `--size` (default 1920x1080).
- `d3d programs`: each program `makeSky` links (its `link(...)` calls,
  with their defines), alone: the time to compile and link it, and of its
  first draw into one target and into all its outputs (ANGLE compiles a
  program again for a draw into more than one target).

With `--base`, the base and the page take turns, `--runs` times each. Every
line names the renderer: it must say `Direct3D11`. Headless Chrome did
not lose the context even where a draw held the GPU process for 143 s
(also with `--gpu-watchdog-timeout-seconds=2`), where a browser with a
window does: watch the times of the second compiles, not for a loss.

Measured on the owner's machine on 2026-11-19 (`d3d programs`, each
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
| `lib/d3d.mjs` | The command `d3d`: Windows Chrome on Direct3D 11, its harness pages, its cleanup. |
