# How Sky draws a frame

This document follows one frame from the address bar to the pixel. It
describes the code on `main` as it is. Names are those of `index.html`:
functions, constants, uniforms and element ids. Plans and known flaws are
in the [issues](https://github.com/sf624/sky/issues), not here.

## The page

`index.html` holds everything: the markup, the CSS and ten `<script>`
blocks. It loads no other file.

| Block | Kind | What it is |
|---|---|---|
| (no id) | JS | `TEXT`, the strings in Japanese and English, and `applyLanguage`. It runs right after the panel. |
| `stars` | data | The star catalogue, base64 (see [Stars](#sun-moon-stars)). One very long line: never print it. |
| `noise` | fragment shader | Draws the cloud noise and the weather map once, at start. |
| `ice` | fragment shader | Draws the cirrus's map, ice, way and fibres once, at start or when cirrus is first shown (see [Cirrus](#cirrus)). |
| `waves` | fragment shader | Draws the map of the waves on the sea once, at start. |
| `fs` | fragment shader | The scene: air, clouds, sea, cirrus, sun, moon, stars. With `SHADOW_MAP` defined, the map of the clouds' shadow. |
| `mean` | fragment shader | Joins each new frame of the aircraft's view to the picture so far. |
| `show` | fragment shader | Copies that picture to the canvas, with dither. |
| `meter` | fragment shader | Meters the picture for the exposure, block by block. |
| (no id) | JS | `SkySound`: the background sound (see [Sound](#sound)). |
| (no id) | JS | Everything else, in one function that runs at load and starts the loading. |

There is one canvas, `#sky`, the hero: the view from an aircraft. Clouds,
sea, cirrus, glare. It flies (900 km/h by default) and is drawn as a mean
over frames. It fills the window, and the page does not scroll.
`makeSky(canvas, view, { done, shown })` makes its renderer, a step at a
time (see the next section).

## Conventions

- **Lengths** are in km, in the shaders and in the JS.
- **Axes**: x west, y up, z south. The centre of the planet is the origin.
  The eye is at `(0, RG + uAlt, 0)`, with `RG` = 6360 km (the ground) and
  `RT` = 6460 km (the top of the air).
- **Directions**: `yaw` 0 looks south, 90 degrees west, -90 degrees east;
  a larger `yaw` turns the view to the right (clockwise seen from above),
  and a drag to the right lowers it. `pitch` is positive upwards.
  `camera(yaw, pitch)` gives the column-major `uCam`: right, up, forward.
  `uTan` is the tangent of half the vertical field of view (`FOV` = 62
  degrees for the hero).
- **Spectra** are twelve wavelengths, 405 to 680 nm in steps of 25 (`WL`),
  stored as `vec4 X[3]`: four wavelengths per `vec4`. Loops run
  `for (int k = 0; k < 3; k++)`. `uWL` holds each wavelength divided by
  550 nm.
- **Light** is in units of the sun's irradiance. The weights `uWR`, `uWG`,
  `uWB` turn a spectrum into linear sRGB with the solar spectrum folded in
  (`W` in the JS, from the CIE 1931 functions `CMF` and `SOLAR`); the bare
  sun has luminance 1. `main` multiplies by `ISUN` = 20.
- **The way flown.** The aircraft does not move: the world does. `state.drift`
  is the way made over the sea, in km, wrapped to `[0, WEATHER_KM)` with
  `WEATHER_KM` = 256 so that it keeps its precision in single-precision
  floats. The shader reads clouds, sea and cirrus at `p.xz + uDrift`. When
  the drift wraps, every pattern read there jumps by 256 km, so **every
  pattern must repeat a whole number of times in 256 km**, or a seam shows.
  Hence `BASE_KM` = 8 (32 tiles of the noise), `DETAIL` = 7 (whole tiles of
  the fine noise per tile), the wave bands and the cells of the foam
  rounded to whole numbers per map (`rep`, `cells`), the swells with whole
  numbers of crests (`SWELL`), the cirrus frames stepping by whole numbers
  (the tile of the ice twice or four times in a unit of each, and every
  noise in the ice with a whole number of cells to the tile), and the bands
  of the cirrus's map written with whole-number frequencies in its frame.
- Comments in the code are plain English sentences that say what and why.

## From the address bar to the first frame

The page shows at once in its loading state: the hero is dark (`.loading`,
a gradient of a night sky), with the title over it. After 0.3 s a thin line
of progress and a word (`TEXT.loading`) fade in, so a quick start shows only
the dark. The panel and the full-screen button stay hidden (no clicks, no
focus) until the first picture. All of this is HTML and CSS: it needs no
script.

The JS then runs once, at load, and does little:

1. **Inputs.** URL parameters with the id of a slider set that slider's
   value (the browser clamps it to the slider's range and step). Then
   `readInputs()` copies the sliders into `state`. `now`, `rate` and `play`
   then act as the now button, the select and the play button, but the
   time does not run yet (see below). `yaw`, `pitch`, `heading`, `at`,
   `pixels` and `res` are read directly (see
   [development.md](development.md#url-parameters)). Without `yaw`, the view
   starts 65 degrees to the side of the sun; without `heading`, the
   aircraft flies 60 degrees to the left of the view.
2. **The loading.** After the first paint (an animation frame, then a
   message), `makeSky` for `#sky` makes the renderer. It is an `async`
   function: it waits a frame (`nextFrame`) wherever it would otherwise
   hold the main thread or wait for the GPU. Its steps:
   - `getContext`, and the extensions.
   - Every program (`fs`, `noise`, `ice`, `waves`, `mean`, `show`, `meter`) is
     compiled and linked at once, and nothing asks how it went yet. With
     `KHR_parallel_shader_compile`, the GPU process compiles them on threads
     of its own; the page asks `COMPLETION_STATUS_KHR` once a frame. Without
     it, asking waits, so the page asks for one program a frame. A failed
     program throws the compiler's or the linker's message.
   - Meanwhile the tables of the CPU, in slices of about 8 ms, one a task
     (`slices`). Each is a generator (a job) that yields every little while;
     `finish(job)` runs one at once.
     - `odTable` (`buildDepths`): optical depth to the top of the air
       towards the sun, over altitude (48 rows, squared spacing) and the
       cosine of the sun's zenith angle (96 columns from -0.2), 64 steps
       each. Read by `sunDepth()` in the JS only.
     - `starData` (`buildStars`): the star texture.
     - the table of `depthToTop` (`depthTable`, see [The air](#the-air)).
     - `msData` (`buildMultiScatter(haze)`): the multiple-scattering table
       (see [The air](#the-air)), for the haze given, the longest (0.2 to
       0.3 s). It reads `odTable` (through `sunDepth`), so it starts when
       that is done, and goes on beside the star and depth tables, while the
       GPU compiles the programs and draws the textures; the first frame
       waits for it.
     - The slices of all these are paced by timers (`soon`), not by frames:
       while the page starts and the GPU draws the textures, a frame comes
       only every 50 ms or so. Paced by frames, after the other tables, the
       multiple-scattering table took 1.8 s and held the first picture back
       by 0.4 s.
     - With them goes a constant, `NIGHT`: the moonless night sky
       (airglow), 8.59e-10 of the sun's irradiance, about 4e-8 of the
       daytime sky.
   - The textures (see [Textures made at start](#textures-made-at-start)).
     The noise and the weather map are drawn in batches (`batches`), the
     weather map in strips of 64 rows (the scissor; each pixel is the
     same as from one draw), and so are the cirrus's ice and its fibres in
     pieces of 512 x 512, after the noise, if the page starts with cirrus
     (else `render` draws them all at once when cirrus is first shown; see
     [Cirrus](#cirrus)). The cirrus's map is drawn before the noise, as soon
     as the programs are linked: some drivers finish a program only at its
     first draw (see `prime`), and the ice program is large; its driver
     works on it while the noise is built. After each batch the page waits for a fence
     (`settle`); a batch doubles while the GPU gets through it in under
     100 ms (up to 64 pieces of the ice) and halves over 250 ms. The GPU process draws the whole
     browser, and a slow GPU given seconds of work at once would freeze it.
   - `prime`: the first frame is drawn as the first frame will draw it
     (`render` as a probe, which then puts its state back), and `show` once
     without a pixel (the scissor). Some drivers finish a program only at
     its first draw, which can take a second: that happens now. Once a
     fence says the GPU is done, the meter of that frame is read: the read
     does not wait.
3. **The hand-over.** The hero's `data-sky` becomes `ready` (`failed`
   without WebGL2 or if a program failed: the error goes to the console,
   the loading state fades out, and the canvas keeps its CSS gradient).
   `kick()` asks for the first frame; a time-lapse asked for in the address
   starts now; the title's and the panel's timers start (see `.told` and
   `.still`). Before this, `kick()` and `schedule()` do nothing.
4. **The first picture.** The first frame is only metered, as always (see
   [Exposure](#exposure-and-the-tone-curve)); if what it is drawn from is
   what `prime` drew, prime's reading stands, else it reads the meter at
   once. The second frame goes to the canvas, and `render` calls `shown()`:
   the hero gets `.shown`, and the loading state fades out over the picture
   in 0.8 s (it lets the pointer through at once), while the panel fades
   in. The class and the picture reach the screen in the same frame, and
   the fade starts from opaque: nothing empty or half drawn shows.

So no step holds the main thread for long, except `getContext` itself.
The pictures are the same as when everything ran at once: the jobs and
batches only split the same work.

A hidden tab has no animation frames: there `nextFrame` waits 100 ms
instead (the browser slows that down further), so the loading goes on
slowly; the first frame waits until the tab is shown.

**The loop.** `update()` marks the state changed and calls `kick()`,
which asks for one `requestAnimationFrame(frame)`.

`frame(now)` then:

- does nothing in a hidden tab;
- if something changed: rebuilds `msData` when the haze has changed (at
  once, with `finish`; it takes about a quarter of a second: while the haze
  slider moves, it is built `HAZE_WAIT` = 250 ms after the last move), runs
  `celestial()` and sets the panel's labels;
- moves the aircraft: `state.drift` grows by `speed / 3600 * dt` along
  `state.heading` (`dt` capped at 0.1 s, and 0 after a pause, so the
  aircraft never jumps);
- calls the renderer, which draws the clouds' shadow map first when it
  is out of date (see [The clouds' shadow](#the-clouds-shadow));
- asks for another frame only if the renderer returned true.

The renderer returns true while the aircraft flies, while its picture is
still settling, or while the exposure moves. So the page draws nothing at rest once the picture is
clean, or in a hidden tab. `visibilitychange` calls `kick()` again.

**Playing.** The play button runs the time at the rate of the select beside
it (`pace`, a factor of real time; 960 at first, a day in a minute and a
half). Each `tick()` moves the time by the time elapsed since the last tick
(`performance.now()`) times the rate. A gap longer than a quarter of a second
is not a frame (the tab was hidden): at real time the time catches up with
it, at the faster rates it counts as 0.25 s, so the time does not leap. A
new rate applies from the moment it is chosen. Past 24:00 the date moves
on by a day, and from the last day of the year to the first. The moon's age
runs on with the time, a day of age a day, and so does the sun on the
ecliptic (`state.dayShift`, see below): nothing jumps at midnight. At the
faster rates, ticks come with the frames (`requestAnimationFrame`), and
every frame is drawn again.

**Real time.** The sun moves a quarter of a degree a minute. At the default
drawing limit (WQHD, 1440 rows over the 62 degrees of the view) that is
less than a pixel in 10 s. So at real time the ticks come from a timer,
once a second, and the time that is drawn (`state.time`) moves in steps of
10 s (`REAL_STEP`): each step draws the picture again and lets it settle
(39 frames), and nothing is drawn in between, about 6 % of the frames.
The panel's clock shows the minute, which changes only on a step. In a
hidden tab the timer runs on (the browser slows it); `visibilitychange`
brings the time to the present at once. In flight every frame is drawn
anyway.

**Now.** The now button sets the date to today, the time to the device's
clock (taken as local solar time), the moon's age as moving the date does,
the rate to real time, and plays.

## Sun, moon and sky in the JS

`celestial()` places the sun, the moon and the stars for `state.day` and
`state.time`:

- The observer is at `LATITUDE` = 35 degrees north. The time is local solar
  time: the sun is due south at 12:00.
- The sun moves along the ecliptic (`OBLIQUITY` = 23.44 degrees), at
  longitude 0 on day 80.
- The moon runs ahead of the sun along the ecliptic by its age
  (`state.moonAge / 29.53` of a turn). Its orbit's tilt is left out.
- Moonlight is 2.5e-6 of sunlight at full moon, falling with the phase
  angle (`state.moonI`). It is there at every hour, by day too. Only its
  light in the air (`uMoonI`, `moonAirFor`) is left out where it cannot
  show: it fades out as the moonlit air (the air's mean light, `airLevel`,
  for each light) goes from 11 to 14 stops below the sunlit air
  (`MOON_AIR`), a twentieth of a step of the screen or less. By day that
  saves a second light in every march (4.8 ms of 22 at 2560 x 1440); with
  a full moon it comes in fully with the sun 5 degrees down.
- A light below the horizon still lights the air above until it is some
  18 degrees down. `state.sunOn` (`uSunI`) fades from 1 to 0 as the sun goes
  from 18 to 21 degrees down (a smoothstep, `lit`), so that no step shows
  when it stops mattering; the moon's light fades the same way.
- One light for the clouds and the sea (`uLight`, `uLightI`): the sun,
  then the moon. It never steps: the sun's share (`state.lightShare`,
  `uLightShare`) fades from 1 to 0 as the sun goes from 3 to 4.5 degrees
  down, the light turns to the moon there, and the moon's share comes in
  by 6 degrees down (`LIGHT_SWAP`). The clouds' shadows (on the sea, in
  the air, and the light of the lit clouds around a shaded side) come and
  go with the share. In between, both lights are faint beside the light of
  the twilight's sky. Before, the light turned from the sun to the moon at
  once at -3 degrees, and with it the shadows on the sea.
- The eye's night vision (`nightEyeFor`, `uNightEye`) follows the eye's
  adaptation, not the hour: it comes in from 0 to 1 as the exposure (log2)
  goes from 5.5 to 9 (`NIGHT_EYE`, a smoothstep). In a view away from the
  sun that is with the sun from about 3 to 6 degrees down; towards the
  glow of the sunset, which holds the exposure down, a degree or two later.
  It sets the rods' grey and the night's tone curve ([Exposure and the
  tone curve](#exposure-and-the-tone-curve)) and the moon's glitter as
  sparkles ([The sea](#the-sea)). At the start the sky is still some 30
  cd/m2, far too bright for the rods to matter. Before, it came in with the
  sun from -3 to -6 degrees, and also raised the Milky Way and set which
  stars were drawn.
- `state.sky` (`uSky`) turns J2000 equatorial directions into local axes.

The date slider covers the current year. The moon's age starts from the
date (`moonAgeOn`: the mean lunation, from the new moon of 6 January 2000)
and is set again whenever the date slider moves; the moon slider then
changes it alone. With `date` and no `moon` in the address, it follows the
given date.

The sun's place on the ecliptic comes from the day number, one step a day.
While the time plays past midnight, `state.dayShift` (in days) holds the
sun where the time has carried it: it grows with the time and loses a day
when the date moves on, so the sun and the stars turn on smoothly. Setting
the date or the time sets it back to 0.

## The air

`main` in `fs` marches along the view ray from the eye to the top of the
air, or to the sea. The air is three species, with densities from
`density(h)`:

- Rayleigh: `exp(-h / HR)`, `HR` = 8 km; scattering `uBR` = 13.558e-3 per km
  at 550 nm, falling with the fourth power of the wavelength (`BR`).
- Mie (aerosol), after published profiles of the background aerosol
  (OPAC, Hess et al. 1998; Shettle and Fenn 1979; SAGE II for the
  stratosphere). The haze of the lowest kilometres, the boundary layer,
  is well mixed up to `BL` = 1.5 km and falls off over about 0.3 km above
  it (`boundaryLayer`: a logistic step, 1 at sea level); above it two thin
  layers (`AERO_FREE`, `AERO_STRAT` in `fs`, `AERO_UP` and `mieUp` in
  the JS): 0.048 of the sea level's density at 6 km (half-width 5 km, the
  free troposphere) and 0.004 at 20 km (half-width 8 km, the
  stratosphere). Scattering `BETA_M` = 0.044 per km at sea level times
  `uHaze` (the haze slider, 1 by default), extinction `MIE_EXT` = 1.05
  times that (a single-scattering albedo of 0.95: between maritime air,
  0.99, and continental, 0.92). By wavelength, times
  `(550 nm / wavelength)^ANGSTROM`, `ANGSTROM` = 1.3 (`MA` in the JS,
  `uMA` in `fs`): a little bluer. At the default haze the optical depth
  at 550 nm is 0.070 in the boundary layer, 0.019 in the free troposphere
  and 0.0026 in the stratosphere, 0.091 in all: a clear day of fair
  weather (0.05 to 0.15 over the sea and the coast; a visibility of about
  65 km at sea level). The slider scales all three: 0.3 is very clean air
  (0.03), 3 to 6 hazy (0.3 to 0.55).
  The default was chosen from a series of haze values beside photographs
  of clear days, from the sea and from the air, by day and at dusk
  (round 10). Round 9 had 0.14 in all, and with the phase function
  of the time the sky near a sun at 30 degrees, seen from near the sea,
  was a milky beige column from the top of the picture down to the
  horizon, and a sun 2 degrees up dimmed so much that its glitter was
  nearly gone.
  Before (round 8), the boundary layer was `exp(-h / 1.2)` with 0.0014 per
  km: an optical depth of 0.002, some 50 times less than real air; the
  horizon was crisp, distant clouds and sea did not fade, and at dusk the
  ground below the band of glow was dark blue where photographs show a
  brown-orange haze.
- Ozone: a triangle from 10 to 40 km, peaking at 25 km; absorption `uBO`
  from the Chappuis cross-sections (`OZONE`) for 300 Dobson units.

Phase functions (`phases`): Rayleigh, and for the aerosol the
Cornette-Shanks form (`cornetteShanks`), by height:

- In the boundary layer, two lobes: a sharp one, `MIE_PHASE` = (0.149,
  0.932, 0.609) — 0.149 of the light with parameter 0.932, from the
  larger particles (sea salt, dust) — and a broad one with 0.609. Fitted
  to Mie theory (computed for this, from Bohren and Huffman's
  recurrences) for humid maritime and continental aerosol after OPAC: the
  mean of the two is matched within 8 % from 2.5 to 90 degrees off the
  light. The asymmetry is 0.715. The sun's aureole is round and bright
  within a few degrees and falls off fast: 2 to 4 times the single
  lobe's (`g` = 0.7) within 2.5 degrees of the sun, 0.8 of it from 10
  to 20 degrees. The
  single lobe of round 9 made the sky from 10 to 30 degrees off the sun
  too bright, and as bright near the horizon as up by the sun: from near
  the sea it drew a pale column under a high sun, with a nearly vertical
  edge.
- Above it (`MIE_G_UP` = 0.6, an asymmetry of 0.66), one broad lobe: the
  free troposphere and the stratosphere hold small sulphate particles,
  whose Mie phase function has no sharp peak (fitted the same way). With
  the boundary layer's lobes there, the stratospheric layer drew a small
  white core over the set sun from cruise.
- `densities(h)` gives the boundary layer's share of the aerosol at `h`
  (its `w`), and `addLight` mixes the two by it. `buildMultiScatter`
  does the same (`phaseM`, `phaseUp`).

**The march.** `NV` = 20 samples at
`t = tmax * f * f`: denser near the eye. In twilight the view ray may pass
through the planet's shadow: in parallel light, a cylinder of radius `RG`
behind the planet (`shadowSpan`). Then the march has three runs, each
denser at its start: `NV` samples from the eye to the shadow, `NSHADE` = 8
in it, and `NFAR` = 16 in the lit air beyond (a run of no length is
skipped). The light scattered once rises steeply from the shadow's edge;
20 samples over the whole ray left layers of colour above the band of
glow that came and went with the angle (a purple one at 7 degrees with the
sun 14 degrees down). A ray that misses the shadow is marched as before,
so the day's picture is unchanged. Each sample adds, for the sun and for
the moon, `addLight`:

- light scattered once, if the planet does not hide the source: the
  transmittance from the eye to the sample and from the sample to the top
  (`depthToTop`) times the phase functions, times `direct`: the share of
  the light that the clouds let through there (below);
- light scattered many times: the multiple-scattering table times the
  local scattering coefficient, times the transmittance to the eye; and
  for the aerosol, which sends light on forwards, `MIE_LEAN` = 4 times the
  table's lean (below) towards the view, where it is positive: more of
  that light when the view looks where it comes from.

The clouds and the cirrus enter the march as two layers (see
[Low clouds](#low-clouds) and [Cirrus](#cirrus)). At each layer the march
ends a sample exactly there (`tLayer`), adds the layer's light (`C` or
`H`) dimmed by the air before it, and multiplies what lies beyond by the
layer's transmittance (`vis *= Tc` or `Th`). Behind a thick cloud
(`vis` = 0) the march stops.

Light from below the local horizon grazes the planet on its way, through
hundreds of kilometres of the boundary layer, which takes it out. Until
round 8 the air was so clean that this light came through deep red, and
a cut (`grazeCut`) removed light that passed lower than 1 km; with the
real boundary layer the reference and the page agree without it (to 2 %
in the planet's shadow), so it is gone.

**Shafts.** Below the tops of the clouds, `direct` comes from the clouds'
shadow map (`cloudShadow`), sampled more finely than the march: `SHAFTS`
= 16 samples over the part of the ray below `CT` (`ca` to `cb`), denser
near the eye (`f * f`), at new places each frame (`ign`). Each step of the
march takes the mean of `exp(-tau)` over the samples that fall in it,
weighed by the air's scattering there (Rayleigh at 550 nm and Mie), or
reads the map once at its middle if none does. Lit and shaded air
alternate along the ray: shafts of light between the clouds, and the
clouds' shadows in the haze. Above the tops `direct` is 1. Without low
clouds, or without a light, nothing is sampled.

**`depthToTop(p, d)`**, the optical depth from `p` to the top of the air:

- One filtered read of the depth table `uDepth` (512 by 128, `DEPTH_MU` by
  `DEPTH_R`), made at start in `makeSky` by a 16-step midpoint sum. Its axes follow Bruneton (2017): the distance to the top, between
  its least and its most at that height, and the distance to the horizon
  (`rho / H_TOP`). The table is RGBA32F where the GPU can filter full floats
  (`OES_texture_float_linear`), else RGBA16F.
- The table repeats the density profile. The profile is written out twice:
  `densities()` in `fs`, and in the JS (`boundaryLayer`, `mieUp` and
  `mieDensity` for the aerosol, used by `buildDepths`, `buildMultiScatter`
  and this table in `makeSky`).
  Change both.

**Multiple scattering** (`buildMultiScatter`, after Hillaire, 2020): for
each altitude (`NH` = 12 rows, squared spacing) and cosine of the sun's
zenith angle (`NMU` = 40 columns from `MS_MU_MIN` = -0.35), the mean light
that reaches a point, to be times the scattering coefficient there:

- The light scattered once is gathered over the sphere, with the phase
  functions of the air and the aerosol (each layer's) for the sun's light scattered
  towards the point, and with sunlight bounced off the ground (`ALBEDO` =
  0.07). In twilight that light comes from the lit air towards the sun,
  scattered forwards; gathered as if isotropic, the table held 0.65 to
  0.75 of the reference's (below) in the planet's shadow, now 0.85 to 0.95:
  16 bands of height, narrower near the horizon (edges at `x |x|` for
  even `x`), each counted by its share of the sphere, times 4 directions
  over half the sphere, mirrored; 14 steps each. In twilight that light
  comes from the lit air low on the horizon: 8 even bands, the nearest
  3.6 degrees off it, missed most of it, and the sky of nautical twilight
  came out 3 to 5 times too dark.
- The higher orders follow as a geometric series (Hillaire).
- Then, while the sun stands lower than 17 degrees (blended in down to
  9), one more gathering of that field itself, an order computed rather
  than guessed. The series keeps the colour of the light scattered twice;
  in deep twilight that is the red glow on the horizon, and the air came
  out orange where the sky above is blue. One more order is enough: a
  second changes the table by less than 1 %.

A second table holds the sky's light on the low clouds (`cloudSky`): as
bright as the mean light, but in the colour of the light from above on a
level surface (gathered over the upper half of the sphere times the
cosine, all orders), relative to that of the mean light with the sun at
30 degrees at the same height. It is the mean light itself while the sun
stands higher than 6 degrees, and fully the light from above from -3
degrees down. The mean light holds the glow on the horizon and the dark
sea below: in deep twilight the clouds came out mauve and brown under a
blue sky.

A third and fourth hold the mean light's lean (`msLean`): the light
gathered times the direction it comes from (pass 0 and the computed
order), towards the sun's side and up. The table's light is a mean over
directions, but the aerosol scatters forwards: below the band of glow,
seen from cruise, the reference's light (scattered many times by the
boundary layer, coming from the glow) was twice the table's and
brown-orange where the table's was blue. The lean's first moment would
weigh it by 3 times the asymmetry (2.1 in the boundary layer); with the forward peak sharper
than that, 4 fits the reference best, and taking it only where it is
positive keeps the views away from the light as they were (the first
moment taken there too left the sky away from the sun 0.65 of the
reference's).

One value per wavelength. The texture is `NMU` by `12 * NH`: the three
groups of four wavelengths of the air stacked in y, then those of the
clouds, then the lean towards the sun's side and up. It depends on the haze, so `frame` rebuilds it when the haze
changes, and the renderer uploads it again. `fs` reads it through the
GPU's filter (`textureLod`; RGBA16F when full floats cannot be filtered).

**Against measurements** (a float64 copy of the model of round 8, with
its thin aerosol and `grazeCut`; not measured again since). Integrated
over the sky at sea level (haze 0.35 of that aerosol, 128 klx of sunlight outside the air), the model gives, against the
horizontal illuminance table in Schlyter, "Radiometry and photometry in
astronomy": sun at 0 degrees, 937 lx (measured 759); -6, 6.3 lx (3.4);
-12, 0.016 lx (0.008). The zenith, against a fit to sky quality meter
readings (hnsky.org, "SQM twilight"): 0 degrees, 148 cd/m2 (216); -6, 0.89
(0.63); -10, 0.014 (0.013); -14, 5.1e-4 (4.7e-4). Within a factor of two
throughout. The layers and the cut change these figures by less than
10 %: they matter for the colours low in the sky, not for these totals. Before the bands, the extra order and the shadow's runs, the
zenith at -10 and -14 degrees was 3 and 6 times too dark.

**Against a reference** (November 2026). A Monte Carlo solver of the same
atmosphere (spherical shells, the twelve wavelengths, Rayleigh, the
aerosol profile above with its phase functions by height, ozone, a ground
of albedo 0.07, every order; the light scattered once by a fine march,
the rest by paths with a track-length estimate of the sun's light on each
segment and the hero wavelength scheme of Wilkie et al., 2014), against a
float64 copy of `fs`'s march with the page's own tables, over elevations
-10 to 60 degrees at 0, 90 and 180 degrees from the sun, from 0.3, 4 and
11 km, the sun at 30, 2, -2, -4, -6 and -10 degrees (round 10, the
default haze, 4096 paths a ray). Medians over each set of rays:

- The light scattered once agrees within 3 % (1.00 almost everywhere).
- The sky (from the horizon up): 0.90 to 1.0 of the reference by day and
  towards and away from the sun in twilight (0.97 to 1.0 from 4 and
  11 km), with its colour (the r-chromaticity within 0.02). The
  anti-twilight arch and the planet's shadow away from the sun follow the
  reference closely: the pink band is a narrow one in the reference too
  (warm from 0 to 5 degrees, at its warmest at 3). Away from the sun in
  deep twilight from 0.3 and 4 km, 1.2 to 1.35.
- To the side in deep twilight the page is too bright: 1.1 to 1.2 at -6,
  1.6 to 1.8 at -10 (the table's light gathered as a mean).
- Below the horizon towards the sun in twilight (the haze over the ground
  under the band of glow): 0.7 to 1.0 of the reference (0.96 to 0.98 from
  11 km), a little bluer (r-chromaticity up to 0.06 lower); before the
  lean, 0.44 and blue where the reference is brown-orange. By day below
  the horizon, 0.8 to 0.96 (the sea there is the page's own, not the
  reference's grey ground).

So the light of the sky is the page's atmosphere's; what still differs
from photographs is mostly how much aerosol there is, and the exposure
and tone curve (see [Exposure](#exposure-and-the-tone-curve)).

## Low clouds

Low clouds live in a shell from `CB` = 0.6 km to `CT` = 5 km.

**The field.** A signed field says where cloud is: positive inside,
rising by about 1 per km of depth under the surface. `cloudShape` builds it
as a sum:

- the weather map `uWeather` at `p.xz + uDrift` (R: cover, G: towers),
  against a level set by `uCloud` (a cubic in `uCloud`);
- less what height costs: a dome over a flat base (`y` cubed over the
  cube of `top`), thicker where the map is higher; the lowest 180 m
  rounded off (`rim`);
- plus the noise of the tile (`uNoise`, one tile per `BASE_KM` = 8 km),
  read at a depth that drifts from place to place (`far`) so that no two
  tiles look alike. Worley values are rounded into domes (`v (2 - v)`).
  `lump` says how far a place stands out of the billows; `body` how thick
  the cloud is there; `q.w` how rough;
- a flat base, 30 to 80 m over `CB`.

`cloudDetail` adds the fine noise: `DETAIL` = 7 tiles per tile, and a
finer octave still when the pixel is small against it (`lod < -1`).
`cloudField` adds it only near the surface (`f > -0.35 * RELIEF`), more
strongly on thin cloud, whose edge frays.

`cloudExtinction` turns the field into extinction: `SIGMA` = 90 per km
once the field is past the edge (`EDGE` = 0.04, wider where the field is
smoothed), with more water higher up and in thicker clouds.

**The march** (`clouds`) runs from where the ray enters the shell (`ta`) to
where it leaves it (`tb`, at most 600 km). A ray that goes on to the sea
leaves it at the cloud base; from under the base, such a ray has no
clouds.

- The steps grow with the distance: `ds = max(DS_MIN, rel * t)`, with
  `DS_MIN` = 20 m and `rel` at least `DS_REL` = 0.0045. On a long path
  `rel` grows so that the march ends within its budget (`COARSE * 80`
  steps' worth); the near steps stay fine. At most `CLOUD_STEPS` = 160
  steps, and the march stops when less than 1 % gets through.
- The plan must not jump where the end of the ray does: a ray that meets
  the sea is planned as if the sea were a mirror and the ray went on up to
  `CT`. So a cloud in front of the horizon looks the same above and below
  it.
- In clear air the field tells roughly how far the next surface is: steps
  of `0.35 * |f|`, between `FINE * ds` and `COARSE * ds`. A long stride
  that lands inside a cloud steps back, and the next three steps in clear
  air are at most `ds`, so edges come out crisp. Inside, steps of
  `0.5 * f`, at most `ds`.
- The detail of the noise read (`lod`) follows the pixel's footprint at
  that distance, or a fifth of the step if that is larger.
- The start is jittered per pixel and per frame
  (`ign(gl_FragCoord.xy + 5.588238 * uPass)`, interleaved gradient noise);
  the mean over frames removes the noise.

**The light** is worked out at each sample inside a cloud while more
than a quarter of the light still gets through, and at the first sample
of each cloud the ray enters; deeper samples share the last result. At a
sample just past the surface it is worked out on the surface itself,
found between the last two samples. For each:

- `lightDepth`: six steps towards the light, growing by 1.6 each. The first
  two see the fine noise (`crisp`: the shadows of the small billows). The
  last three are moved sideways at random each frame (`off`, up to
  `PENUMBRA` = 60 m): over the frames the shadows soften. The third has
  neither. It also gives
  the slope of the field towards the light, hence `facing`.
- The rise of the field towards the sky over `reach` gives `open`: how much
  skylight a place gets.
- Five phase terms stand for the orders of scattering: `p0` (scattered
  once: two Henyey-Greenstein lobes, dimmed by the whole depth) and `p1` to
  `p4` (scattered many times: wider lobes that go deeper). `white` makes
  only thick clouds brilliant; `billow` lights the tops of the big billows
  far off, where the fine ones are below a pixel; `bounce` lights a side
  turned from the sun with the sunlit cloud around it.

`clouds` returns what gets through (`Tc`), the light per unit of sunlight
scattered once (`sOne`) and many times (`sMany`), per unit of skylight
(`sAmb`), and the mean distance it comes from (`tBar`). `main` turns them
into the spectrum `C` at `tBar`: sunlight through the air above (and
through the cirrus, `cirrusShadow`), plus skylight from the
table of the sky's light on the clouds (`cloudSky`, see
[The air](#the-air)), plus airglow.

The clouds' own light is worked out inside them, as above. Everything
outside them (the air, the sea, the glare) reads their shadow from one
map: the next section.

## The clouds' shadow

One map holds, for everything outside the clouds, how deep in their shadow
a point is: the optical depth of the clouds towards the light (`uLight`:
the sun, or the moon at night). It is drawn by `fs` itself, compiled a
second time with `SHADOW_MAP` defined (`shadowProg` in `makeSky`), into a
`SHADOW` = 1024 texel square texture on unit 14 (`uShadow`). After the
opacity shadow maps of Kim and Neumann (2001).

- **The plane.** The map lies on a plane across the light, through the
  eye, with axes `shX` and `shY` (`shadowAxes`). Each texel is a line of
  light. The plane is warped, `x / (SHADOW_K + |x|)` per axis with
  `SHADOW_K` = 40 km: a texel is 78 m wide at the eye, 310 m at 40 km,
  1.25 km at 120 km, and the map's edge is infinitely far. So the map has no
  edge to fade at: far shadows blur into a mean shade. Across the light, a
  low sun's long shadows take few texels: a shadow 100 km long on the sea
  under a sun 3 degrees high is 5 km long on the plane.
- **A texel** (`shadowTexel`) marches its line from where it rises
  through the base `CB` (or its lowest point, if that is higher) to the
  tops `CT`, in equal steps of `cloudDensity` without the fine noise:
  about `SHADOW_DS` = 0.2 km each, as many as the light's height asks for,
  between 24 and 96. The field is smoothed to half a step or to the
  texel, whichever is larger. Under a sun on the horizon a line climbs
  the shell over some 240 km; its steps are then 2.5 km long, and the
  shadows as smooth along the light.
- **Heights.** Each texel keeps the depth from four heights along its line
  to the light (`SHADOW_H`: 0.6, 1.3, 2.3 and 3.5 km): all of it below the
  base, less higher up. It is 0 at `CT`. `cloudShadow(p)` takes the depth
  at `p`'s height, linearly between them. A line that passes its lowest
  point in the air (a sun below the horizon of a point) is read as if it
  only rose: the clouds on its way down are left out.
- **Storage**: `tau / (tau + SHADOW_ENC)`, `SHADOW_ENC` = 4, in RGBA16F
  where the GPU can draw to half floats, else RGBA8: 8 bits keep thin
  shadows and deep ones apart. It is read through the GPU's filter.
- **When it is drawn.** Before a frame whose light, altitude or cloud
  amount has changed, and once the aircraft has flown `SHADOW_STALE` =
  0.5 km since it was last drawn: every 2 s at 900 km/h, every 0.6 s at
  3000. Drawn again, the map is centred on the eye anew; its texels near
  the eye are fine for a few km. In between, the frames read it where each point was when it
  was drawn (`uShadowShift`, wrapped like the way flown), so the shadows
  stay fixed to the clouds. At rest it is drawn once. Without low clouds
  or without a light it is not drawn, and `cloudShadow` returns 0.

What reads it:

- the air: `direct` in the march (see [Shafts](#the-air)). The cirrus is
  not in the map: as before, its shadow where the ray meets the sea
  (`ciShade`) dims the air below 2 km;
- the sea: the shadow passed to `addSea`, with the cirrus's
  (`cirrusShadow`). The sea reads it through `seaShadow`, with soft
  edges: the light `exp(-tau)` is averaged over `SHADOW_TAPS` = 8 points
  across the light, out to a radius of `SHADOW_PEN` (0.035) times the way
  along the light from clouds `SHADOW_OCC` = 1.5 km high (at most 0.75 km),
  spaced evenly out from the middle and turned by a new angle each frame
  (`ign`), and only then made a depth again. That is about 60 m under a
  high sun and 500 m under a sun 6 degrees high; on the sea the edge is
  longer along the light by 1 / sin of its height. The sun is a disc, and
  the light through a cloud's thin edge is spread around it by the
  droplets' forward scattering: a real shadow on the sea fades over tens to
  hundreds of metres. Read once, the map's contour was the edge of the
  glitter, which shows white down to a hundredth of its light: the glitter
  was cut out along it, hard, and with a low sun into blocks (one texel is
  drawn out along the light on the sea). Points spaced evenly over a disc
  left round blots; spaced evenly out from the middle, they weigh it more;
- the glare: the clouds towards the sun dim it (`cloudShadow(o)`).

The clouds' own light march (`lightDepth`) does not read it: it sees the
cloud around each sample in finer detail than the map can hold.

## The sea

`addSea`, where the ray meets the sphere `RG`:

- **Wind.** `uWind`, varied by gusts (B of the weather map) and streaks (A of
  the wave map). The slopes have the variance of Cox and Munk (1954):
  `s2 = 0.003 + 0.00512 * wind`.
- **Waves the picture shows.** Three bands of wind waves read from the wave
  map `uWaves` (R, G: slopes) at sizes a factor 6 apart, the longest set by
  the wind; and eight swells (`SWELL`), each smoothed over the footprint.
  Reads use `textureGrad` with the pixel's footprint on the sea (long when
  seen aslant). What the footprint averages away stays in the variance
  (`hidden`, from B of the wave map), so the glitter has the same light
  from near and from far. A band is no longer read where the footprint is
  0.12 of its tile or wider: it is the map's mean there. The read still
  holds some of the longest waves at that size, so it fades into the mean
  over the factor of three before (R, G and B together, and `hidden` after
  the fade): no edge shows where the read stops.
- **Glitter.** The share of slopes that mirror the light to the eye, with
  Fresnel and Smith's shadowing term (`waveShade`, in the rational form of
  Walter et al., 2007).
- **Sparkles at night** (`sparkle`, as the night eye comes in, `uNightEye`). The eye
  sees the moon's glitter as separate glints on black water, not as their
  mean. The sea is cut into facets of `FACET` = 0.5 m, each with a slope
  of its own drawn from the ripples' share of the variance (`s2r`); a facet
  sparkles where its slope is within `FACET_TOL` = 0.02 of that variance
  of the slope that mirrors the moon, as a spot at a place of its own,
  read over the pixel's footprint (as the breakers of the foam). The sum
  is divided by its mean over all facets, so the glitter keeps its light.
  Where the footprint is wider than a facet, the facets are taken four at
  a time, level by level, as one that sparkles four times as often.
  Where the footprint holds more than a few sparkles (from 1 to 8 at the
  middle of the path; `sparkleCount`), they are counted instead: cells of
  the sea about as wide as the footprint (or a sixth of its length) each
  hold a number of sparkles drawn as a lognormal of mean 1 and variance
  `GRAIN` = 4 over the count expected in the cell, read as value noise at
  `GRAIN_N` = 6 points along the footprint. The mean stays the glitter's
  at every distance, and the grain gets finer and fainter as the count
  grows, so that the separate sparkles near the sea merge into a grainy
  band and, towards the horizon, a bright streak, with no line where one
  way hands over to the other. The facets and the cells stay put on the
  sea, so a still holds still; in flight the slope that mirrors the moon
  moves on, and the sparkles twinkle, while the far grain moves with the
  sea. By day the sun's glitter is drawn as before. Before (round 1), the
  moon's path from near the sea was a smooth pale column with a grey halo;
  photographs of short exposure (B4, 1/5 s) show separate sparkles on
  black water. In round 2 the sparkles merged into their mean beyond a
  footprint of some 20 m: from 0.3 km a horizontal line crossed the path
  at about 2 km, beyond which it was a smooth white column striped by the
  swell.
- **Mirrored sky.** `skyAt` marches 8 steps of air in the mirrored
  direction of the tilted footprint. Rough water mirrors less at grazing
  angles (the mean Fresnel factor of Bruneton et al., 2010). Three samples
  of `cloudDensity` up the layer tell how much of that sky the clouds hide.
- **Light from below.** `SEA`: blue light scattered back out of clear water.
- **Foam.** Whitecaps cover `2.95e-6 U^3.52` of the sea (Monahan and
  O'Muircheartaigh, 1980), as separate breakers in a grid of cells: counted
  sharp from near, averaged from far.

The shadow on the sea is the `tau` passed in: `shadow` in `main`, the
depth of the clouds (`seaShadow`: the map, with soft edges) and of the cirrus
(`cirrusShadow`) towards the light. It hides the glitter and the direct
light on the water; the light that a cloud lets through diffusely
(`soft`) falls more slowly.

## Cirrus

`highCloud`. The cirrus fills a shell from `CI_LO` = 12.2 to `CI_HI` =
12.8 km, split into `CI_LAYERS` = 2 decks of 0.3 km, each reading the ice
in a frame of its own: the upper and the lower deck of cirrus. Where both have ice, their
trails cross at different angles, and in flight the decks slide over each
other.

Each deck is read where the ray crosses its middle height (or halfway
along a ray that only grazes it), and its depth counts as many times as
the ray's way through the deck is longer than the deck is thick. The
crossings come from `eyeSphere`, which takes them from the heights, not
from `raySphere`: the slider stops on these heights, and from an eye at a
sphere's own height `raySphere` puts the near crossing a hair ahead or
behind, ray by ray (see [development.md](development.md#glsl-rules)).

![Cirrus seen from 11 km: ?date=319&pitch=28&cirrus=0.6&cloud=0.3](images/cirrus.jpg)

**The ice** (`uIce`, below) holds the forms. It is not noise drawn out
along the wind but the result of a process, followed at start for every
texel: ice is made in generating heads, falls out of them, and the wind
shear draws what falls into a trail behind each head; eddies stir the
trails. Four kinds of head make four fields, one to a channel, which the
scene mixes by the cirrus's map (below), so that one region of the sky has
plumes, another bands or flocks:

- **Plumes** (R, `icePlumes`): tufts, 9 cells to a side of the tile
  (4.5 km), 30 % of them empty, each head anywhere in the middle 90 % of
  its cell (round 9: 4 cells of 10 km, a quarter empty, heads in the
  middle half: evenly spread, far off they stood in rows like the scales
  of a fish). A head is 0.4 to 1.6 km (a few large, many small), and its
  trail widens as it ages: a wedge, from a narrow streak to a fan. Half
  the plumes have a dense head, half the head size (a tuft, cirrus
  uncinus), lumpy while the ice is young (knots of a third and a tenth of
  the head); the others have none, their ice fading in from a narrow
  root: a fan of 6 to 12 strands to a half width that spreads by 10 to 20
  degrees (a spray of fibres, cirrus fibratus; 20 to 40 drew peacock
  tails from below). Their strengths vary by seven times; groups of
  plumes (noise of some 20 km) are strong, others weak, so that tufts
  come in clusters with blue between. The trails are 0.6 times the drift
  (some 10 km; 24 before: long combed hairs across half the sky from
  below), and each lives 0.25 to 1 of a life, so that neighbours differ
  in length. Each plume reads its own way at its head (`icePlumes`,
  `iceHooked`): groups of plumes are turned by up to 0.3 rad from the
  common way, and each head by up to 0.1 rad more, with a drift up to
  10 % longer or shorter; the ice leaves a head turned by up to 115
  degrees either way (up to 23 for a fan) and comes round to the shear
  over 0.1 to 0.25 of its life (a comma, the hook of cirrus uncinus,
  larger for a large head); after that each trail turns by its own amount
  (`ICE_VEER` = 0.35 rad over a life, give or take 1.8), so that it curves
  along its whole length, not only at the head. Most heads (85 %) also
  move against the air around them while they make ice, by 0.15 to 0.5
  of the reach over a life, at 35 to 80 degrees from the shear: the
  head's track is a spine and the trails leave it aslant (a feather, a
  hooked plume) instead of a wedge of parallel strands from one point.
  A head's ice fades out over 0.75 to 1 cell from where the common way
  puts it (1 to 1.2 before), so that a head never leaves the nine cells
  searched while it still has ice: moving heads, cut there, drew straight
  seams.
  With one way and one turn for the whole tile (round 8), every trail of a
  deck was parallel and the streaks converged on one vanishing point like
  ruled rays.
- **Large plumes** (A): the same with 4 cells to a side (10 km), heads
  1.4 times as large, trails 1.1 times the drift (some 18 km), 2.5 times
  as strong, all in their cells (no clusters): the broad fans and sheets.
  The scene gives them more weight as the slider goes up (from 0.6 at
  0.15 to twice at 0.85), so that much cirrus is made of larger forms.
- **Rows** (G, `iceRows`): small heads (50 to 130 m) along lines with the
  wind, 5 to the tile (8 km apart), a head every 1 km, scattered over
  the row's width (0.3 to 1.5 km). A row comes and goes along its length
  (runs of 5 to 20 km) and wanders across by up to 1 km. Each row's
  trails have a way and a turn of their own: along the row in most rows,
  where they join into a band of fibres (a street); turned some 60
  degrees in a fifth of them, where they stand off a spine as ribs that
  curl (a feather, cirrus vertebratus). The bands wrap round the tile, so
  they run on as far as the map lets them.
- **Flocks** (B, `iceFlock`): small heads (0.1 to 0.3 km), one to a cell
  of 3.4 km, gathered in flocks with wide gaps by two octaves of noise
  (20 and 8 km), each with a short trail of threads (cirrus floccus).
  Half have died out and left their trail. A flock's head grows with age
  and wobbles in time. It is lumpy, not a round puff: knots of a third
  and a tenth of its size (value noise, cubed), so that the floor the
  scene takes off leaves a ragged little cloud. Heads are 70 to 220 m.
  The scene cuts the thin edge of a flock off and makes its core denser
  (`q.b`), so that a tuft stands as a small, bright cell.
- **Strands** (`iceStrands`). A plume's ice falls in strands along its
  trail: value noise across it (squared, so that there are gaps between
  the strands), at 3 to 12 strands to the trail's half width, and thin
  bright threads within. The place across is measured in
  units of the trail's width at that age, so the strands fan out with
  the trail. Each strand has a life of its own, the outer ones shorter:
  the strands end one by one, so that a trail tapers and frays out
  instead of ending round. The strands wander from side to side (by about
  a strand's width, each group of two or three its own way), so that they
  cross and braid, and near the end of its life a strand curls off to
  one side or the other. Along the trail they change over some 5 km (4.5
  to a life; 2 before, which drew straight hairs 12 km long). The ice
  also falls in bursts: several strands at once thicken and thin along
  the trail (value noise slow across, 1.1 to a life along, squared), so
  that a trail has patches and bands across its streaks, with gaps.
- **The trail.** The shear draws the ice away from its head, slowly at
  first (a dense head), then at full speed, along a way that turns with
  age: `iceDrift`, in closed form (an arc, `iceArc`). The common shear
  runs one way over the tile (`ICE_TH`, turning by `ICE_VEER` = 0.35 rad
  over a life, `ICE_REACH` = 16 km of drift); each plume and each row has
  its own way and turn, as above. It used to change over the tile (slow noise), read at
  each texel: a trail then took the way of every place it crossed, and
  every trail bent into regular waves as long as the noise (S-shaped
  ribbons). Only the strength of the eddies changes over the tile. Each
  kind falls at its own speed: its trails are as many times as long as
  the drift (plumes 0.6, large plumes 1.1, rows 0.45, flocks 0.35).
- **Eddies**: the curl of a noise potential at 13, 5 and 2 km (divergence
  free), which changes in time (its gradients turn), the smaller the
  faster; the largest is kept gentle (0.35 against 0.45 for the middle
  one), or every trail waved alike; and a gentle divergent part, the
  gradient of the middle size, as the ice spreads and gathers where the
  air rises and sinks.
- **How.** For each texel, the eddies are followed back in time
  (`ICE_STEPS` = 20 steps over a life of the ice, 28 before: the same
  picture; the method of
  characteristics). At each age, the ice of that age at the texel came from
  where the eddies bring it from, less each kind's drift; a head there made
  it then. Each step is a segment, and each head's puff is integrated along
  it (with `erf`, `icePuff`), so that no step shows. A plume reaches no
  further than 1 cell from where the common way puts its head, so the
  nine cells nearest are enough (four to a side, for the heads whose own
  way takes them farther, drew the same picture at nearly twice the cost
  on SwiftShader); a row's
  head no further than 0.8 of a cell, a flock's 0.3: four cells and one.
  Nothing is resampled step after step, so nothing blurs, and each texel
  is computed by itself: the field does not depend on the order of the
  draws, and repeats with the tile. Each field is stored as
  `sqrt(x / ICE_STORE)`, `ICE_STORE` = 1, and read back squared: the
  scene's depth is linear in the ice. The old `1 - exp(-7 x)` saturated:
  most of a plume read near 1, a flat white.

**The cirrus's map** (`uCiMap`, `ciMap`), 256 x 256 over the map (1 km a
texel), says where the cirrus is and of what kind, at the scale of 50 to
300 km: R and G, how much for the upper and the lower deck (patches of
some 85 and 35 km, and bands along the wind of 40 by 8 km and 27 by 5 km,
in the frame of the wind with whole numbers); B, the share of rows; A,
the share of flocks against large plumes (both over some 100 km).

**The fibres.** Photographed cirrus is made of many fine, nearly parallel
streaks inside each tuft, down to hair-fine ones; the ice's 10 m texels
hold only the coarser ones, and seen from near the shell they are
magnified to mush. Two more textures are drawn from the ice, and the
scene adds the finest streaks itself:

- **The way** (`uIceWay`): where the ice runs (its four kinds together), from its
  structure tensor (the mean of its gradient times itself over 3 x 3
  texels of 40 m), stored as the gradient's direction at twice its angle,
  `(Jxx - Jyy, 2 Jxy)` over the trace. A gradient and its opposite then
  add up, so the mipmaps average the way over a footprint, and its length
  says how much the ice runs one way (near 1 along a trail, near 0 in a
  round head). The fibres run across the gradient.
- **The fibres** (`uIceFib`, a gentle factor: 0.6 of its swing; at 1.6
  it broke the strands into short dashes): grains of 25 and 90 m summed along the line
  that follows the way through each texel, 24 steps of 25 m each side
  under a Hann window (line integral convolution, after Cabral and
  Leedom, 1993): streaks of some 1.2 km that bend with the trails, crowd
  and splay. The line follows the way over 80 m and more of it over
  320 m: round a head the gradient runs round, and the streaks would ring
  it. They are read like the ice (`textureGrad`, mipmaps, the anisotropic
  filter), so from afar they average out by themselves.
- **The finest streaks** (`ciFibres`): two octaves, 24 and 8 m (the
  second fades out below some 10 m), 20 times as long as wide, the zeros of gradient noise drawn out
  along the way (thin bright lines on a mean of 1). Noise turned to
  follow the way would shear its streaks apart far from the centre of the
  turn, so they are drawn on `CI_WAYS` = 16 fixed ways that repeat with
  the tile (whole-number steps across it, such as (2, 1) or (1, 4)), the
  two nearest the ice's way blended with weights over the root of their
  squares' sum (so the contrast stays), and they wander from side to
  side. An octave fades out before it gets narrower than the footprint
  across it, or than most of the footprint's length: seen aslant, the
  streaks that point at the eye would otherwise outlast the others and
  fan out towards the horizon; and when it is 4 to 10 times wider than a
  pixel (`ciPixT`, without the blur through the deck). Seen from within a
  few km of the shell, streaks of 3 to 8 m stood as hard, ruled hairs
  that crossed where the decks did; there the texture is the ice's own. Wider
  streaks than these are the ice's own strands, which bend with the
  trails: straight ones of 70 m and more, tried, looked ruled.

The fibres modulate the ice (a factor around 1), strongest where the ice
is thin and runs one way: thin parts break up into streaks, dense cores
stay milky with a sheen of fibres.

From just under the shell (11.9 km), aslant, the streaks of the deck
overhead converge on the horizon, as the lines of any ceiling do: that is
perspective of the patch overhead. Since each plume runs its own way and
the two decks run 27 degrees apart, they do not share one vanishing point.

`ciDensity` gives a deck's share of the vertical optical depth at a place
on the map.

- **The map.** The deck's channel of the map, against a level set by
  `uCirrus` (`0.72 - 0.85 c`), gives how much cirrus there is (`m`). The
  lower deck reads another place of the map and needs more of it (0.12),
  so that the decks come and go apart and two decks cross only in
  places. Over some 16 km (a coarse level of the map) it tells where
  there is none, and most of the sky costs little. The kinds are mixed
  by B and A: plumes everywhere (fewer where rows are many), rows, flocks
  or large plumes.
- **The ice** is read in each deck's frame (`ciTile`): the upper deck
  along (3, 1), two tiles to a unit of 81 km; the lower along (1, 1),
  four tiles to a unit of 181 km, so that its forms are a little larger
  and run 27 degrees from the upper's. Each tile is shifted
  (`CI_START`) so that the place where the page starts has some cirrus
  overhead: from near the shell a view sees only a few km of it, and the
  tile had a gap there. The places are chosen where the tile has
  structure (cover of 40 to 80 % over 5 km), not the densest: under a
  large fan the owner's view was a fan of streaks from one point. It is read with `textureGrad` over the pixel's
  footprint (`f1`, `f2`: the footprint's axes on the map, drawn out along
  the ray's way and a little by the way through the deck), through the
  mipmaps and, where the GPU has it, its anisotropic filter.
- **The depth.** The optical depth follows the ice: `CI_TAU` = 4 times
  the ice (with its fibres), times `0.6 + 0.8 c` for the slider `c` and
  `0.3 + 0.7 m` for the map. Seen straight up most of a plume is at 0.05
  to 0.5, its cores at 1 to 2, so the brightness varies with the
  thickness and blue shows through the thin parts. The slider takes a
  floor off the ice first, `0.03 (1 - c)^4 + 0.02 (1 - m)`: little cirrus
  shows only the densest plumes, more shows weaker ones, and what is left
  fades in from nothing along its own strands and fibres, with no outline
  of its own. The floor is soft (`y^2 / (y + knee)` above it, the knee
  half the floor), so the depth grows smoothly from 0. (Round 7 cut a
  blurred body of the ice with a narrow ramp over a stored value near 1:
  flat white patches with smooth, cut-out outlines.) The tufts gather in
  fields of some 40 to 60 km with wide gaps (noise over the map, `fields`).
  Measured as the share of the view with a vertical depth over 0.03,
  looking up at 35 degrees from 0.3 km: 14, 26, 40, 59, 74, 93, 100 and
  100 % at 0.1, 0.25, 0.4, 0.6, 0.7, 0.8, 0.9 and 1. (The share of the
  picture that differs from `cirrus=0` no longer measures it: the metered
  exposure changes the whole picture when the cirrus brightens it.)
- **The veil.** From `c` = 0.35 a veil (cirrostratus) grows, `CI_VEIL` =
  0.4 of vertical depth at its median, times `smoothstep(0.35, 1, c)^1.6`
  and the map. Its depth is the exponent of noise (`ciVeilNoise`), so that
  it spreads as cloud depths do (log-normal: some 0.2 to 5 times the
  median; thick patches and clear lanes, roughly 0.1 to 3 at the top of
  the slider): bands along the wind at seven sizes, from 13 by 3.4 km
  down to 250 by 13 m, the smaller ones longer for their width (fibres),
  and waves across the wind of some 2 km, with an amplitude that falls by
  0.8 an octave (the -5/3 spectrum of cloud), so that seen from near the
  shell the veil still has thick and thin parts. An octave fades out
  before its bands get narrower than a few footprints. A floor,
  `6 (1 - c)^1.5`, is taken off first, so that the veil comes in as
  patches that join as the slider goes up. It takes 0.7 of the fibres.
  Round 9's veil grew in proportion to the ice around and saturated: one
  even, pale sheet from edge to edge (depth 0.5 to 1 over 70 % of the
  view at `cirrus` 0.85 from 11 km).
- `ciBody` is the depth of the ice over some 0.4 km (or four footprints if
  that is wider): the light inside the sheet feels it. `ciVeil` is the
  share of the veil: it draws the halo. `ciMean` is the depth over some
  2.5 km, and `ciWide` over some 10 km, from which the glow round the sun
  and the moon is drawn.
- **The depth of a deck.** Seen from near the shell, a ray crosses a
  deck aslant over hundreds of metres, and the ice at its top and its
  bottom does not line up: the footprint grows by 0.08 of the way through
  the deck along the ray (0.04 for each of the two reads near the shell,
  blended in smoothly: a step there drew a straight seam across the veil) (not across it: blurred across too, the strands
  of distant plumes averaged out to smooth patches), so that from just
  under a deck its fine threads soften instead of standing as long ruled
  lines; from the ground the blur is about a pixel.
- **A deck seen from near** (within 1.5 to 4 km of the point read) is a
  volume: it is read at two heights, a quarter of its thickness above and
  below its middle, the lower one 0.3 km back along the shear and 0.12 km
  across (its ice has fallen further and drifted on). From near the two
  stand apart and move against each other in flight (parallax), and the
  strands of one fill the gaps of the other; farther off they close up
  into one read, smoothly. There the strands of tens to hundreds of
  metres would fill the view as long stripes: the depth is mixed towards
  the ice over some 0.4 km (`ciBody`), up to 0.3 of the way (0.6 before: a featureless milky sheet), so the deck
  is a milky body with its strands as a gentler modulation, as
  photographs taken at cruise level next to cirrostratus show.
- Light: forward scattering by ice (a narrow diffraction peak within a
  degree or two of the sun, so that the glow round the sun stays small;
  it is a round aureole: it follows the sheet's depth over some 10 km
  (`ciWide`), and the ice just in front of the light only by 0.4,
  and it is drawn where there is ice around even if there is none in the
  pixel. Drawn from the ice in front, a plume round the moon lit up as a
  bright patch of its own shape; from the depth over 2.5 km, as a smooth
  bright lens; a
  broad refraction lobe; and a flat part to the side and back, some 0.3 of
  the mean, as ray tracing of ice crystals gives it), the 22-degree halo
  with the dispersion of ice (faint, 0.025, and soft, some 1.4 degrees
  inside, and only where there is a veil: a halo needs the even, smooth
  crystals of cirrostratus), light
  scattered once with the sheet's own shadow (a low sun enters the sheet
  within some seven times its thickness, between the clouds, so cirrus at
  sunset is lit gold), a share scattered many times (its sunlight fades
  with a quarter of the depth, as ice sends most of it on forward: with
  the full depth, thick ice towards a low sun went darker than the sky
  behind it),
  skylight from the multiple-scattering table (less the share `CI_FWD`,
  below), and light from the low clouds below, at the mean distance of
  the decks seen.
- **What lies behind shows through.** Some `CI_FWD` = 0.4 of the ice's
  extinction is diffraction by its crystals: light turned by less than a
  degree, which goes on as if not scattered. The march through the air
  keeps a second transmittance for what is wide (`visX`: the air, the
  sea, the clouds): through the cirrus it is `Th + CI_FWD (1 - Th)`,
  while the sun, the moon and the stars get `Th` (their diffracted light
  is the aureole). So the blue of the sky behind thin ice, and the sea
  under it, show through, softened; at dusk away from the sun the ice
  keeps some of the blue of the upper sky behind it as well as the
  reddened sunlight on it. A fibre in a thick
  body of ice is lit through the body (`ciBody`), so dense patches are grey
  inside and their thin edges bright. Sunlight reaches the shell through
  the air above it (`ciDepthToTop`): at a low sun it is reddened.
- **Towards the sun** the sheet sends thirty to fifty times the light of
  the sky round it, more than the screen shows: its thick and thin parts
  would be one white glow, where a photograph through such a veil keeps
  them apart. The light scattered forward rolls off smoothly towards
  `CI_ROLL` = 1.8 times the screen's white (after the exposure,
  `x -> R (1 - exp(-x / R))`), so the texture of the ice stays outside a
  bright round zone round the sun, as in a photograph. The rest of the
  cirrus's light is untouched. The aureole follows the ice in front by
  0.4 (0.25 before).
- `cirrusShadow` dims the direct light on the low clouds and the sea (half
  the depth counts: ice scatters mostly forward). It reads the mean of the
  two decks over 0.5 km (`cirrusDepth`), and so does the glare. These
  calls leave out the fibres (`ciDensity` with `fibres` false), which
  average out over such a footprint: the scene is compiled with four
  copies of them, and the fibres doubled the time the driver took to
  finish the program.

`highCloud` returns `Th`, `H` and `tHigh`; the march through the air treats
it as its second layer.

**The ice's textures.** They are drawn by the `ice` program, which is
apart from `noise`: the driver here finishes a program at its first draw,
and the ice made `noise` take 1.7 s for it on every page. The cirrus's map
(`uZ` = -2) is drawn first, before the noise (see the loading). `uIce`
(4096 x 4096, RGBA8, a tile of 40.5 km, 10 m a texel; the four kinds) is
drawn with `uZ` = -3 in pieces of 512 x 512 (`ICE_PIECE`), so that no
single draw keeps the GPU long; then `uIceWay` (a quarter as wide, RG8,
from the four kinds together; `uZ` = -4, one draw from the ice's mipmaps)
and `uIceFib` (as wide as the ice, R8; `uZ` = -5, in pieces). Both decks
read the same textures, each in its own frame. They are built during the
loading, in batches, if the page starts with cirrus; else when cirrus is
first shown (`buildIce`, called by `render`, all at once), so that a sky
without cirrus never pays for them. The ice program itself is compiled at
start only if the page starts with cirrus; else `buildIce` compiles it and
waits for it, so the first move of the slider from 0 takes that long once. On an RTX 3090 they take some 0.25 s
of GPU time, and the first picture comes about 0.9 s later than without
cirrus (see [development.md](development.md#gpu-time)). A renderer without
a GPU (its name says SwiftShader, llvmpipe, softpipe, software or Basic
Render) builds them a quarter as wide (`ICE_SOFT` = 1024, 40 m a texel,
without the 25 m grains). The name decides, not a timing, so that a
renderer always draws the same. Every pattern in them repeats with the
tile, and the tile two or four times in a unit of each deck's frame,
which repeats ten or four times over the map.

## Sun, moon, stars

**The rule.** Every light beyond the air, the sun, the moon, the stars, the
airglow, the Milky Way and the zodiacal light, is drawn with its own
brightness at every hour. Besides the exposure and the tone curve, only
the air decides what shows: each light is dimmed on its way to the eye,
and the light the air scatters towards the eye (of the sun, and of the
moon) lies over it. A star by day is lost because the bright sky sets the
exposure and lies over it, not because anything switches it off; as the
twilight fades, the stars and the Milky Way come out by themselves, the
brightest first. No switch on the hour, the sun's height or the moon's,
and no threshold on one light's contrast, raises or hides a light. Where a
light needs help to look as the eye sees it, the help is a constant gain
(below) or the night's tone curve, which applies to everything alike.

Rays that reach the top of the air (no sea, not behind a thick cloud) get,
all dimmed and reddened by the air:

- **The sun**: a disc of 0.267 degrees radius, of a fixed brightness (2000
  in these units).
- **The moon**: a sphere lit by the sun (`uSun`), so its phase comes out by
  itself, with darker seas from noise, by day as well (a pale day moon).
  The dark side holds the earthshine, `EARTHSHINE` = 1e-6 of sunlight per
  steradian. Before, the earthshine was capped by the exposure, so that
  the night exposure did not burn it out: the moon's dark side was a dim
  grey at night. At its own brightness the night exposure takes it near
  white, and a crescent shows as a whole pale disc with a brighter rim.
- **Airglow** (`uNight`), brighter towards the horizon (van Rhijn's factor),
  and **the Milky Way** (`milkyWay`): a noise pattern on the real galactic
  plane, brighter towards its centre, relative to the airglow. The air
  takes only half of their light away: it scatters much of what it takes
  back towards the eye, and the sky from cruise brightens towards the
  horizon (by about 1.5 times at 5 degrees up) instead of staying flat.
  The Milky Way is drawn `EYE_GAIN` = 6 times its light, at every hour,
  and so is the zodiacal cone: large faint glows that the dark-adapted
  eye sees plainly, where a screen's dark end would hide them. One gain
  for both keeps their ratio. On a moonless night, towards Sagittarius
  from cruise (`date=200&time=1.5&moon=0&yaw=20&pitch=8`), its brightest
  parts stand at about 47 of 255 over a sky of 10; under a
  quarter moon it is faint, and under a full moon it is lost in the
  moonlit sky. Before, it was raised up to 6.5 times more as the night eye
  came in, by its contrast with the sky and the moon's glare in the eye
  (`MILKY_EYE`, `MILKY_SEEN`): as a moon set, that contrast crossed its
  threshold within a few minutes and the Milky Way came in at once.
- **The zodiacal light** (`zodiacal`): sunlight scattered by the dust
  between the planets, of the sun's colour, a cone along the ecliptic
  that is brightest near the sun, a faint band along the rest of it, and
  the gegenschein opposite the sun. It is a fit to the table of Leinert
  et al. (1998, "The 1997 reference of diffuse night sky brightness",
  A&AS 127, 1, Table 16: the brightness seen from the Earth at 500 nm, in
  S10, stars of the 10th magnitude per square degree, by the ecliptic
  latitude and the ecliptic longitude from the sun), within 4.5 % rms
  and 13 % at most over its 182 values and the pole's 60: a falloff as
  the power -2.46 of the angle from the sun, flattened towards the
  ecliptic as seen around the sun (to a quarter square to it), over a
  floor of 79, and two bumps at the point opposite the sun, one some 13
  degrees across (the gegenschein) and one wider. Along the ecliptic it
  is 9000 at 15 degrees from the sun, 1900 at 30, 400 at 60, 200 at 90,
  140 at 135 and 180 opposite the sun; 60 at the ecliptic's poles. The
  airglow (`NIGHT`) is about 130 overhead, and the Milky Way along its
  plane about 65 away from its centre and 300 towards it (to 650 in its
  brightest clouds). One S10 is
  `S10` = 6.61e-12 of the sun's light per steradian (the sun at V =
  -26.74). Inputs: the cosine of the angle from the sun (`uSun`) and the
  sine of the ecliptic latitude, from the ecliptic's pole (`uEcliptic`,
  set from `OBLIQUITY`); so it is the real ecliptic for the date, the
  time and the place. Nearer the sun than the table goes (15 degrees on
  the ecliptic), the power goes on, to 2 degrees. `zodiacal` returns the
  cone (the power term) and the rest (the floor and the bumps) apart, and
  for the cone as it is drawn its brightness along the ecliptic and its
  shape across it.

  It is drawn at every hour; by day and in civil twilight the sky is
  thousands of times brighter and lies over it. The air dims it as the
  Milky Way. Its floor and the gegenschein are drawn as they are. Its cone
  is drawn `EYE_GAIN` times the fit's brightness along the ecliptic, and
  across it as the eye sees it: along the ecliptic the fit widens with the
  angle from the sun (it is flattened by the same ratio at every angle),
  and drawn so the cone spread into a fan and read as a soft glow on the
  horizon. The eye sees a cone instead, widest and brightest at its base,
  whose sides close in all the way to its tip (Trouvelot's drawing of
  1876, reports from dark sites). So it is drawn as a band of half width
  (to 1/e) 20 degrees at 15 degrees from the sun, narrowing fastest near
  the sun, towards 2 far from it (`ZODI_BAND`; 15 at 24 degrees, 9 at 50,
  4 at 80), with a skirt twice as wide (0.15 of it). A moon fades it only
  as the moonlit sky lies over it. Before (round 4) the cone was raised
  by its contrast with the sky behind it, from `ZODI_SEEN` = 0.25 up to
  `ZODI_MOST` = 6 times the sky, faded by a moon above the horizon
  (`ZODI_MOON`), and drawn only once the night eye came in.

  On a moonless spring evening (sun 18 degrees down, 35 degrees north;
  `date=80&time=19.45&yaw=90&pitch=15`) the cone stands from the glow at
  the horizon to some 60 degrees up, as on main before. Under a gibbous
  moon in the last of the twilight it is a trace. It costs a few
  operations per pixel of sky, now at every hour.
- **Stars** from Wikidata (CC0), to magnitude 6.5 (the `stars` block: six
  bytes per star, brightest first, about 8,800 stars; built by
  `tools/make-stars.py`, the source is named in `THIRD_PARTY_NOTICES.md`). About a hundred
  stars that Wikidata gives no V magnitude have one estimated from their
  other bands.
  `buildStars` puts them into a `GRID` by `GRID` (128) octahedral map of the
  sphere with up to `SLOTS` = 8 stars per cell, and enters each star in
  every cell its disc can reach, so the shader reads one cell per pixel
  (`starCell`). A star is a spot about a pixel wide, with a colour from its
  B-V index (Ballesteros's temperature, then a tilt of the spectrum) and a
  compressed brightness (a "look": `STAR_LN_MAG` = 0.645 in ln per
  magnitude, 0.7 of the real ratio). The brightest get diffraction spikes
  fixed to the screen. At every hour the core of a star of magnitude 6.5
  is `STAR_GAIN` = 20 times the radiance of the airglow. That is about its
  true brightness spread over the spot at a drawing size of some 1600 x
  900 (the spot keeps its size in pixels, so the gain is a constant, not
  the true radiance at every size). The air dims a star by its own
  transmission, the light of the sky lies over it, and the exposure and
  the night's tone curve decide which show: on a moonless night from
  cruise the faintest of the catalogue just show, under a moon and in
  twilight fewer, the brightest first. Their colour is their own; at night
  the rods' grey takes it from all but the brightest, by their luminance
  ([Exposure and the tone curve](#exposure-and-the-tone-curve)). Before,
  the stars at night were drawn after the exposure as the eye's threshold
  says (`starsSeen`, after Schaefer, 1990, with the moon's glare in the
  eye; `STAR_SEEN`, `STAR_HUE`), and in proportion to the airglow only by
  day and in twilight.

**Glare**: a glow of a few degrees around the sun, as strayed
light in a lens, dimmed by the clouds (the shadow map at the eye) and the
cirrus towards the sun. It is drawn within 26 degrees of the sun
(`mu > 0.9`), and added to `L` and to `G` alone: `G` already holds the
sun's disc or its glitter, which `L` has.

## Exposure and the tone curve

The exposure follows the picture, as the eye or a camera's automatic
exposure does: it is set from what the view shows, sky, clouds, sea,
glitter and the inside of a cloud alike.

**The level.** `fs` writes, in the alpha of each frame, the level of the
pixel: log2 of its luminance before exposure, coded from 0 to 1 over
`LOG_RANGE` (-34 to 18, `uLogRange`). `mean` carries it along with the
colour, so the picture's level is as clean as its colours. The sun's
disc and glare and its glitter on the sea (and the moon's glitter) count
in it at only `METER_GLINT` = 0.15 of their light (`G` in `main` and
`addSea`): a camera lets the sun and its mirror image run into white and
exposes for the rest. Photographs from cruise keep the sky as light
facing the sun as away from it (h11-vueling01 and 03); counted in full,
the glitter held the view towards the sun 1.5 to 2.4 stops below the
view away, and the sky there was navy (round 10). Every other light
counts in full, the moon, the stars, the Milky Way and the zodiacal
light among them. Before, the zodiacal light was left out (`zodiY`): it
was drawn then some four times its own light, and counted in, it darkened
a spring evening's view of its cone by 0.25 to 0.56 stops.

**The meter.** After `mean`, the shader `meter` draws a target of 64 by 36
texels (`METER`): each is a block of the picture and holds the mean level
of 4 by 4 points in it, in 16 bits over two 8-bit channels. The JS reads
it back `METER_LAG` = 3 frames later, when the GPU has long drawn it, so
that the read does not wait for the GPU's work. Counting frames, not
polling a fence, keeps the page's frames the same from run to run on a
stepped clock (the tools' fake clock). A read still costs a round trip to
the GPU process (about 2 ms on the test machine), so the meter is read at
most every `METER_MS` = 100 ms of the page's time. The first frame of
the page is metered at once, not shown, and drawn again at its exposure:
the page starts adapted. The loading has drawn that frame before and read
its meter without waiting (`prime`, see
[From the address bar](#from-the-address-bar-to-the-first-frame)); only if
something changed since (a resize, say) does the first frame read it
itself, the one read that waits.

**The exposure the picture asks for** (`exposureFor`, log2) comes from the
2304 block levels, sorted:

- `low`, the level of the darker quarter (`LOW_SHARE`), but at least
  `NIGHT_LEVEL` = -25.5 (a moonless night sky);
- `high`, the level that only the brightest 3% of the blocks pass
  (`HIGH_SHARE`);
- `key` = `KEY` - `EYE` * `low` (`KEY` = -1.3): as the view darkens,
  the eye opens up `EYE` = 0.85 stops for each stop, not all the way. So
  a night is darker than a day and dusk is in between, and black sea at night is exposed as
  the night sky, not lifted into noise;
- `white` brings `high` to `WHITE` (2^0.3 before the tone curve: just
  below white) in daylight (`high` at `DAY_HIGH` = 0.5 or more), and `DIM`
  = 0.6 stops lower for each stop that `high` is below that: the
  brightest parts of a dim view are not white either (the moonlit clouds
  of a night);
- `mid`, the median level, but at least `NIGHT_LEVEL`;
- by day and by night, the exposure is the lesser of `key` and `white`, but not less than a
  floor: the exposure that takes `mid` only `DEEP` = 0.8 of the way from
  the key's level down to the night's (`MID_GAP` = 0.5: in a night sky the
  median stands about half a stop above the darker quarter), and never
  more than `key`. So dusk darkens steadily into the night, rather than
  reaching the night's level early and staying there. The floor is on the
  median, not on the darker quarter: after sunset the sea and the clouds
  below darken sooner than the sky, and a floor on them brightened the
  sky again for some ten minutes;
- in twilight another exposure takes over, blended in as the sun goes
  from `DUSK` = 8 to 1 degrees (a smoothstep, times `sunOn`): one set
  by the sky, the level that the brighter third of the picture passes
  (`DUSK_SHARE` = 0.65), so that the view is shown as the eye sees it and
  not held down by its highlights. That level is shown at `DUSK_SHOWN` =
  -0.8 (log2 after exposure) when it stands at `DUSK_MID` = -3 (about
  sunset), and at the night's level (the key's, `KEY - EYE * NIGHT_LEVEL
  + NIGHT_LEVEL + MID_GAP`, -4.6) when it stands at the night's
  (`NIGHT_LEVEL + MID_GAP`); in between along the power `DUSK_POW` = 0.7
  of its distance from the night's, so that it darkens slowly at first:
  through civil and nautical twilight the eye still sees colours. The
  highlights may stand up to `ABOVE` = 3.5 stops above white, an
  allowance that grows over `ABOVE_SPAN` = 5 degrees after the blend. The
  sky, not the median nor the darker quarter: the clouds and the sea
  below darken sooner than the sky after sunset, and an exposure that
  followed them brightened the sky through sunset. But the band of glow,
  the brightest part of a view towards the sun (the level that only
  `PEAK_SHARE` = 0.2 % of the blocks pass, a few rows of them), stands at
  most `PEAK_ABOVE` = 1 stop above white, and `DIM_BAND` = 0.1 stops
  lower for each stop that it is dimmer than daylight's highlights
  (`DAY_HIGH`), at most `DROP` = 1.5 stops lower. As a camera's sensor
  does, the tone curve then takes each channel on its own (below): the
  band's strongest channel runs into white at its core, and it comes out
  white-yellow there, orange at its edges, pale above, under a deep
  blue-grey sky, as in photographs from the air; deep in the twilight it
  is a thin orange line under a near-black sky (an A330's at about -8
  degrees). In deep twilight the band gives way: it holds the sky at most
  `GLOW_HOLD` = 1 stop down for each stop that it stands more than
  `GLOW_FREE` = 3.5 stops above the sky. From cruise the band is a thin
  line some 7 stops over a dark sky, and the sky stays near black; near
  the sea, where it is a wide glow 4 stops over the sky, the sky and the
  sea keep a visible deep blue (they were near black at -10 degrees,
  where photographs show them deep blue). A view away from the glow holds
  no such peak and keeps the exposure of its sky;
- and as the sun goes down the picture never grows brighter. The
  exposure is at most what the same view would get with the sun higher,
  at every `MONO_STEP` = 0.25 degrees up to the start of the blend: the
  same view with all its levels raised by `MONO_RATE` times the
  stops that the air's mean light at the eye's height (`airLevel`, from
  `msData`) is brighter there, and its exposure lowered as much. The
  meter's statistics are sorted once, so this costs some 60 evaluations
  of a few lines. With a uniform darkening the shown picture is then
  monotone. `MONO_RATE` is 1 through civil twilight and 0.8 from the sun
  6 degrees down (`MONO_DEEP`, -3 to -6, a smoothstep): at 0.8 throughout
  (round 9) the sky away from the sun after sunset was held near the
  late afternoon's level, darker and deeper blue than photographs from
  cruise show it (r3, A3f: pale blue); 1 throughout lifted deep twilight
  near the sea by up to a stop. The picture as a whole still never
  brightens after sunset; the sky part of a view away from the sun does
  rise (80 to 138 of 255 at 11 km between 8 degrees up and 2.4 down), as
  the deck below darkens sooner than the sky. Not seen by the envelope:
  facing a sun that is still up from near the sea, the view brightens
  by 3 to 9 levels per 0.4 degrees from 5 to 1 degrees up, as the
  sun's aureole in the haze dims faster than the rest. An envelope that
  also lowered the highlights by the sun's own dimming held that, but
  jumped by 100 levels where the sun went below the eye's horizon. Before
  (round 8), the twilight's exposure was blended in from 2.5 to -0.5
  degrees and lifted the picture by up to `DUSK_LIFT` = 1.2 stops (gone
  now): in a time-lapse the sky away from the sun went from 75 to 148
  (of 255) between sunset and 2 degrees below it, and the view towards
  the sun from near the sea rose by 23 levels as the sun's disc set;
- and at night the eye opens up no further than it can: the exposure is
  at most `NIGHT_OPEN` = 16.75 when the sky's level (the level that the
  brighter third passes, as in twilight) is `NIGHT_SKY` = -22.5, about a
  quarter moon's, and `NIGHT_RATE` = 0.5 stops more for each stop that it
  is darker (less for each stop brighter). By day and in twilight it is
  far above the exposure and does nothing; it takes over in the last of
  the twilight, with the sun 11 to 18 degrees down (sooner near the
  sea). Before it, the floor held the median at about the same shown
  level from dusk down to a moonless night, as a long exposure does:
  under a quarter moon the clouds came out nearly as light as by day (150
  of 255 from cruise), yet the sky showed only the brightest few stars.
  Now they are at about 40 to 70 under a quarter moon and 110 under a
  full moon, and a moonless night is darker still: black sky, stars, the
  clouds below barely seen.

`exposureFor` returns the exposure.

**Adaptation.** Each frame the exposure moves
towards its target by the page's clock (`now`, at most 0.1 s a frame): exponentially in stops, with
a time constant of `ADAPT_FAST` = 0.2 s towards less exposure (a brighter
view) and `ADAPT_SLOW` = 0.5 s towards more. It starts when the target is
`ADAPT_START` = 0.03 stops away and stops within `ADAPT_STOP` = 0.01, so
that the noise of the picture does not keep it moving. In flight, which
draws anyway, it keeps within `ADAPT_TRACK` = 0.002 of the meter.

**The flight check and the meter.** A flight of 61 frames from the
page's load (the tools' `flight` check) is compared with a still at the
place reached. Each page starts at the meter of its first, single frame;
the still keeps it (within `ADAPT_START` of the settled picture's) and
the flight follows the meter of its own, noisier picture, so they ended
0.01 to 0.02 stops apart, a uniform 1 to 1.5 %: 1.55 levels against
main's 1.13 at cruise, 1.48 against 1.09 at 3 km. That was an artefact of
the comparison, so the check now reads the flight's exposure at its last
frame (`window.__exposure`, log2) and draws the still at it (`?expo=`
pins the exposure): 1.21 and 1.12. Separately it asserts that the
exposure stays steady, moving under 0.01 stops over the last 20 frames
(measured 0.0024 and 0.0030). `res` draws its still the same way. The
base has neither, and is compared as it comes.

At the end of `main`:

1. Spectrum to linear sRGB, times `ISUN`. At night the rods take over from
   the cones (after Krawczyk, Myszkowski and Seidel, 2005): the colour is
   mixed with the grey that the rods see (`uWS`: the shape of the CIE's
   scotopic curve, peak at 507 nm, fitted as a Gaussian in wavenumber;
   sunlight gives the rods the same luminance as the cones), a little
   blue (`ROD_TINT`, the "blue shift" of the night in Jensen et al.,
   2001, but less). The rods' share depends on Y, the pixel's luminance in
   cd/m2 (`CD` = 6650 per unit: white paper in the sun outside the air,
   133,000 lux, is 1 / pi here), times `uNightEye`. In twilight it is
   `ROD_HALF / (ROD_HALF + Y)`, `ROD_HALF` = 0.01 cd/m2 (the paper's 0.04
   greyed the sky of nautical twilight, which photographs and the eye see
   blue). As the eye adapts further (`uNightGrey`, `nightGreyFor`: the
   exposure from 12 to 15, in a view away from the sun the sun from about
   9 to 13 degrees down; before, the sun from 10 to 14 degrees down) it
   widens to the eye's mesopic range: from 1 to 0 as Y goes from `MESOPIC`
   = 0.003 to 3 cd/m2, along a smoothstep in log Y. The sky of nautical twilight is as dim as a full moon's clouds (both
   about 0.07 cd/m2), so a range in luminance alone would grey both; the
   eye still sees that sky blue. So the moonlit clouds under a quarter moon
   (about 0.003 cd/m2) are grey, those under a full moon (about 0.07)
   mostly grey, and the moon's glitter keeps a little colour only where it
   is bright. At the top of the rods' range, from `SKY_BLUE` = 0.001 to
   0.01 cd/m2, the rods' grey of light bluer than that grey turns bluer
   (`ROD_BLUE`): a full moon's sky (about 0.002 to 0.02 cd/m2, darkest
   overhead from cruise) and the sea that mirrors it are a dark blue,
   lighter towards the horizon, while a quarter moon's sky (under 0.001)
   stays grey, and so do the moonlit clouds and the glitter, which are
   not bluer than the grey. Before (round 2) the full moon's sky was a
   flat grey (R, G and B within a fifth of each other). A long exposure
   shows all of them in the colours of sunlight. Round 1 took the share
   as `0.01 / (0.01 + Y)`: it left the full moon's clouds tan and a brown
   rim along the far cloud tops. That rim is the far clouds' light
   reddened on its way to the eye through some 300 km of air, not the
   moonlight's colour (the full moon stands high): the same view by day
   shows it too, but there the tone curve runs it into white. Before,
   the light of a low moon, reddened on its long way through the air and
   on the way back from the far clouds, made tan clouds, a golden glitter
   and an orange-brown rim
   along the far cloud tops at the horizon. The level for the meter is
   taken here; then times `uExposure`.
   No shoulder keeps the hue: each channel meets the curve of steps 4 to
   6 on its own, as on a camera's sensor.
2. The white balance `uBalance` (`balanceFor`). By day a camera's for
   daylight, `DAY_BALANCE` = (0.932, 1.013, 1.074). In twilight it goes
   `BALANCE_ADAPT` = 0.5 of the way (in log) towards the colour of the
   light on the level ground (the sky's from above, `upData`, kept by
   `buildMultiScatter`, and the sun's while it is up), relative to that
   light with the sun at 30 degrees, as an automatic white balance does
   and as the eye adapts. Blended in as the sun goes from 2.5 to -0.5
   degrees (`BALANCE_IN`), and out again as the sun goes from 4 to 9 degrees down
   (`BALANCE_OUT`), and with height, from 2 to 11 km (`BALANCE_HIGH`):
   from cruise the view is the high sky and the deck far below, which
   photographs keep as blue as by day; this correction, warm for the
   light of the low air, turned that sky lavender-grey and the deck pink.
   Without it the sky away from the sun came out
   lavender and the Belt of Venus magenta, where photographs show a pale
   blue sky and a pink belt; held into the deeper twilight, it turned the
   blue sky grey and the clouds brown. Tried again without
   `BALANCE_HIGH` (round 10): towards the sun from cruise at -4 degrees
   the sky came out grey-lavender as in A1d, but away from it grey where
   r3, A3f and A3a are pale blue; kept.
3. A camera's saturation by day, `uSaturation` (`saturationFor`):
   `DAY_SATURATION` = 1.3 about the luminance, in linear light, falling to
   none as the sun goes from 8 to 1 degrees (`DUSK`) and none at night.
   The light of the clear sky from cruise is almost pure Rayleigh, red a
   quarter of the blue in linear sRGB; photographs from the air show it a
   strong azure, red a tenth or less (the camera's colour). Twilight and
   night were set without it, and keep their colours.
4. Light far too strong for the screen (1 to 6 times white) turns towards
   white, as on film.
5. A "look": `pow(col, uLook)`, with `AIR_LOOK` = 1.4. For what the rods
   see (the rods' share of step 1) it takes the power on the luminance
   alone, so it adds no colour the eye does not see, and a steeper one,
   `NIGHT_LOOK` = 1.7, the same as by day at `LOOK_PIVOT` = 0.12 (about
   the moonlit clouds): the night has black in it, the dark sea and the
   sky away from the moon, where the gentler curve left a grey veil over
   the whole picture (sky 17 and sea 5 to 6 of 255 under clouds at 60;
   now about 9 and 4). As the eye adapts to a darker night it grows
   steeper still: from `NIGHT_LOOK` to `DARK_LOOK` = 2.0, and its pivot
   from `LOOK_PIVOT` down to `DARK_PIVOT` = 0.07, as the exposure (log2)
   goes from 15.5 (about a full moon's) to 17.5 (a moonless night from
   cruise; `DARK_EYE`). That is the eye's contrast on a dark night, for
   everything alike: the Milky Way, the zodiacal light and the stars stand
   out of a moonless sky, and fade under a moon because the moonlit sky
   lies over them and the curve is gentler there.
6. Tone mapping `1 - exp(-col)`, channel by channel, then the display
   power `1 / 2.2`. Steps 2, 4, 5 and 6 are those of `main`.
7. Rounding at random to the storage steps (next section).

## The hero's mean over frames

One frame of the hero is noisy: each frame shifts the rays within the
pixel (`uJitter`, Halton (2, 3)) and the samples through the clouds
(`uPass`). The picture is the mean of many frames. `makeSky` keeps three
textures for it, each with a second 8-bit texture beside it (`aux`):

- `shot`: the new frame, drawn by `fs` into two outputs: the colour with
  the level in alpha (`outColor`) and the distance of what each pixel
  shows (`outAux`);
- two `pictures` that take turns: the one so far is read while the next is
  drawn by `mean`; then `show` copies the new one to the canvas.

**Storage.** Half floats (RGBA16F) where the GPU can draw to them
(`EXT_color_buffer_half_float` or `EXT_color_buffer_float`, and the
framebuffer is complete), else RGBA8. Values are kept in steps of
`1 / uSteps` (2048 or 255), rounded up or down at random each frame, so
that the mean neither bands nor sinks. `show` dithers by one 8-bit step
when the picture is in half floats.

**The distance code** (`distanceCode`, read back by `decode` and
`nearness`): `0.5 + log2(t) / 20`, in 16 bits over two 8-bit channels; the
sky is infinitely far (code 1, nearness 0). The pixel's distance is that
of the clouds if they hide a tenth of what is behind or give a twentieth
of its light (`C` against `L`, in one band of wavelengths: a wisp in
front of the dark sea), else of the sea, else
infinity; a cirrus sheet counts when nothing else is there, or when it
hides the rest.

**Reprojection** (`whence` in `mean`): each pixel finds where what it shows
now was a frame ago. Clouds and sea have come nearer by the eye's way since
(`uWay`, from the change of `state.drift` and altitude), at the same height
over the curved ground; the sky stays (the air moves with the eye). The
old camera (`uCamPast`) gives the old pixel. If something nearer was there
a frame ago (the ragged edge of a cloud), the pixel reads the past instead
where a thing at that nearer distance, on this pixel's ray now, was a
frame ago.

**The read** of the past is a Catmull-Rom filter in nine bilinear reads
(Jimenez, 2016), clamped to the four texels around, which also give the
number of frames in the mean (B of `aux`, over 64) and the past distance.

**The neighbourhood check.** If the past was nearer or further by enough to
slip a fraction of a pixel (`doubt`, from the parallax), it counts only as
far as it fits the 3 by 3 neighbourhood of the new frame (clamped to its
minimum and maximum). A past that had to change much was something else:
its count drops to 1.

**The picture's distance** (R, G of the picture's `aux`): the nearer of
the new frame's distance and a mean of the past one and the new one, with
the new one weighed as the new frame's colour is (without a past, the
new frame's distance). So after a miss a
cloud's distance fades only as fast as its light does. While the picture
holds a near cloud's light, the pixel moves with that cloud; once the
cloud has gone, the neighbourhood check lets its light go. If the
distance went back to the sea sooner, the light would stay on the sea
and trail behind a near cloud in flight, in streaks.

**The weights.** The new frame weighs `1 / (n + 1)`, with `n` the past's
count, capped by `uTrust`, which the JS sets per frame:

| Situation | `uTrust` | New frame weighs |
|---|---|---|
| First frame, canvas resized, or a jump of more than 1 km | 0 | 1 |
| The light changed (`look`: time, date, moon, haze, wind, cirrus, altitude, cloud), for `RELIGHT` + 1 = 7 frames | 1 | 1/2 |
| The view moves, the aircraft flies, or the exposure moves | `IN_MOTION - 1` = 9 | 1/10 |
| At rest | 63 | 1/(n + 1): the plain mean |

The frames are tone-mapped before they join the mean, so a frame drawn
at another exposure would linger in it. While the exposure moves, the
mean therefore weighs the frames as in motion: the picture lags the
exposure by a few frames, and once the exposure stops, the plain mean
takes over.

**When drawing stops.** At rest (speed 0, no drag), the renderer counts
the frames since the last change or the last move of the exposure
(`calm`) and stops once it reaches `SETTLE + RELIGHT` = 38: 39 frames in
all after the last change, if the exposure does not move. While the
aircraft flies, it never stops. Playing at real time, each step of 10 s
starts the count again (see [Playing](#from-the-address-bar-to-the-first-frame)).
A still picture for testing therefore needs `speed=0`, and from page load
about 48 frames: the first frame is only metered, and the next ones may
start the mean again (a restart if the drawing size grows).

## The drawing size

`fit()` sizes the canvas: its CSS size times the device pixel ratio (at
most 2), but no more pixels than the resolution choice (`#pixels`,
`HERO_PIXELS`): Full HD (1920 x 1080 pixels' worth), WQHD (2560 x 1440,
the default) or 4K (3840 x 2160). It comes from `?pixels=`, else from
`localStorage` (`sky.pixels`, written when the choice changes), else WQHD.

**Dynamic resolution.** While the view moves or the light
changes (within 150 ms of the last such frame), the frame and the picture
are drawn at `scale` times the canvas size, and `show` stretches them.
The wall clock measures frames that follow one another: two measures in a
row slower than 40 ms shrink `scale` (by `sqrt(30 / ms)`, down to
`MIN_SCALE` = 0.35); faster than 24 ms grows it by 1.12, up to 1. At rest
the picture is drawn at full size; the smaller past then counts as one
frame. `?res=` fixes `scale` for tests.

## Textures made at start

All are made during the loading, in `makeSky` (the cirrus's four
later if the page starts without cirrus: when cirrus is first shown):

| Texture | Unit | Size and format | Made by | Holds |
|---|---|---|---|---|
| `uMS` | 0 | 40 x 72, RGBA32F, or RGBA16F without float filtering | JS, `buildMultiScatter` | Multiple scattering; the sky's light on the clouds |
| `uStars` | 1 | 1024 x 128, RGBA32F, nearest | JS, `buildStars` | Star catalogue |
| `uNoise` | 2 | 128^3, RGBA8, mipmapped, repeating | `noise` shader | R: Perlin-Worley; G, B, A: Worley at 4, 8 and 16 cells per tile |
| `uWeather` | 3 | 1024^2 over 256 km, RGBA8, mipmapped, repeating | `noise` shader | R: cloud cover; G: towers; B: gusts on the sea; A: unused (0) |
| `uWaves` | 4 | 512^2, RGBA8, mipmapped, anisotropic where available | `waves` shader | R, G: wave slopes; B: slope squared; A: streaks |
| `uDepth` | 5 | 512 x 128, RGBA32F or RGBA16F | JS, in `makeSky` | Depth to the top of the air |
| `uIce` | 10 | 4096 x 4096 (1024 x 1024 without a GPU), RGBA8, mipmapped, repeating, anisotropic where available | `ice` shader, in pieces | The ice of the cirrus, four kinds (see [Cirrus](#cirrus)) |
| `uIceWay` | 11 | a quarter of the ice's size, RG8, mipmapped, repeating | `ice` shader, from the ice | The way the ice runs |
| `uIceFib` | 12 | as the ice, R8, mipmapped, repeating, anisotropic where available | `ice` shader, in pieces, from the way | The ice's fibres |
| `uCiMap` | 13 | 256^2 over 256 km, RGBA8, mipmapped, repeating | `ice` shader | The cirrus's map: how much for each deck, and of what kinds |

Units 6 to 9 hold the frame and the picture so far for `mean`; `show`
and `meter` read unit 6. Unit 10 holds the clouds' shadow map
(`uShadow`, `SHADOW` texels square, RGBA16F or RGBA8, linear), drawn
while the page runs (see [The clouds' shadow](#the-clouds-shadow)).

The weather map draws, on 256 km: systems of some 80 km, open cells of
30 km with cloud along their walls, streets 5 km apart, clumps from 6 km
down to 1 km, towers where the widest clumps are, and gusts on the sea.
The cirrus's map is drawn by the `ice` shader (see [Cirrus](#cirrus)). The wave map is a sum of plane waves, each
a whole number of times across the map.

Their random numbers come from one integer hash, `ihash`: Wellons'
lowbias32 (two rounds of xor-shift and multiply, from hash-prospector, in
the public domain). The `noise` and `ice` shaders hash a lattice cell's
coordinates, packed into one word, plus the seed; the `waves` shader the
number of the wave; `fs` the lattice of the finest fibres. The word, and its low 21 and 10 bits moved up, are
three random numbers, with 11, 11 and 10 bits of their own. The cirrus's
ice uses the same hash (`iceWord`: a lattice point's coordinates and the
seed, each times an odd constant, summed into one word). Its noise wraps
the lattice by hand, not with `mod()`: on the GPU here, `mod()` of a whole
number by itself gave the number back in places, and a seam ran along the
lattice line there (seen as a difference from SwiftShader).

## Sound

`SkySound`, in its own script block, makes the background sound with the
Web Audio API. Nothing is loaded: every part is noise or a tone, filtered
to stand for one source of the real sound. `engine(ctx)` builds the graph
on any `BaseAudioContext`, so that a test can render it in an
`OfflineAudioContext`. `attach({...})` runs it in the page: the controls,
the address, `localStorage`, and the `AudioContext`.

**The noise bed.** One source of noise feeds every branch: Gaussian noise
in a stereo buffer of 11 s (the right channel 0.6 correlated with the
left, for some width that stays safe in mono), multiplied by random signs
from a mono buffer of 10.3 s. The product is Gaussian noise again, and it
repeats only when both loops line up, which is never in practice. A branch
that overlaps others in frequency takes the same noise 0.1 s later
(`late`), so that it neither adds to them nor cancels them.

**The output.** The voices are mixed (cruise near -27 dBFS), high-passed
at 25 Hz, compressed (threshold -24 dB, ratio 4, a look-ahead of a few
ms), trimmed, and held below -1.4 dBFS by a tanh curve; then the volume
(its square) and a fader for the hidden page. At volume 1 the cruise is
near -21 dBFS and the loudest state peaks near -6 dBFS.

**The variations.**

| Variation | Branch | Stands for |
|---|---|---|
| airliner | noise, low-passed twice (450 and 1500 Hz, times `bright`), low shelf | the boundary layer's rush, through the fuselage wall |
| | noise under 85 Hz | the airframe shaking in light turbulence |
| | two tones of 56 Hz with 9 harmonics, panned ±0.35 | the engines' fan shafts; the second 8 to 22 cents faster, so they beat |
| | noise, band-pass at 1340 Hz | the fans' whirr (24 blades) |
| | noise, 1.8 to 7 kHz | the air conditioning |
| airliner-whine | all of the above, and per engine: | |
| | a tone of 1340 Hz with its 2nd and 3rd harmonics | the fan's blade-passing tone |
| | orders 8 to 40 of the shaft, irregular, around 1.1 kHz | buzz-saw: shocks at the fan's tips |
| | a tone of 3.46 kHz | the high-pressure compressor's whine |
| | narrow noise at the fan tone and at the whine; all low-passed at 3.5 kHz | their broadband part; the cabin wall |
| wind | noise, high-pass at 45 to 170 Hz (higher in thinner air), low-pass at 800 Hz times `bright` | the rush past the ears and the frame |
| | noise under 110 Hz | buffeting |
| | two narrow bands (Q 22) at 700 and 1130 Hz times `bright` | whistles on edges |

**What follows the sliders.** Only the air. `flight(alt, speed)` gives the
density (`sigma`, scale height 8 km), the rush's level from the dynamic
pressure (density times speed squared, with a light breeze at speed 0;
0.7 of its change in dB, held softly under +9 dB), `bright` (the square
root of the speed: the rush's low-pass cutoffs and the whistles' pitch
rise with it) and `body` (a low shelf from the density: thin air has less
low end). The engines do not follow the speed: the slider is how fast the
view goes by, not a throttle, and in cruise an airliner's engines hold a
steady speed. They stay at N1 0.9 (`N1`, `SHAFT`), at the level of cruise,
whatever the speed and the altitude. The wind variation has no engine and
follows both sliders. Changes glide (`setTargetAtTime`, 0.4 to 0.6 s).

**Slow movement.** Gusts, swells of turbulence and the wander and beat of
the engines are knots of random values, each voice's `tracks`.
`tick(until)` schedules them on the audio clock; in the page a timer calls
it every second for the next 4 s. It does not depend on the drawing loop,
which stops at rest, and it never asks for a frame.

**In the page.** No `AudioContext` exists before the first click or key
press: a sound chosen in the address or on an earlier visit waits for it,
and the panel says so. Switching variations crossfades (0.15 s time
constant). Off fades out and suspends the context; so does hiding the
page, and showing it again resumes. Without `window.AudioContext` the two
controls are hidden.

