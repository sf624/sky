# How Sky draws a frame

This document follows one frame from the address bar to the pixel. It
describes the code on `main` as it is. Names are those of `index.html`:
functions, constants, uniforms and element ids. Plans and known flaws are
in the [issues](https://github.com/sf624/sky/issues), not here.

## The page

`index.html` holds everything: the markup, the CSS and nine `<script>`
blocks. It loads no other file.

| Block | Kind | What it is |
|---|---|---|
| (no id) | JS | `TEXT`, the strings in Japanese and English, and `applyLanguage`. It runs right after the panel. |
| `stars` | data | The star catalogue, base64 (see [Stars](#sun-moon-stars)). One very long line: never print it. |
| `noise` | fragment shader | Draws the cloud noise and the weather map once, at start. |
| `waves` | fragment shader | Draws the map of the waves on the sea once, at start. |
| `fs` | fragment shader | The scene: air, clouds, sea, cirrus, sun, moon, stars. |
| `mean` | fragment shader | Joins each new frame of the aircraft's view to the picture so far. |
| `show` | fragment shader | Copies that picture to the canvas, with dither. |
| (no id) | JS | `SkySound`: the background sound (see [Sound](#sound)). |
| (no id) | JS | Everything else, in one function that runs at load. |

There is one canvas, `#sky`, the hero: the view from an aircraft. Clouds,
sea, cirrus, glare. It flies (900 km/h by default) and is drawn as a mean
over frames. It fills the window, and the page does not scroll.
`makeSky(canvas, view)` compiles `fs` and the other shaders for it.

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
  numbers of crests (`SWELL`), the cirrus frame stepping by whole numbers
  (`CI_DIR`, `CI_FREQ`, `CI_FIB`, `ciNoise` with a whole `period`), and the
  `bend` of the cirrus written with whole-number frequencies. The `bend`
  sum appears twice, in `noise` and in `ciDepth`: change both together.
- Comments in the code are plain English sentences that say what and why.

## From the address bar to the first frame

The JS runs once, at load:

1. **Tables that do not depend on the view.**
   - `odTable` (`buildDepths`): optical depth to the top of the air towards
     the sun, over altitude (48 rows, squared spacing) and the cosine of the
     sun's zenith angle (96 columns from -0.2), 64 steps each. Read by
     `sunDepth()` in the JS only.
   - `msData` (`buildMultiScatter(haze)`): the multiple-scattering table
     (see [The air](#the-air)).
   - `starData` (`buildStars`): the star texture.
   - `DAY_LEVEL` (the metered sky with the sun at 42 degrees) and `NIGHT`
     (4e-8 of it: the moonless night sky, airglow).
2. **The renderer.** `makeSky` for `#sky`, inside a `try`: if it fails, the
   error goes to the console. Without WebGL2, the canvas keeps its CSS
   gradient.
3. **Inputs.** URL parameters with the id of a slider set that slider's
   value (the browser clamps it to the slider's range and step). Then
   `readInputs()` copies the sliders into `state`. `now`, `rate` and `play`
   then act as the now button, the select and the play button. `yaw`,
   `pitch`, `heading`, `at`, `pixels` and `res` are read directly (see
   [development.md](development.md#url-parameters)). Without `yaw`, the view
   starts 65 degrees to the side of the sun; without `heading`, the
   aircraft flies 60 degrees to the left of the view.
4. **The loop.** `update()` marks the state changed and calls `kick()`,
   which asks for one `requestAnimationFrame(frame)`.

`frame(now)` then:

- does nothing in a hidden tab;
- if something changed: rebuilds `msData` when the haze has changed, runs
  `celestial()`, sets the exposure (`state.airExposure`) and the panel's
  labels;
- moves the aircraft: `state.drift` grows by `speed / 3600 * dt` along
  `state.heading` (`dt` capped at 0.1 s, and 0 after a pause, so the
  aircraft never jumps);
- calls the renderer;
- asks for another frame only if the renderer returned true.

The renderer returns true while the aircraft flies or while its picture is
still settling. So the page draws nothing at rest once the picture is
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
  angle. It counts (`state.moonI`) only when the sun is below -3 degrees and
  the moon above -18.
- `state.sunOn` (`uSunI`) is 0 when the sun is below -21 degrees.
- One light for the clouds and the sea (`uLight`, `uLightI`): the sun while
  it is above -3 degrees, else the moon.
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
- Mie (aerosol): `exp(-h / HM)`, `HM` = 1.2 km; scattering `BETA_M` =
  3.996e-3 per km times `uHaze`, extinction `MIE_EXT` = 1.11 times that.
  Grey: the same at every wavelength.
- Ozone: a triangle from 10 to 40 km, peaking at 25 km; absorption `uBO`
  from the Chappuis cross-sections (`OZONE`) for 300 Dobson units.

Phase functions (`phases`): Rayleigh, and the Cornette-Shanks form for Mie
with `g` = 0.8.

**The march.** `NV` = 20 samples at
`t = tmax * f * f`: denser near the eye. Each sample adds, for the sun and
for the moon, `addLight`:

- light scattered once, if the planet does not hide the source: the
  transmittance from the eye to the sample and from the sample to the top
  (`depthToTop`) times the phase functions, times `direct`,
  which the shadow of the clouds lowers near the sea;
- light scattered many times: the multiple-scattering table times the
  local scattering coefficient, times the transmittance to the eye.

The clouds and the cirrus enter the march as two layers (see
[Low clouds](#low-clouds) and [Cirrus](#cirrus)). At each layer the march
ends a sample exactly there (`tLayer`), adds the layer's light (`C` or
`H`) dimmed by the air before it, and multiplies what lies beyond by the
layer's transmittance (`vis *= Tc` or `Th`). Behind a thick cloud
(`vis` = 0) the march stops.

**`depthToTop(p, d)`**, the optical depth from `p` to the top of the air:

- One filtered read of the depth table `uDepth` (512 by 128, `DEPTH_MU` by
  `DEPTH_R`), made at start in `makeSky` by a 16-step midpoint sum. Its axes follow Bruneton (2017): the distance to the top, between
  its least and its most at that height, and the distance to the horizon
  (`rho / H_TOP`). The table is RGBA32F where the GPU can filter full floats
  (`OES_texture_float_linear`), else RGBA16F.
- The table repeats the density profile. The profile is written out five
  times: `density()` in `fs`, and in the JS `buildDepths`,
  `buildMultiScatter`, `skyLuminance` and this table in `makeSky`. Change
  all five.

**Multiple scattering** (`buildMultiScatter`, after Hillaire, 2020): for
each altitude (`NH` = 12 rows, squared spacing) and cosine of the sun's
zenith angle (`NMU` = 40 columns from `MS_MU_MIN` = -0.35), the light
scattered twice is gathered over the sphere as if scattering were
isotropic (8 by 4 directions over half the sphere, mirrored; 14 steps
each), with sunlight bounced off the ground (`ALBEDO` = 0.07); the higher
orders follow as a geometric series. One value per wavelength, per unit of
scattering coefficient. The texture is `NMU` by `3 * NH`: the three groups
of four wavelengths stacked in y. It depends on the haze, so `frame`
rebuilds it when the haze changes, and the renderer uploads it again.
`fs` reads it through the GPU's filter (`textureLod`; RGBA16F when full
floats cannot be filtered).

The JS keeps a copy of the march, `skyLuminance()`, to meter the exposure
(see [Exposure](#exposure-and-the-tone-curve)).

## Low clouds

Low clouds live in a shell from `CB` = 0.6 km to `CT` = 5 km. `CB` is
the shell's lower bound, not the height of the bases: they stand 150 to
300 m higher (below), so that nothing that reads `CB` (the march's range,
the shade of the clouds on the sea and the low air) has to change.

Places in the clouds are given from the eye (`p` less `eye()`), and
`heightAt` finds their height. At the Earth's radius a float steps by half
a metre, and the finest noise showed those steps as terraces.

**The field.** A signed field says where cloud is: positive inside,
rising by about 1 per km of depth under the surface. `cloudShape` builds it
as a sum:

- the weather map `uWeather` at `p.xz + uDrift` (R: cover, G: how high
  the heap stands),
  against a level set by `uCloud` (a cubic in `uCloud`). `weather` reads
  it: through the GPU's filter, which bends where the map's texels meet
  (every 250 m). Near the eye (where a pixel is finer than 8 m) the place
  within a texel is first eased by a smoothstep (Quilez, "improved texture
  interpolation"), so that the map bends smoothly, in one read still:
  else the sides of clouds within a few km show those bends as upright
  streaks. Where a pixel is finer than 4 m it is read through a cubic
  B-spline (four filtered reads, Sigg and Hadwiger, GPU Gems 2 ch. 20);
- less what height costs: a dome over a flat base (`y` cubed over the
  cube of `top`), thicker where the map is higher. `top` follows G: each
  heap of the map is a dome 0.5 to 1.2 km over a deck between heaps and
  up to 1.9 km over its base on the highest heaps; the tallest (G over
  0.55) are towers, a kilometre higher still. So a field of cloud is a
  field of domes of many sizes even where the cover is whole; before,
  the top was one height wherever the cover was whole, and the noise of
  the tile made all the forms: one size of lumps with pits in them, like
  crumpled paper. Where the cover is thickest (`deck`) the domes flatten
  to a third of their height and the noise's 500 m cells take over
  (stratocumulus). A deck swells a little where the map is high
  (`swell`, a share of the height, not a fixed one); the lowest 180 m
  rounded off (`rim`). `y` counts from the base's `level`: 150 to 300 m
  over `CB`, higher or lower across tens of km (it follows the gusts'
  map, B, as a slow pattern);
- plus the noise of the tile (`uNoise`, one tile per `BASE_KM` = 8 km),
  read at a depth that drifts from place to place (`far`) so that no two
  tiles look alike. Worley values are rounded into domes (`v (2 - v)`).
  Its billows (`lump`: Worley cells of 2 km, 1 km and 500 m, weighed
  0.4, 0.6 and 0.7, the 500 m ones most) are as large as the heap is
  high (`0.7 + 1.3 G`), bulge out more than they dent in (dents count
  0.6, by a smooth curve: a kink at nought showed as ridges) and fade to
  30 % deep in a body (over the field's first 0.6 inside), so that they
  shape its outside and cannot punch holes through it: with full
  billows everywhere, the forms from 4 km had dark pits.
  Where a pixel is finer than 16 m, the reads that see the fine noise
  (the surface, not the shadows) go through a cubic B-spline
  (`noiseSpline`, eight filtered reads): the GPU's filter bends where its
  texels meet, every 62 m, and lit and shaded sides showed the bends as
  upright streaks and a grid of facets.
  `lump` says how far a place stands out of the billows; `body` how thick
  the cloud is there; `q.w` how rough.

The base is a field of its own (`base`: twice the height over `level`,
in km, so that it is dense 15 to 30 m in),
up to 120 m lower under the thick middle of a cloud and under the swells
of a deck (`e`, from the smooth weather map), and a little higher or
lower from place to place (`n.r`, `lump`: little, since the noise of the
tile is read through the GPU's filter, and its facets would show on a
surface as smooth as a base). The cloud is the lesser of the two fields.

`cloudDetail` gives the fine noise: `DETAIL` = 7 tiles per tile, billows
of 300 m down to about 20 m, weighed by `RELIEF` = 0.85 (1 made the
small lumps stand out like a cauliflower in photographs' place of soft
domes). The 300 m billows stand out about a third of
their width, the smaller ones up to a half, so that small billows sit on
large ones: a cauliflower (equal weights made a foam). Near the eye the
same noise, 8 and 64 times finer (billows of 36 m down to 1 m), adds
smaller billows still, each only where a pixel is fine enough to show it
(`MICRO`; turned about the vertical by whole numbers, so that it repeats in
the tile). The weights fall by about 0.26 for each eighth of the size.
Without them, clouds 0.3 to 3 km away had nothing smaller than 20 m, a
texture blown up 20 to 60 times: soft mounds. `cloudField` adds it near the
surface only (`min(f, base) > -0.25 * RELIEF`), more strongly on thin
cloud:

- on the sides and tops; not on the base, which is flat and shows its
  broad mottling only;
- under the base where the noise swells most: shreds that hang below it,
  with a deep, faint fringe (`edge` 100 m), so that they are ragged and
  thin.

Fine noise carved into a base (Worley creases cut by a plane) looks like
veined marble from under it; one height for every base makes a straight
line of them, seen from their own height.

`cloudExtinction` turns the field into extinction: `SIGMA` = 90 per km
once the field is past the edge, with more water higher up and in thicker
clouds. The edge (`edge`, from `cloudField`) is 10 m deep on hard,
growing turrets and `EDGE` = 30 m on older, softer cloud; the extinction
rises with the square of the depth there, so the outer part is a thin,
translucent fringe. Billows smaller than the edge melt into it: with
edges of 25 to 60 m every near top looked like cotton wool. Where the field is smoothed over a pixel wider than
the edge, the smoothing sets the width and the rise is linear.

**The march** (`clouds`) runs from where the ray enters the shell (`ta`) to
where it leaves it (`tb`, at most 600 km). A ray that goes on to the sea
leaves it at the cloud base; from under the base, such a ray has no
clouds.

- The steps grow with the distance: `ds = max(DS_NEAR, t * min(DS_REL *
  (1 + t / L), rel))`, with `DS_NEAR` = 8 m and `DS_REL` = 0.0045 (the
  steps were 20 m up to 4.4 km). Strides through clear air are planned as
  before, with `dsAir = max(DS_MIN, ds)` and `DS_MIN` = 20 m; so are the
  steps under a base, which has no fine noise (rays that grazed it crept
  along it). Steps of 3 m looked the same and cost half as much again. On a
  long path the march must end within its budget (`COARSE * 80` steps'
  worth), all of it for the part beyond the knee (`DS_MIN / DS_REL`, 4.4
  km), wherever the ray enters the shell. The budget used to pay for the
  part before the knee too: once the eye came within about 6 km of the
  tops (below some 6.5 km, looking down 20 degrees), that part ate it,
  the steps beyond grew up to three times longer and the noise read with
  them was smoothed as much, so the clouds went soft between 6.5 and
  5.2 km of altitude. `CLOUD_STEPS` pays for the near part. `rel` is the one rate for the whole ray that does so; `L` the
  distance past which steps of `DS_REL * t` grow by `1 + t / L` and do so
  too (the sum of `dt / ds` from `max(ta, DS_MIN / DS_REL)` to the end has
  a closed form). The lesser of the two keeps the steps fine near the eye
  and as before far off. With `rel` alone, clouds 2 to 5 km off were
  marched in steps of 100 to 200 m on rays that end far away, and their
  edges came out as thin dark squiggles and a hatch. At most
  `CLOUD_STEPS` = 400 steps, and the march stops when less than 1 % gets
  through (320 ran out on a few rays along the horizon under a deck once
  the near part no longer took from the budget). With 160, rays that pass under a deck towards the horizon ran
  out of steps before they met it, and the sky behind showed as a thin
  pale-blue line.
- The plan must not jump where the end of the ray does: a ray that meets
  the sea is planned as if the sea were a mirror and the ray went on up to
  `CT`. So a cloud in front of the horizon looks the same above and below
  it.
- In clear air the field tells roughly how far the next surface is: steps
  of `0.35 * |f|`, between `FINE * ds` and `COARSE * dsAir`. A long stride
  that lands inside a cloud steps back, and the next three steps in clear
  air are at most `ds`, so edges come out crisp. Inside, steps of
  `0.5 * f`, at most `ds` while more than 60 % gets through, growing to
  `dsAir` where little does; in a faint fringe as long as takes a seventh
  of the light, up to `dsAir`.
- The detail of the noise read (`lod`) follows the pixel's footprint at
  that distance, or a fifth of the step if that is larger.
- The start is jittered per pixel and per frame
  (`ign(gl_FragCoord.xy + 5.588238 * uPass)`, interleaved gradient noise)
  over a whole stride (`COARSE * dsAir`); the mean over frames removes the
  noise. Jittered over a fine step only, the strides landed in the same
  places frame after frame, and clouds 3 to 5 km off showed ripples.

**The light** is worked out at the first sample of each cloud the ray
enters, unless the clouds in front already hide more than 85 % of what
lies behind (it then keeps their light: it would show little of its own,
and the light is most of the cost), and again while more than 40 % of the
light still gets through, each time 30 % more of it has gone (not at
every step); deeper samples share the last result. At a
sample just past the surface it is worked out on the surface itself,
found between the last two samples. For each:

- `lightDepth`: steps towards the light, growing by 1.6 each, from
  `0.00625 t` (at least `LIGHT_MIN` = 15 m, at most 50 m), until they reach
  27.8 first steps' worth (six steps). The levels at which they read the
  noise shrink with the first step below 50 m, so that a cloud 3 km off is
  shaded as one 8 km off, at a third of the size. The first
  two see the fine noise, smoothed over at least 15 m far off (`crisp`:
  soft shadows of the small billows; light spreads over tens of metres in
  a cloud), and so does the third. The later ones are moved sideways each
  frame (`off`, up to `PENUMBRA` = 60 m), each a third of a turn from the
  one before, at an angle from interleaved gradient noise: over the frames
  the shadows soften (white noise there leaves a grain in the settled
  picture).
- `facing` comes from the normal: the gradient of the field with the fine
  noise smoothed as for `mid` (below), over 1.5 first steps along the light and two
  axes across it, normalised. Beyond 8 km, where the first step is 50 m,
  the normal of whole billows (below) serves instead: four reads of the
  fine noise fewer, and a mean difference under a level. The slope towards the light alone was lit or
  dark and nothing between, as the field is steep: flat white with blue
  patches, like snow. A wrap of 0.3 lets a side turned a little away still
  catch some light. The same normal at the size of whole billows (the
  field without the fine noise, over at least 120 m) gives `shapeL`: the light scattered
  many times falls from 110 % on a billow's lit top to `SHAPE` = 45 % on
  its side turned away, by a smooth curve; with the sun under 20 degrees
  (`low`), to half that, and `DEEP` (below) is halved too: at a low sun a
  side turned away is lit by the sky, blue-grey against the warm lit side,
  not by sunlight that went through the cloud. In photographs the light falls
  off over a whole billow and its small bumps are only faintly shaded; the
  normal of the small bumps alone made the clouds white all over, with
  small dark creases.
- `occ`: out along the normal, over 3 first steps, the field falls as fast
  as it rises at the surface on a billow in the open, and less in a crease;
  `crease` dims the light of a crease by up to `CREASE` = 25 %, and `open`
  takes half its value from the normal's tilt towards the sky. Together
  they give each billow a lit top and a grey underside, as cotton wool.
- `hollow` dims the hollows between those billows (where `mid`, what the
  fine noise smoothed over a few first steps adds at the surface, is
  negative) towards 75 %, and lifts their tops towards 110 %, by a smooth
  curve (a clamp left flat grey patches with sharp outlines, and `mid` was
  cut off where the field over the base passed 0.3: their edges).
  On a surface that faces down it also shows the cells of a deck: Worley
  cells of the noise read at 3.5 times the tile's frequency (some 600 m
  across, and texels of 18 m, whose facets do not show; the tile's own
  62 m texels showed as blocks), darker in the thick middle of a cell and
  lighter at its thin rim, by up to 40 %.
- The rise of the field without the fine noise towards the sky over
  `reach` gives `open`: how much skylight a place gets.
- `column`: light that comes down through the cloud above, the sky's and
  the sun's that went deep, is what a slab of that depth lets through:
  `1 / (1 + COLUMN (tau - 5))`, with `COLUMN` = 0.11 ((1 - g) 0.75 for
  g = 0.85) and `tau` the depth straight up (`shadowDepth`, five samples),
  once per cloud the ray enters (once per pixel left grey patches with
  sharp outlines on the sides of towers).
  Under a deck
  its thick cells are darker than the thin gaps between them; a base under
  a kilometre of cloud gets a tenth of the light of a top.
- Five phase terms stand for the orders of scattering: `p0` (scattered
  once: two Henyey-Greenstein lobes, dimmed by the whole depth; the
  forward one halved with the sun on the horizon, where thin fringes
  towards it glowed like red-hot wire) and `p1` to
  `p4` (scattered many times: wider lobes that go deeper). On a side turned
  from the light, `p3` keeps `DEEP` = 50 % (light that went deep forgets
  where it came from); `p3`, `p4` and the sky's light are dimmed by
  `column`. `white` makes
  only thick clouds brilliant; `billow` lights the tops of the big billows
  far off, where the fine ones are below a pixel; `bounce` lights a side
  turned from the sun with the sunlit cloud around it. The light scattered
  many times has a gain of `SUNLIT` = 0.53 and the sky's light one of
  `SKYLIT` = 1.5: with 0.66 and 1, sunlit cloud sat at display white with
  little gradient left (half the cloud of a view from 4 km above 210 of
  255), and the sides in shadow were grey rather than the luminous
  blue-grey of photographs.

`clouds` returns what gets through (`Tc`), the light per unit of sunlight
scattered once (`sOne`) and many times (`sMany`), per unit of skylight
(`sAmb`), and the mean distance it comes from (`tBar`). `main` turns them
into the spectrum `C` at `tBar`: sunlight through the air above (and
through the cirrus, `cirrusShadow`), plus skylight from the
multiple-scattering table, plus airglow.

**Shadows.** `shadowDepth` sums the clouds' depth towards the light from a
point under their tops (ten samples, denser low down; five for `column`). `main` uses it for
the sea's shadow and the glare. Where the ray meets no sea, the air near
the sea is dimmed by the cloud amount alone (`shade`). The light of the
sky in the air below 2 km is dimmed by the cloud amount too, to `UNDER` =
30 % under a full deck: else the air under a deck, a hundred km of it
towards the horizon, glowed as a pale-blue band.

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
  from near and from far.
- **Glitter.** The share of slopes that mirror the light to the eye, with
  Fresnel and Smith's shadowing term (`waveShade`, in the rational form of
  Walter et al., 2007).
- **Mirrored sky.** `skyAt` marches 8 steps of air in the mirrored
  direction of the tilted footprint. Rough water mirrors less at grazing
  angles (the mean Fresnel factor of Bruneton et al., 2010). Three samples
  of `cloudDensity` up the layer tell how much of that sky the clouds hide.
- **Light from below.** `SEA`: blue light scattered back out of clear water.
- **Foam.** Whitecaps cover `2.95e-6 U^3.52` of the sea (Monahan and
  O'Muircheartaigh, 1980), as separate breakers in a grid of cells: counted
  sharp from near, averaged from far.

The shadow on the sea is the `tau` passed in: `shadow` in `main`, the
depth of the clouds (`shadowDepth`) and of the cirrus (`cirrusShadow`)
towards the light.

## Cirrus

`highCloud`. The cirrus fills a shell from `CI_LO` =
12.2 to `CI_HI` = 12.8 km, but its pattern is drawn on one height: where
the ray crosses the middle of the shell (or halfway along a ray that only
grazes it).

The crossings of the eye's ray with `CI_LO`, `CI_HI` and the middle height
come from `eyeSphere`, which takes them from the heights, not from
`raySphere`: the slider stops on all three heights, and from an eye at a
sphere's own height `raySphere` puts the near crossing a hair ahead or
behind, ray by ray (see [development.md](development.md#glsl-rules)). From
`CI_LO`, a ray down leaves the shell at once.

![Cirrus seen from 11 km: ?date=319&alt=11&pitch=20&cirrus=0.6&cloud=0.3&yaw=150](images/cirrus.jpg)

- `ciDepth` gives the vertical optical depth at a place on the map: patches
  from A of the weather map, against a level set by `uCirrus`; streaks drawn
  out along the wind (three octaves, `CI_DIR`, `CI_FREQ`); lumps and tufts;
  Worley noise from `uNoise` eating into the edges; and from near, fine
  fibres (`CI_FIB`). Each octave fades out before it gets finer than the
  pixel's footprint (`foot`, `across`, `fibre`), so the pattern is filtered
  rather than aliased.
- The depth along the ray is that times the path through the shell over
  the shell's thickness.
- Light: forward scattering by ice (three Henyey-Greenstein lobes), the
  22-degree halo with the dispersion of ice, light scattered once with the
  sheet's own shadow, a share scattered many times, skylight from the
  multiple-scattering table, and light from the low clouds below.
- `cirrusShadow` dims the direct light on the low clouds and the sea (half
  the depth counts: ice scatters mostly forward).

`highCloud` returns `Th`, `H` and `tHigh`; the march through the air treats
it as its second layer.

## Sun, moon, stars

Rays that reach the top of the air (no sea, not behind a thick cloud) get,
all dimmed and reddened by the air:

- **The sun**: a disc of 0.267 degrees radius, of a fixed brightness (2000
  in these units).
- **The moon**: a sphere lit by the sun (`uSun`), so its phase comes out by
  itself, with darker seas from noise. The dark side holds a dim grey
  (`uEarth`: earthshine, capped so the night exposure does not burn it out).
- **Airglow** (`uNight`), brighter towards the horizon (van Rhijn's factor),
  and **the Milky Way** (`milkyWay`): a noise pattern on the real galactic
  plane, brighter towards its centre.
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
  compressed brightness (a "look"). The brightest get diffraction spikes
  fixed to the screen.

**Glare**: a glow of a few degrees around the sun, as strayed
light in a lens, dimmed by the clouds and the cirrus towards the sun.

## Exposure and the tone curve

The exposure is set in the JS, once per change, by `airExposure()`. It
meters the sky at the aircraft's altitude (`meterLight()`: the mean of
three points, or the glow above the sun if brighter), the band along the
horizon and the sunlit cloud tops (`cloudLuminance`), whichever is
brightest, against the same with the sun at 42 degrees (`REF_SUN`). It
opens up as the sky darkens, but not all the way. It stops down from high
up (`AIR_STOP`) and further with clouds (`CLOUD_STOP`), more so close over
the tops, and opens up under a sheet of cloud.

At the end of `main`:

1. Spectrum to linear sRGB, times `ISUN` and `uExposure`.
2. A daylight white balance, `vec3(0.932, 1.013, 1.074)`.
3. Light far too strong for the screen turns towards white (as on film).
4. A "look": `pow(col, uLook)`, with `AIR_LOOK` = 1.4.
5. Tone mapping `1 - exp(-col)`, then the display power `1 / 2.2`.
6. Rounding at random to the storage steps (next section).

## The hero's mean over frames

One frame of the hero is noisy: each frame shifts the rays within the
pixel (`uJitter`, Halton (2, 3)) and the samples through the clouds
(`uPass`). The picture is the mean of many frames. `makeSky` keeps three
textures for it, each with a second 8-bit texture beside it (`aux`):

- `shot`: the new frame, drawn by `fs` into two outputs: the colour
  (`outColor`) and the distance of what each pixel shows (`outAux`);
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
| The view moves or the aircraft flies | `IN_MOTION - 1` = 9 | 1/10 |
| At rest | 63 | 1/(n + 1): the plain mean |

**When drawing stops.** At rest (speed 0, no drag), the renderer counts
the frames since the last change (`calm`) and stops once it reaches
`SETTLE + RELIGHT` = 38: 39 frames in all after the last change. While
the aircraft flies, it never stops. Playing at real time, each step of 10 s
starts the count again (see [Playing](#from-the-address-bar-to-the-first-frame)).
A still picture for testing therefore
needs `speed=0`, and from page load about 46 frames: the first frames may
start the mean again (the first reset, and a restart if the drawing size
grows).

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

All are uploaded in `makeSky`:

| Texture | Unit | Size and format | Made by | Holds |
|---|---|---|---|---|
| `uMS` | 0 | 40 x 36, RGBA32F, or RGBA16F without float filtering | JS, `buildMultiScatter` | Multiple scattering |
| `uStars` | 1 | 1024 x 128, RGBA32F, nearest | JS, `buildStars` | Star catalogue |
| `uNoise` | 2 | 128^3, RGBA8, mipmapped, repeating | `noise` shader | R: Perlin-Worley; G, B, A: Worley at 4, 8 and 16 cells per tile |
| `uWeather` | 3 | 1024^2 over 256 km, RGBA8, mipmapped, repeating | `noise` shader | R: cloud cover; G: height of the heaps; B: gusts on the sea; A: cirrus |
| `uWaves` | 4 | 512^2, RGBA8, mipmapped, anisotropic where available | `waves` shader | R, G: wave slopes; B: slope squared; A: streaks |
| `uDepth` | 5 | 512 x 128, RGBA32F or RGBA16F | JS, in `makeSky` | Depth to the top of the air |

Units 6 to 9 hold the frame and the picture so far for `mean`; `show`
reads unit 6.

The weather map draws, on 256 km: systems of some 80 km, open cells of
30 km with cloud along their walls, streets 5 km apart, clumps from 6 km
down to 1 km, and heaps (`heaps`): single clouds, each a dome round a
point of a jittered grid of 4 km and of 1.6 km cells (the small ones where
the clumps are), of its own width (0.3 to 0.75 of a cell) and strength;
where two meet, a smooth max merges them without a crease. Cover (R)
takes the heaps squared; G is the heap's height, higher where towers
grow (the old map of towers). Then gusts on the sea, and
the patches and bands of cirrus. The wave map is a sum of plane waves, each
a whole number of times across the map.

Their random numbers come from one integer hash, `ihash`: Wellons'
lowbias32 (two rounds of xor-shift and multiply, from hash-prospector, in
the public domain). The `noise` shader hashes a lattice cell's
coordinates, packed into one word, plus the seed; the `waves` shader the
number of the wave. The word, and its low 21 and 10 bits moved up, are
three random numbers, with 11, 11 and 10 bits of their own. The cirrus's
`ciNoise` in `fs` uses the same hash per pixel: one word per lattice point,
which with its low half moved up is the gradient.

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

