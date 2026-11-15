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

Every command that loads the page takes `--page DIR`: the directory that holds `index.html`. The default is this repository. A local server serves it (no cache, the right MIME types for `.js`, `.mjs`, `.css`, `.glsl`, `.bin`), so pages that load modules and shader files work too. Output goes to `tools/out/` (ignored by git), unless `--out` says otherwise.

`--base` takes a directory, or a git revision of this repository (`origin/main`, `HEAD~1`, a SHA). A revision is exported with `git archive` into a temporary directory, which is deleted at the end.

| Command | What it does |
|---|---|
| `trace [--view NAME \| --q QUERY] [--frames N] [--ms MS] [--size WxH] [--out FILE]` | Writes the GL trace of the first N frames (default 12 frames of 16 ms, at 480x270). Without `--view` or `--q`, the page as it opens (flying). |
| `trace-diff A B [--ignore CLASSES] [--max N]` | Compares two traces. Prints the first differences by canvas, frame and call, then a summary. Exit status 0 if identical, 1 if not. |
| `stills [--views a,b] [--base DIR\|REV] [--size WxH]` | Stills of the fixed views in `tools/views.json`, and `index.html` to look at them. With `--base`, also the base's stills, the difference of each, and a difference picture (x8). |
| `img-diff A.png B.png [--out D.png] [--gain G] [--box x,y,w,h]` | Mean and max difference of two pictures (8-bit levels), and the share of pixels that differ by more than 2 and 8 levels. |
| `check [NAME...] [--base DIR\|REV] [--size WxH] [--ignore CLASSES]` | Runs the checks below, or those named. One line each, `PASS` or `FAIL`, then a last line `PASS` or `FAIL` for the whole set. Exit status 0 only if all pass. |
| `drive SCRIPT.json` | A scripted capture, for anything else. See below. |
| `perf [--q QUERY] [--size WxH] [--seconds S]` | Real time, without the fake clock: the time from navigation to the first draw of each canvas, the frame rate, and the GPU time per kind of draw (median and p90). Use it on the GPU, before and after a change; other runs that share the GPU make it vary by 10 to 20 %. |

The default size is 1280x720 on the GPU and 480x270 on SwiftShader. Traces always use 480x270, so that the traces of both renderers can be compared.

## The checks

| Check | Needs `--base` | Passes when |
|---|---|---|
| `trace` | yes | The traces of three views (the page as it opens, `night-dark`, `sea-low-sun`) equal the base's. `--ignore` applies. |
| `stills` | yes | Every view of `views.json` gives the base's picture exactly (max difference 0). |
| `skylight` | yes | The skylight (`#sky2`), scrolled into view, gives the base's pixels exactly, in four views: day, dusk, night and haze. |
| `wrap` | no | No seam where the way flown wraps at 256 km. Two stills 2.8 m apart across the wrap differ no more than 1.5 times (plus 0.3 levels) two stills 2.8 m apart elsewhere. A flight across the wrap, after 27 and 61 frames, matches stills at those places within the same margin of a flight elsewhere. |
| `loop` | no | The hero stops drawing at rest (no frame queued); nothing is drawn in a hidden tab; the hero is not drawn when scrolled out of view; drawing starts again in each case; with the hero out of view, the time-lapse draws the skylight but not the hero. A page that cannot scroll the hero out of view (`main` since 4ccf2e4, which has nothing below the hero) skips those parts, with a line saying so. |
| `res` | no | With `?res=0.5`, the picture is drawn at half size in flight and at full size soon after the aircraft stops. No frame is shifted against a still at that place (the best shift within 6 pixels is 0, 0), and the settled picture is within 1.5 levels (mean) of the still. Without `res`, slow frames (60 ms) make the picture smaller, and fast ones (16 ms) restore it. |
| `flight` | no | Two flights of 61 frames (cruise, and near the clouds at 3 km) each stay within 1.3 levels (mean) of a settled still at the place reached. |

Without `--base`, the checks that need one are skipped (`SKIP`), and the others still run.

