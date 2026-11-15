# Refactoring index.html into modules

Status: a plan, not yet carried out. It starts after the work now open is merged.

Line numbers are those of `main` at 9a4659c. The branches now open (clouds, cirrus, compositing, performance) will shift them when they merge. Every boundary below is a section marker or a function name, so re-map by name before each step. The statements about browser support (modules, import maps, `modulepreload`) and about the cache time of GitHub Pages are from memory: check each at the step that relies on it.

## 1. The present structure

| Part | Lines | Bytes | Depends on |
|---|---|---|---|
| Head, `<style>` | 1-210 | 5.7 kB | nothing; JS sets `--sx`, `--sy` |
| Markup | 211-324 | 5.7 kB | ids read by JS; slider defaults in `value` attributes |
| Star catalogue, base64 | 325 | 71 kB (53 kB of data, 8874 stars) | read once by `buildStars` |
| `noise` shader | 327-457 | 5.5 kB | its own PCG hash |
| `waves` shader | 459-510 | 2.0 kB | a second copy of PCG, inline in `rnd` |
| `fs` head: uniforms, constants | 513-592 | 3 kB | constants repeated in JS |
| `fs` air, night sky, `hash`, `ign` | 594-707 | 5 kB | head |
| `fs` clouds | 708-971 | 12.6 kB | air, `hash`, `ign` |
| `fs` sea, with `skyAt` | 972-1200 | 11.4 kB | air (`phases`, `addLight`), clouds (`cloudDensity`) |
| `fs` cirrus | 1201-1389 | 9.7 kB | air, clouds (`hg`, `WEATHER_KM`) |
| `fs` ground (skylight only) | 1390-1402 | 0.8 kB | air |
| `fs` `distanceCode`, `main` | 1404-1656 | 11 kB | all above; writes `outAux` for `mean` |
| `mean` shader | 1659-1816 | 7.4 kB | copies of `hash` and `RG`; decodes `distanceCode`; repeats the camera ray of `main` |
| `show` shader | 1818-1840 | 0.7 kB | a copy of `hash` |
| JS constants | 1845-1865 | 1.2 kB | |
| JS atmosphere tables | 1867-2004 | 7.5 kB | constants; pure |
| JS `state`, `builtHaze` | 2006-2014 | 0.6 kB | |
| JS astronomy (`celestial`) | 2016-2052 | 2 kB | state |
| JS stars | 2054-2104 | 3 kB | the `#stars` block in the DOM |
| JS exposure | 2106-2205 | 5 kB | atmosphere, state; at load it builds the scattering table, `DAY_LEVEL`, `NIGHT` |
| JS renderer (`camera`, `makeSky`) | 2207-2600 | 19 kB | all of the above; the five shader blocks by id |
| JS lit wall (`layoutLight`) | 2602-2641 | 2.5 kB | state, `sunColour`, DOM |
| JS wiring, frame loop | 2643-2711 | 3.5 kB | `makeSky`, exposure, astronomy, the wall, the UI |
| JS controls, labels, URL | 2713-2803 | 4.5 kB | state, `update` |
| JS start | 2805-2818 | 0.7 kB | controls, astronomy |

The JS is about 49 kB in one IIFE; the `fs` shader is about 54 kB.

**How shaders are built today:**
- `link()` in `makeSky` reads the `textContent` of a block by id.
- `fs` gets `#define AIRCRAFT n` by a string replace after `#version`, so error line numbers are one off.
- The vertex shader is a string literal.

**Code shared by copy:**
- `hash`, identical in `fs`, `mean` and `show`.
- PCG in `noise` and in `waves`.
- `RG`.
- The camera ray in `fs` `main` and in `mean` `whence`.
- `distanceCode` (in `fs`) and `decode` (in `mean`) are two halves of one format.
- JS and GLSL share the air model by copy: `RG`, `RT`, `HR`, `HM`, `BETA_M`, `MIE_EXT`, `NMU`, `NH`, `MS_MU_MIN`, `GRID`, `SLOTS`, `LN_FLUX_MAX`, `WEATHER_KM`. `sunDepth` and `multiScatter` in JS mirror `depthToTop` and `multiScatter` in GLSL.

