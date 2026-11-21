# Third-party notices

The page includes the following code and data by others (BSD-3-Clause, CC0-1.0, MIT, the Unlicense, and a CIE data set that asks for a citation). Their license texts, and the attributions and citations they ask for, are reproduced below. The rest of the project is under the MIT license in [LICENSE](LICENSE).

## Code

| Component | Version | License | Included as |
| --- | --- | --- | --- |
| [Hash without Sine](https://www.shadertoy.com/view/4djSRW), by David Hoskins | 2014 | MIT | `hash` (hash12) in the `fs`, `mean`, `show` and `enlarge` shaders and `hash3` (hash13) in the `fs` shader of `index.html` |
| [Tex2DCatmullRom.hlsl](https://gist.github.com/TheRealMJP/c83b8c0f46b63f3a88a5986f4fa982b1), by MJP | gist of 2016 | MIT | the weights and the nine bilinear reads of the Catmull-Rom filter in the `mean` shader of `index.html`, in GLSL |
| [hash-prospector](https://github.com/skeeto/hash-prospector), by Chris Wellons: `lowbias32` | master branch, read 2026-11-16 | Unlicense | `ihash` in the `noise`, `waves` and `fs` shaders of `index.html` |
| [Mulberry32](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c), by Tommy Ettinger: `mulberry32.c` | 2017, read 2026-11-21 | CC0-1.0 | `rngOf` in the script `towers` of `index.html` (the worker of `?grid=1`), in JavaScript |
| [FidelityFX Super Resolution 1](https://github.com/GPUOpen-Effects/FidelityFX-FSR), by AMD: `ffx_fsr1.h` (EASU and RCAS) | 1.0 (v1.20210629, read 2026-11-21) | MIT | the edge-adaptive enlargement and the contrast-adaptive sharpening of the `enlarge` shader of `index.html` (the kernel, the measure of an edge, the limits of the sharpening), in GLSL |

## Data

| Component | Version | License | Included as |
| --- | --- | --- | --- |
| [Precomputed Atmospheric Scattering](https://github.com/ebruneton/precomputed_atmospheric_scattering), by Eric Bruneton: `atmosphere/demo/demo.cc` | 2017 (checked at commit 34f14e7) | BSD-3-Clause | the tables `SOLAR` and `OZONE` in `index.html`, 12 values each, resampled from `kSolarIrradiance` and `kOzoneCrossSection`; the parameters of the air taken from the same demo (Rayleigh scattering 13.558e-3 per km at 550 nm, `BETA_M`, `MIE_EXT`, the ozone density 5.374e21, the scale heights `HR` and `HM`, the ozone layer from 10 to 40 km, the Mie phase factor 0.8) |
| [CIE 1931 colour-matching functions, 2 degree observer](https://doi.org/10.25039/CIE.DS.xvudnb9b) | CIE 2019 data set | citation asked | the table `CMF` in `index.html`, 12 wavelengths |
| [Wikidata](https://www.wikidata.org/) | retrieved 2026-11-15 | CC0-1.0 | the star catalogue embedded in `index.html` (the block with the id `stars`), built by `tools/make-stars.py` |

## License texts

### Hash without Sine

```text
Copyright (c)2014 David Hoskins.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Tex2DCatmullRom.hlsl

The gist says that its code is under the MIT license of
https://gist.github.com/TheRealMJP/bc503b0b87b643d3505d41eab8b332ae, which
reads:

```text
MIT License

Copyright (c) 2019 MJP

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### hash-prospector

The repository is dedicated to the public domain by its UNLICENSE file. Its
first sentence is given here with its address, not the whole text. No
credit is required.

```text
This is free and unencumbered software released into the public domain.
https://github.com/skeeto/hash-prospector/blob/master/UNLICENSE
https://unlicense.org/
```

### FidelityFX Super Resolution 1

```text
Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Mulberry32

The gist's file dedicates it to the public domain under CC0 1.0 (its
header, without the author's mail address). No credit is required.

```text
Written in 2017 by Tommy Ettinger

To the extent possible under law, the author has dedicated all copyright
and related and neighboring rights to this software to the public domain
worldwide. This software is distributed without any warranty.

See <http://creativecommons.org/publicdomain/zero/1.0/>.
```

### Precomputed Atmospheric Scattering

```text
Copyright (c) 2017 Eric Bruneton
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holders nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
THE POSSIBILITY OF SUCH DAMAGE.
```

The demo names the sources of its tables. The solar irradiance is the
extraterrestrial (ETR) column of "Reference Solar Spectral Irradiance: ASTM
G-173", averaged over 10 nm. The ozone cross-sections are those measured at
233 K by the University of Bremen (A. Serdyuchenko, V. Gorshelev, M. Weber,
W. Chehade and J. P. Burrows, Atmospheric Measurement Techniques 7, 609 and
625, 2014), averaged over 10 nm.

### CIE 1931 colour-matching functions

The CIE asks for this citation:

```text
CIE 2019, Colour-matching functions of CIE 1931 standard colorimetric observer,
International Commission on Illumination (CIE), Vienna, AT,
DOI: 10.25039/CIE.DS.xvudnb9b
```

### Wikidata

The structured data of Wikidata are dedicated to the public domain under CC0
1.0. The statement of dedication is given here with its address, not the
whole legal code. No credit is required.

```text
All structured data from the main, Property, Lexeme, and EntitySchema
namespaces is available under the Creative Commons CC0 License; text in the
other namespaces is available under the Creative Commons Attribution-ShareAlike
License; additional terms may apply.
https://www.wikidata.org/wiki/Wikidata:Copyright
https://creativecommons.org/publicdomain/zero/1.0/
```
