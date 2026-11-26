# Roll bake prototype

A standalone test (issue #144, step 1), not part of the page: it bakes a Swift-Hohenberg roll field on the GPU in
WebGL2 and measures the time on this machine's GL and on ANGLE Direct3D 11.

Units where q0 = 1, a texel h = 2π/8 (8 texels per wavelength), periodic:

    ∂u/∂t = ε u − (1+∇²)² u + a ∇·(ŵ ŵᵀ ∇u) + g u² − u³

Real space, the 9-point Laplacian, RKL1 super-time-stepping (Meyer, Balsara and Aslam 2012) with s stages per
super-step of 0.9 · dt_Euler · (s² + s) / 2. dt_Euler is 2 over the largest magnitude of the linear operator's symbol,
taken over every wavevector and wind direction (with the anisotropic term). Each stage is two passes into float
targets that take turns: the Laplacian, then the right-hand side and the RKL combination. Reads are `texelFetch` at
whole texels, wrapped by hand (`& (n − 1)`), so the targets need no filtering.

- `index.html`: the bake. Alone it takes one job from the URL (`?n=1024&s=40&T=150&a=0.5&perFrame=40&fmt=r32f`, also
  `epsNoise`, `turn2`, `kick`) and shows the height profile.
- `run.mjs`: runs a list of jobs in headless Chrome, on GL (`gl`) or on Windows Chrome with Direct3D 11 (`d3d`), and
  writes the timings and the fields the page reads back. Run it through the heavy-run queue (see the file's head).
- `cpu.mjs`: the same bake in plain JavaScript on one thread, for the cost of a worker fallback.
- `analyse.py`: the statistics of the CPU prototype (`sh.py`, not in this repository) on the fields, and the sheets.