**Traps:**
- One shared `let`: `builtHaze`. It is written at 2157 and 2679 and read in `makeSky` at 2360.
- Start-up order matters. `DAY_LEVEL` and `NIGHT` (2156-2160) are metered at load with the default `state.haze` (0.35), before the URL is read (2768). Reading the URL earlier, or moving the defaults, would change `uNight`, and so the night sky.
- The catalogue comment credits ESA's Hipparcos Catalogue and names a licence. Whether that fits the project is being decided separately.

## 2. Options and decision

| | A: one file, tidied | B: classic scripts | C: ES modules, `.glsl` fetched | D: build to one file |
|---|---|---|---|---|
| Opens from `file://` | yes | yes | no (a notice says so) | the built file only |
| Tools, Pages | as now | as now | as now (HTTP) | build first |
| GLSL check in CI | fragile | after a join | after a join; plain files | yes |
| JS unit tests | fragile | `require` of scripts | `import` of modules | yes |
| Fewer collisions | no | yes | yes | yes |
| Main cost | does not fix collisions | GLSL inside JS strings | needs a local server | two forms of the page |

**Decision: C, chosen by the owner on 2026-11-15.**
- Pages and the pull-request previews make opening the page from disk unnecessary.
- C keeps the shaders as plain `.glsl` files that editors and validators read directly. Its imports show which module depends on which.
- B was not taken: it would keep GLSL inside JS template strings only to keep `file://`.
- D was not taken: a build adds a second form of the page and a step before every capture, and no one-file copy is needed.

## 3. The design

### File tree
```
index.html               head, markup, the file: notice, the module tag (~9 kB)
sky.css
js/  constants.js atmosphere.js state.js astronomy.js stars.js exposure.js
     glsl.js gl.js textures.js renderer.js room.js labels.js loop.js ui.js
     shaders.js main.js
glsl/scene.glsl          the root: #include lines and the #if AIRCRAFT frame
glsl/scene/  head air night clouds sea cirrus ground main   (.glsl)
glsl/lib/    hash pcg distance                               (.glsl)
glsl/  noise.glsl waves.glsl mean.glsl show.glsl
data/stars.bin  data/stars.md
docs/refactoring.md
tools/  test/  package.json  eslint.config.js     (not loaded by the page)
```
- All URLs are relative (`new URL('../glsl/x', import.meta.url)`), so the page also works under `pr/N/`.
- `package.json` holds only `"private": true` and `"type": "module"`. It has no dependencies.

### JS modules

| Module | Present lines | Exports | Imports |
|---|---|---|---|
| `constants.js` | 1845-1865 | `RAD` … `MIN_SCALE` | none |
| `atmosphere.js` | 1867-2004, 2014 | `RG RT HR HM BETA_M MIE_EXT NW WL BR BO W WY toRGB sunDepth NMU NH msData multiScatter buildMultiScatter ensureMultiScatter builtHaze` | none |
| `state.js` | 2006-2013 | `state` | constants |
| `astronomy.js` | 2016-2052 | `onSky fromEcliptic celestial` (later `moonAgeOn`) | constants, state |
| `stars.js` | 2054-2104 | `GRID SLOTS starData buildStars(bytes)` | constants |
| `exposure.js` | 2106-2205 | `DAY_LEVEL NIGHT twilightGain airExposure sunColour` | constants, atmosphere, state |
| `glsl.js` | new | `assemble(root, sources, defines)`, `nameLog(log, names)` | none |
| `gl.js` | 2227-2242 | `linker(gl)`: `compile`, `link`, the vertex shader | glsl |
| `textures.js` | 2250-2323 | `buildCloudTextures(gl, link, src)`, `buildWaves(gl, link, src)` | constants |
| `renderer.js` | 2207-2226, 2243-2249, 2325-2600 | `camera`, `makeSky(canvas, view, aircraft, src)` | constants, atmosphere, state, exposure, stars, gl, textures |
| `room.js` | 2602-2641 | `layoutLight` | constants, state, exposure |
| `labels.js` | 2713-2740 (the outputs), 2743 | `showLabels`, `YEAR` | state |
| `loop.js` | 2643-2645, 2664-2711 | `wrap`, `startLoop(views)`, `update`, `kick` | constants, atmosphere, state, astronomy, exposure, room, labels |
| `ui.js` | 2713-2722 (the sliders), 2744-2803 | `params`, `readInputs`, `initControls(hero)` | constants, state, loop, labels |
| `shaders.js` | new | `SHADER_FILES` (every `.glsl` file) | none |
| `main.js` | 2646-2662, 2805-2818 | the entry; async `start()` | all |