**The skylight** (`#sky2`) has been removed from the page (558c255). The tools still test it where it exists (a branch older than the removal, or such a base), and skip it with a line saying so (`no #sky2 on this page: skipped`) where it does not, in the page or in the base. The parts to delete once no such branch is left: the check `skylight` (`CHECKS.skylight` in `lib/checks.mjs`), the skylight's part of the check `loop`, and `OPTIONAL` in `lib/trace.mjs` (which leaves a canvas `sky2` out of a trace comparison when only one trace has it).

The limits of `wrap`, `res` and `flight` were set from the numbers measured on `main` (below), with room for noise. A check that fails prints its numbers; its pictures are in `tools/out/check/NAME/`.

## The fake clock

Every page (except under `perf`) runs on a fake clock, so that two runs give the same frames:
- `performance.now()` and `requestAnimationFrame` advance only when the tool steps a frame (`__step(n, ms)` in the page).
- `Date` starts at 2026-11-15 00:00 UTC and advances with the fake clock. The page reads the date for its default day, and the wall clock for the frame time that sets its drawing size in flight.
- The time zone is UTC, `Math.random` is seeded, and local storage is cleared.
- The text and the controls over the hero, and the scroll bar, are hidden from the first frame on (except in `loop` and `skylight`, which need the page as it is).

