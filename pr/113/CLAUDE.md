# Notes for AI agents

Read these before you touch this repository.

## The goal

- The page should draw a sky that looks real: a picture that could be a
  photograph from an aircraft window. Any means is fine. Physical
  simulation is a means, not a requirement: where it does not help the
  picture, it may be replaced or removed.
- Judge a change by looking at it, against real photographs.
- The picture comes before the processing load. Keep the page usable on a
  desktop GPU, but do not trade detail for milliseconds.

## Changes of the picture

A pull request that changes what is drawn (sky, light, clouds, thin
clouds, sea, exposure) is checked against real photographs before it is
shown to the owner. Before and after pictures alone are not enough.

- Cover the representative scenes: low, middle and high altitude (about
  0.3 km, 3 to 5 km, 11 km) and above the cruise (20 and 40 km), by day, at dusk and at night, with low clouds
  and with thin clouds (few and many), looking towards the sun, away from
  it, up and down. A change of one part still gets the whole matrix once:
  exposure and light reach every scene.
- For each scene, put a photograph of the same kind (same height, sun
  height and framing, as near as can be found) beside the render, and
  write down what still looks wrong: shape, outline, scale of detail,
  colour, saturation, brightness, gradients. Then judge whether the pair
  feels alike. Say plainly when it does not; do not report "better than
  before" as "real".
- Look in flight too, not only at stills, and at each altitude.
- Measure the start on Direct3D 11 (`node tools/sky.mjs d3d`, see
  `tools/README.md`) before the change is shown: a shader that starts in
  seconds here can take minutes in Chrome on Windows, or never start.
- Photographs are for comparison only (for example from Wikimedia Commons,
  with their source noted). They never go into the repository.
- Put the photo-against-render sheets and the list of differences in the
  pull request's description, and show them to the owner.
- Run `node tools/sky.mjs look` before pushing any change of `index.html`
  (`check` runs it first), and put its lines in the pull request's
  description. Add the contact sheet of its views, before | after
  (`look --sheet --base origin/main`), described in words. A flaw the owner
  reports gets an entry in `tools/look.json` in the pull request that
  fixes it, with a measure shown to fail before the fix and pass after
  (see "Judging a change" in `docs/development.md`).

See "Realism" in `docs/development.md`.

## Rules

- `index.html` holds one line of 71 kB: the `<script id="stars">` block.
  Never print it. Read around it with offset and limit, and cut grep
  output (`grep … | cut -c1-200`).
- Use only MIT-compatible material. Never copy code from Shadertoy, GPL
  projects or sources without a licence; write it from published ideas.
  Code and data by others (the star data from Wikidata, CC0, among them)
  are listed in `THIRD_PARTY_NOTICES.md`; see "Licences" in
  `docs/development.md` for adding one.
- Every change goes through a pull request. Each pull request from a
  branch of this repository gets a preview at
  `https://sf624.github.io/sky/pr/N/`.
- Plans, follow-ups and known flaws go to the issues
  (https://github.com/sf624/sky/issues), not into the repository. Their
  order is on the project board; read `docs/roadmap.md` before starting
  work, and keep the board current.
- `docs/` describes the code as it is. Update it in the same pull request
  when a change alters what it says.

## Where things are

- `README.md`: for users, in English. `README.ja.md`: its Japanese
  version. Keep both in step.
- `docs/design.md`: how a frame is made.
- `docs/development.md`: running, URL parameters, judging a change, GLSL
  rules, GPU time, publishing, licences.
- `docs/roadmap.md`: where the planned work and its order are kept.