**Pure modules.** These do not touch `document` or `location` when they load, so Node can import them: `constants`, `atmosphere`, `state`, `astronomy`, `stars`, `exposure`, `glsl`, `shaders`.

**No cycles.** `showLabels` has its own module, so `loop.js` and `ui.js` do not import each other. `loop.js` gets the list of views from `main.js`.

**`builtHaze`.** It stays an exported `let` in `atmosphere.js`. Importers always see its current value but cannot assign it. Only `ensureMultiScatter(haze)` writes it: it rebuilds the table when `haze !== builtHaze`, then sets `builtHaze`. Today's load-time build (2156-2157) and the check in `frame` (2677-2679) both become `ensureMultiScatter(state.haze)`; at load `builtHaze` is still `null`, so the table is built as today. The `draw` closure in `makeSky` keeps its own `tableHaze` and compares it with the imported `builtHaze`.

**Start-up order.** `index.html` has a single `<script type="module" src="js/main.js">`. Modules run depth first, in the order of each file's `import` lines, and each module before the ones that import it. `exposure.js` imports only constants, atmosphere and state, so it meters `DAY_LEVEL` and `NIGHT` with the default haze while the modules load. The URL is read only in `initControls()`, which `start()` calls later. A unit test checks that `NIGHT` equals the value metered with haze 0.35, and the GL trace checks `uNight`.

`start()` does, in this order:
1. Fetch every file of `SHADER_FILES` and `data/stars.bin`, all at once (`Promise.all`).
2. `buildStars(bytes)`. Today it runs before `exposure`; the two are independent, and the trace proves it.
3. `makeSky` for the hero and for the skylight, each in its own `try`, as today.
4. `startLoop(views)`, which adds the visibility, scroll and `IntersectionObserver` listeners.
5. `initControls()`.
6. `ResizeObserver` and `resize`, then `readInputs()`, `celestial()`, and yaw, pitch, heading and `at` from the URL.
7. Set `data-sky="ready"` on the hero section.

### Shaders, the joiner, error messages
- Shaders are plain `.glsl` files. The root files `scene`, `noise`, `waves`, `mean` and `show` include parts with `#include "scene/sea.glsl"`.
- `assemble()` replaces each include line by the file's text. It includes each file at most once and fails on a missing file or a cycle. It puts `#define AIRCRAFT n` after `#version`.
- `assemble()` also emits `#line` directives, so that each file keeps its own line numbers:
  - `#line 2 0` after the define;
  - `#line 1 k` before part `k`;
  - `#line n p` after it, to return to the parent `p` (GLSL ES 3.00 allows a source-string number).
- `assemble()` returns the text and the list of file names. `compile()` passes the info log through `nameLog`, which turns `ERROR: 3:45:` into `ERROR: scene/sea.glsl:45:`. If the log has another form, it is shown as it is.
- The scene root:
  ```
  #include "scene/head.glsl"      513-592
  #include "scene/air.glsl"       594-707 (night helpers 636-669 later move to scene/night)
  #if AIRCRAFT                    708-711, with its comment
  #include "scene/clouds.glsl"    712-971
  #include "scene/sea.glsl"       972-1200
  #include "scene/cirrus.glsl"    1201-1389
  #else
  #include "scene/ground.glsl"    1391-1401
  #endif
  #include "scene/main.glsl"      1404-1656
  ```
- The vertex shader stays a string in `gl.js`.

### Loading, failure, `file://`
- **While loading.** The hero shows its CSS gradient, the text and the controls, as today before the first frame. The skylight shows its CSS colour.
- **When a fetch fails.** `start()` catches the error, logs it with the file name, and sets `data-sky="failed"`. CSS then shows a notice in the hero: 「空を読み込めませんでした。再読み込みしてください。」 / "Could not load the sky. Please reload."
- **From disk.** A classic inline script right after the notice element runs before any module:
  ```html
  <p id="notice" class="notice" hidden></p>
  <script>
  if (location.protocol === 'file:') {
    const n = document.getElementById('notice');
    n.hidden = false;
    n.textContent = 'このページはファイルから直接開けません。ウェブサーバーから開くか、公開版 https://sf624.github.io/sky/ をご覧ください。'
      + ' / This page does not run from a file. Open it through a web server, or see https://sf624.github.io/sky/.';
  }
  </script>
  ```