A still stands at rest and steps 46 frames, so that the running mean settles (see [Judging a change](../docs/development.md#judging-a-change)). `views.json` adds `speed=0` to every view that does not set a speed.

**When is the page ready?** Today, at the load event. A page that loads in parts (fetched modules and shaders) must mark an element with `data-sky="loading"` in its markup, and set it to `ready` when it can draw, or to `failed`. The tools wait for `ready`, or stop on `failed`. Then they let two real frames of the browser pass, so that the resize and intersection observers have run, before the first fake frame.

## The GL trace

The trace records what the page asks of WebGL, per canvas, in order: every call of every method of the context, with its arguments and its result. It also records `getContext` and every change of a canvas's size.

- Objects get names in the order they are made: `prog1`, `shader3`, `tex7`, `fb2`. A uniform location is named by its program and name: `prog1.uSun`.
- Numbers are written as the 32-bit floats that the GPU receives (the shortest decimal that gives the same float). Enums are named where an argument is an enum.
- A shader's text is named by a hash (`src:…`); each text is given once, at the end of the file.
- A large array (an upload) is written as its type, length and a hash of its bytes.
- After each frame, every texture that the frame drew into is read back and hashed (`readback tex7 level 0 RGBA16F 480x420 = #…`), and so is the canvas, if it was drawn. A 3D texture drawn layer by layer gets one hash for all its layers.

Frame 0 is everything before the first fake frame: compiling, linking, building the noise, weather and wave textures. Frame k ends after the callbacks of the k-th frame.

Two traces are equal exactly when the page sent the same commands with the same values, and got the same pixels back. On one renderer, the same page gives the same trace byte for byte, run after run: the trace has no time in it and no GPU noise. Equal traces mean equal pictures.

The GPU and SwiftShader give different pictures, and the page asks some things that depend on the renderer (extensions). So compare traces of one renderer with each other. `--ignore readback` compares the commands alone, across renderers.

`trace-diff` and `check trace` can ignore classes of difference:

| Class | Ignores |
|---|---|
| `shader` | the text of shaders (the calls that pass a text still count) |
| `line` | `#line` directives in shader texts |
| `readback` | the hashes of what the frames drew |
| `query` | calls that only ask (`get…`, `is…`, `checkFramebufferStatus`), for example a different order of `getUniformLocation` |

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

`step` takes frames and ms; `shot` a file and an optional clip; `eval` prints the value of a JavaScript expression in the page; `draws` prints the draw calls so far per canvas (to the screen, offscreen, and the size of the last offscreen draw); `mouse` sends a DevTools `Input.dispatchMouseEvent`; `size` changes the viewport; `frames` waits for real browser frames; `sleep` waits real ms. Optional: `dpr`, `seed`, `realDate` (true: the real `Date`).

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

With a queue, the command runs again inside it: `heavy timeout -k 10 T systemd-run --user --scope -p MemoryMax=… -p MemorySwapMax=0 -p TasksMax=500 -p RuntimeMaxSec=… node tools/sky.mjs …` (without `systemd-run` where there is none). Without one, the command runs directly, with its own time limit.

Chrome always dies with the command: it is started in a process group of its own, under `setpriv --pdeathsig KILL`, and the group is killed on exit, on a signal and on an error. Its profile goes in a short temporary directory (`/tmp/sky-…`): Chrome puts sockets there, and a long path makes it fail at start. Do not set `TMPDIR` to a long path.

### The owner's machine (WSL2, RTX 3090)

```sh
export SKY_CHROME_LIBS=/usr/lib/x86_64-linux-gnu:$HOME/.cache/explain-bash-tools/libs/usr/lib/x86_64-linux-gnu
SKY_GPU=1 node tools/sky.mjs check --base origin/main
```

- Playwright's Chromium lacks the NSS libraries there; they are unpacked under `~/.cache/explain-bash-tools/libs`. `/usr/lib/x86_64-linux-gnu` comes first, so that Mesa is the system's.
- With `SKY_GPU=1` and `/dev/dxg` present, the tools start Chrome with `--use-angle=gl-egl --ignore-gpu-blocklist` and set `GALLIUM_DRIVER=d3d12` and `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA`. Mesa then renders through D3D12 on the GPU; without `GALLIUM_DRIVER` it falls back to llvmpipe, on the CPU. `DISPLAY` is removed: with it, headless Chrome got no WebGL2. These flags live in `renderer()` in `lib/browser.mjs`.
- `~/.claude/bin/heavy` exists, so every run queues there (two heavy runs at a time) under a 3 GB cap.
- Every command prints the renderer: on the GPU it says `D3D12 (NVIDIA GeForce RTX 3090)`.
- This GPU stack ignores the alpha of `blendColor` (see the [GLSL rules](../docs/development.md#glsl-rules)); SwiftShader does not.

## Timings

Measured on the owner's machine (WSL2, RTX 3090, 16 CPU threads) on 2026-11-16, each page against itself. Other runs shared the machine, so take them as rough.

| Run | GPU (1280x720) | SwiftShader (480x270) |
|---|---|---|
| `trace` (12 frames, 480x270), `main` at f37367c | 4.4 s | 15 s |
| `check` (all), `main` at f37367c (no skylight) | 3.1 min | not measured |
| `check` (all seven), `main` at 56e4c31 (with the skylight) | 3.6 min | 44 min |
| of which `stills` (12 views, page and base) | 87 s | 19 min |
| of which `wrap` | 38 s | 10 min |
| of which each of `trace`, `skylight`, `loop`, `res`, `flight` | 11 to 27 s | 0.5 to 5 min |

A trace of the page as it opens (`main` at f37367c, one canvas) is 3042 lines, 137 kB. The same page gave the same trace byte for byte, twice on each renderer.

The numbers the limits were set from (mean difference, 8-bit levels):

| Measure | GPU | SwiftShader |
|---|---|---|
| `wrap`: stills across the wrap, elsewhere | 0.33, 0.31 | 0.12, 0.13 |
| `wrap`: frame 27 of a flight against a still, across and elsewhere | 1.09, 0.98 | 0.81, 0.81 |
| `res`: settled picture against the still | 0.56 | 0.52 |
| `flight`: cruise, near the clouds | 0.83, 0.70 | 0.56, 0.96 |
| `flight` with the reprojection broken (`uWay` always 0) | 1.69, 1.56 | 0.74, 1.72 |

## Files

| File | What it holds |
|---|---|
| `sky.mjs` | The command line; the queue and the time limit. |
| `make-stars.py` | Builds the star catalogue (not a test tool; see above). |
| `views.json` | The fixed views for stills. |
| `lib/browser.mjs` | Finding and starting Chrome (the renderer flags), the DevTools connection, the local server. |
| `lib/page.mjs` | The driver: a page in a fresh tab on the fake clock, ready, stepped, shot. |
| `lib/inpage.mjs` | The script that runs in the page first: the fake clock, the draw counts, the GL trace. |
| `lib/trace.mjs` | The trace file: writing, reading, comparing. |
| `lib/png.mjs` | PNG reading and writing (Node's zlib), picture differences, the shift between two pictures. |
| `lib/run.mjs` | The commands `trace`, `stills`, `drive`, `perf`; base revisions. |
| `lib/checks.mjs` | The checks and their limits. |
