# Sky

日本語: [README.ja.md](README.ja.md)

A web page that draws the sky as seen from the window of an aircraft.
It draws the air, low clouds, the sea, high thin cloud, the sun, the moon
and the stars, from the way light scatters.

**The page: https://sf624.github.io/sky/**

[![Clouds, sea and thin cloud, seen from 11 km](docs/images/cruise.jpg)](https://sf624.github.io/sky/?date=319&at=150,90)

<p>
<a href="https://sf624.github.io/sky/?date=319&time=16.75&yaw=60&pitch=-6&at=200,150"><img src="docs/images/sunset.jpg" width="49%" alt="Late afternoon: a low sun and its glare on the sea"></a>
<a href="https://sf624.github.io/sky/?date=319&time=10&alt=2.5&cloud=0.7&pitch=-3&at=150,90"><img src="docs/images/cloud-tops.jpg" width="49%" alt="At 2,500 m: the tops of the clouds just below"></a>
<a href="https://sf624.github.io/sky/?date=319&time=13&yaw=17&pitch=-25&cloud=0.25"><img src="docs/images/sea.jpg" width="49%" alt="The sea towards the sun: glitter on the waves, and the shadows of clouds"></a>
<a href="https://sf624.github.io/sky/?date=200&time=22&moon=10&yaw=34&pitch=10&cloud=0.3&cirrus=0"><img src="docs/images/night.jpg" width="49%" alt="Night: the moon, stars, and moonlight on the sea"></a>
</p>

Click a picture to open the page with that view.

## How to use it

Drag the view to look around, with the mouse or a finger. You can look up
or down by up to 89 degrees.

The page is in English or Japanese, following the browser's language
(Japanese if the browser prefers Japanese to English, English otherwise).
**Language / 言語** in the panel switches it, and the browser remembers the
choice.

The title and the hint about dragging fade out after a few seconds. The panel
and the full-screen button (top right) fade out when nothing moves for a few
seconds; moving the mouse, touching the screen, pressing a key or tabbing
into them brings them back. They stay while the pointer is on them. The
mouse cursor hides with them over the view, and comes back with them.

The panel at the bottom changes the time and the weather.

- **Play (▶)**: runs the time, at the speed chosen beside it. Press again to stop. Past midnight the date moves on to the next day, and the moon's age with it.
- **Now (clock)**: sets today's date and the present time, then plays in real time, so the sky stays on the present. The clock of your device is taken as the page's time, which is local solar time.
- **Speed of time**: real time, 1 min/s, 10 min/s, 16 min/s (a day in a minute and a half; the first choice) or 1 h/s. In real time the sky is drawn again every 10 seconds and rests in between.
- **Time**: 0:00 to 24:00. The sun is due south at 12:00. The place is at 35 degrees north.
- **Date**: 1 January to 31 December. It starts at today. Moving the date also sets the moon's age for that day.
- **Moon**: the age of the moon, 0 to 29.5 days.
- **Haze**: the amount of dust and small droplets in the air, 0 to 6 (1 at first: a clear day of fair weather; 0.3 is very clean air, 3 and more a hazy day). With more, the horizon and the sky around the sun turn white, and distant clouds and sea fade into the haze.
- **Wind at sea**: 1 to 15 m/s. Stronger wind makes the sun's glare on the sea wider and fainter, and raises whitecaps.
- **Altitude**: 300 m to 13,000 m (11,000 m at first).
- **Speed**: 0 to 3,000 km/h (900 km/h at first). The clouds and the sea pass below. At 0 the aircraft stands still.
- **Clouds**: the amount of low cloud, from none to overcast.
- **Thin clouds**: the amount of high, thin cloud (cirrus).
- **Sound**: background sound, made in the browser. **Off** (at first); **Airliner**: the cabin at cruise, with the rush of air on the fuselage, the engines' low drone and the air conditioning; **Near engines**: the same cabin with more of the engines' high tones (the fan's and the compressor's whine), as in a seat near the engines; **Wind**: no engine, only the air, in gusts. The air follows the speed and the altitude; the engines keep a steady cruise. Browsers allow sound only after a click or a key press, so a sound chosen on an earlier visit starts at the first click on the page. The browser remembers the choice.
- **Volume**: 0 to 100 % (50 % at first). The browser remembers it.
- **Resolution**: the most pixels the view may draw: Full HD, WQHD (the default) or 4K. The browser remembers the choice. The page never draws finer than the screen's own pixels.

A view can also be given in the address, for example
`?time=16.75&yaw=60&pitch=-6`.
All the parameters are listed in [docs/development.md](docs/development.md).

## How the picture is made

- Sky: for each of 12 wavelengths, the light that air molecules and dust scatter is added up along the line of sight. The absorption of ozone and light scattered many times are included.
- Clouds: their shapes come from 3D noise. The ray steps through the clouds; how a cloud is lit is found by stepping through it towards the sun.
- Sea: from the spread of the waves' slopes, the page works out the sun's glitter, the mirrored sky, the blue light that comes back out of the water, and whitecaps.
- Thin cloud: soft, translucent bodies of ice with fibres in them, smooth in parts and finely fibrous in others: ice crystals that fall from ragged heads into long curved tails (mares' tails), broad soft plumes, long calm streets and fibrous sheets, gathered in a few broad bands and groups whose way turns from region to region, with blue or a thin veil between; from a few tails to a milky veil, with fine filaments that curve along the tails. A 22-degree halo can appear in the veil: faint round the sun; by moonlight the veil is even and the ring clear.
- Night: the moon is a sphere lit by the sun, so its phases come out by themselves. The positions, brightness and colours of the stars come from Wikidata (CC0). The night is shown as the eye sees it: dark under a half moon, brighter under a full moon, and in the grey of night vision, with colours fading as the light fails. A full moon's sky is a dark blue. The stars are those the eye would see against that sky: thousands on a moonless night, fewer under the moon; the Milky Way is a plain grey band on a moonless night and fades as the moon brightens. The moon's path on the sea is made of separate sparkles near the sea, which get smaller and denser with distance and merge into a bright streak at the horizon.
- One picture is the mean of many pictures, each drawn slightly shifted. At rest it turns smooth within a few dozen frames, and then drawing stops. While the view moves, the last picture is shifted with the movement and laid under the new one.

## What it needs

- A browser with WebGL2. Without it, the page shows only a gradient of sky colours.
- While the page prepares the picture (compiling its shaders can take a few seconds the first time), it shows a dark sky with a line of progress. The browser stays responsive meanwhile.
- A fast GPU. The page is heavy on the GPU. Time to draw one frame, measured on an RTX 3090 (the first view, flying):
  - 1920×1080: about 5.5 ms
  - 2560×1440: about 9.3 ms
  - 3840×2160 (resolution 4K): about 19 ms

  While the aircraft flies, every frame is drawn. Laptops and phones will be slower.
  When frames are slow, the page draws fewer pixels while the view moves.
  Setting the speed to 0, or the resolution to Full HD, makes it lighter.

The page is a single HTML file. It loads nothing else: the sound is made in
the browser too.

## Licence

MIT licence ([LICENSE](LICENSE)).
A few small pieces of code and data by others are under their own terms (MIT, BSD and others); [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists them, with the star data from Wikidata (CC0).

## For developers

How the page works and how to work on it is in [docs/](docs/).

- [docs/design.md](docs/design.md): how a frame is made
- [docs/development.md](docs/development.md): running the page, judging a change, the rules