- **Viewing locally.** One command in the repository: `python3 tools/serve.py`, then open `http://localhost:8000/`. `serve.py` is about 20 lines of standard-library Python. It sends `Cache-Control: no-store`, so an edited module is never served stale, and it sends a JavaScript MIME type for `.js`. Plain `python3 -m http.server` also works, but needs a hard reload after edits.
- **Pull requests.** Every PR gets a preview at `https://sf624.github.io/sky/pr/N/`. The link is commented on the PR and follows each push about a minute behind.

### The star file
- `data/stars.bin` holds exactly the bytes the base64 holds today: 8874 records of 6 bytes, 53,244 bytes, brightest first, stars to magnitude 6.5.
- Each record is little-endian:
  - right ascension, u16, in turns × 65536;
  - declination, u16, (dec + 90) / 180 × 65535;
  - V magnitude, u8, (V + 1.5) / 8 × 255;
  - B-V, u8, (B-V + 0.5) / 2.5 × 255.
- `buildStars` reads a `Uint8Array` instead of `atob` and `charCodeAt`. The arithmetic stays the same.
- `data/stars.md` is its notice. It gives the source and credit line as `index.html` gives them today, the format above, and how the file was made (the script, if the owner has it). It also says that the licence of this data is being decided separately.

## 4. Steps
Each step must give:
- the same GL trace (step 0), with the exceptions noted;
- stills with max difference 0, from the fixed set;
- `t_sky2` identical;
- `t_loop`, `t_res` and `t_wrap` passing.

Review moves with `git diff --color-moved=dimmed-zebra`.

**The freeze.** Steps 3a to 5 move code that every branch edits. Run them as one series with no other branch open, each merged before the next. Git cannot follow one file split into many, so a branch older than the split must be rebased and re-applied by hand, using the tables above.

| Step | What moves | Proof | Size | Freeze |
|---|---|---|---|---|
| 0 | Tools into `tools/`. A GL trace: on the fake clock, for the first N frames, it logs shader text, every uniform value, hashes of texture uploads and of the built textures (read back), and draw calls. The harness waits for `data-sky="ready"` (on the old page: the `load` event). | the trace of `main` is the same twice | ~300 lines, no page change | no |
| 1 | CSS to `sky.css` | trace, stills | 5.5 kB moved | no |
| 2 | Publish-time stamp (section 5, caching), in `pages.yml` and `tools/stamp.py` | preview loads, map complete | ~70 lines | no |
| 3a | The whole IIFE body to `js/main.js` as one module; the `file:` notice | trace, stills; `file:` shows the notice | 49 kB moved, ~20 lines | yes |
| 3b | constants, atmosphere, state, astronomy, stars, exposure to their modules; `ensureMultiScatter` | trace (`uNight` too), stills | ~20 kB moved, ~50 lines | yes |
| 3c | gl, textures, renderer | trace, stills | ~22 kB moved, ~40 lines | yes |
| 3d | room, labels, loop, ui; `main` as entry | trace, stills, t_loop | ~10 kB moved, ~40 lines | yes |
| 4 | The five shader blocks to `.glsl` files as they are; `shaders.js`, the fetch, `data-sky`, the failure notice | shader text identical to 3d's; trace, stills | 70 kB moved, ~60 lines | yes |
| 5 | The scene split into parts; `assemble()` without `#line` | joined text byte-identical to step 4's, both `AIRCRAFT` values | ~50 lines | yes |
| 6 | `#line` and `nameLog` | trace except `#line` lines; a broken part on a scratch branch prints `scene/sea.glsl:45` | ~40 lines | no |
| 7 | Stars to `data/stars.bin` and `data/stars.md` | star texture hash identical | -71 kB, ~15 lines | no |
| 8 | Clean-ups, one PR each: `lib/hash` (scene, mean, show), `lib/pcg` (noise, waves; integer arithmetic, exact), `lib/distance`, `scene/night`, per-part uniforms, `moonAgeOn` to astronomy | trace except shader text; stills; noise and wave textures identical | <100 lines each | no |
| 9 | CI (section 6), a file map for contributors in `docs/` | CI green on `main` | ~300 lines | no |

## 5. Risks of C
- **Mixed versions after a deploy.**
  - The problem: Pages lets browsers cache files for about 10 minutes. A visitor can get a new `index.html` or module next to old ones, and a renamed export or uniform would break the page. Plain `?v=` on the module tag does not reach the modules it imports.
  - The fix, applied to the published copy only (root and `pr/N/`): the workflow runs `tools/stamp.py`, which writes three things into `index.html`:
    - an import map that maps every `js/*.js` to `js/*.js?v=<sha>`;
    - `<meta name="sky-version" content="<sha>">`, which `start()` appends to its fetch URLs;
    - `?v=` on `sky.css` and on the `modulepreload` links.
  - The sources in the repository have none of this and run as they are.
  - Browsers without import maps (before Safari 16.4) ignore the map. They still run the page, only without the cache fix.
- **Requests and first paint.**
  - About 35 requests instead of 1; the gzipped total stays about 97 kB.
  - Imports alone would form a chain three or four modules deep. `<link rel="modulepreload">` for every module in `index.html` fetches them all at once, and CI checks the list is complete. The shader files are fetched together from `SHADER_FILES`.
  - The text paints as today. The sky waits for about one or two more round trips, small next to compiling the shaders and building the textures.
  - Measure the time to the first `drawArrays` with the trace, before and after step 4.
- **Top-level await.** Not used: `start()` is an async function. Module support (Chrome 61, Safari 11, Firefox 60) is older than WebGL2 in Safari (15).
- **The capture tools.** They serve over HTTP, so they should work. Verify in step 3a and again in step 4:
  - their server sends a JavaScript MIME type for `.js` (modules require one) and serves `.glsl` and `.bin`;
  - there is no 404 or MIME error in the console;
  - query strings like `index.html?time=17` do not touch the module URLs;
  - the harness waits for `data-sky="ready"` before stepping frames; without that, the stills would change;
  - the SwiftShader check still compiles everything.
- **Errors in parts.** `#line` comes only after `#version`. Compilers that print another log form get the raw log.
- **The skylight.** The `AIRCRAFT 0` text must stay identical, including the `#else` part. The trace covers both programs.

## 6. CI afterwards (`check.yml`, on pull requests)
1. **ESLint** (MIT, run with npx), with `eslint.config.js`: module source type, browser globals, `no-undef`, `no-unused-vars`.
2. **`node --test test/`** (built in, no dependency). It imports the pure modules directly. Tests:
   - Astronomy: at the equinox at noon the sun stands at 55 degrees; at the June solstice at 78.4; at midnight it is below the horizon.
   - `moonAgeOn`: age 0 on 6 January 2000, a period of 29.53 days.
   - Stars, from `data/stars.bin`: length a multiple of 6, 8874 stars, brightest first, Sirius in place, no cell over `SLOTS`.
   - Atmosphere tables: finite, transmittance between 0 and 1.
   - `NIGHT` equals the value metered with the default haze.
   - The joiner: every include resolves; no file is included twice; no cycles; no `#include` left in the result; `SHADER_FILES` and the `modulepreload` list match the files on disk.
   - The JS and GLSL constants agree (parse `const float X = v;`).
   - No import cycles (parse the `import` lines).
3. **GLSL.** Assemble scene (`AIRCRAFT` 0 and 1), `noise`, `waves`, `mean`, `show` and the vertex shader with `assemble()`, and run `glslangValidator -S frag` (or `-S vert`). It comes from apt `glslang-tools` and is used as a separate program. Also grep for house rules glslang does not know (`CONSTANT_ALPHA`).
4. **Browser smoke test.** Headless Chrome on SwiftShader, through Playwright or Puppeteer, installed in CI only. Serve with `tools/serve.py`, wait for `data-sky="ready"`, draw 3 frames at 320x180. Fail on any console error, a blank picture, or a loop that does not stop at rest. Load the page once as `file:` and check that the notice shows.
5. **Refactor proof** (on a `refactor` label). Run the GL trace and SwiftShader stills of the base and the head in one job, and fail on any difference. SwiftShader gives the same result twice on one machine.

GPU timing (`gput.sh`) and the realism stills stay local. Pages publishing excludes `tools/`, `test/`, `docs/`, `package.json` and `eslint.config.js`.

## Not done
- A build that emits one file (option D): not needed. The owner did not ask for a one-file copy.
