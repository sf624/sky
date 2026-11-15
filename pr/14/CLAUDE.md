# Notes for AI agents

Read these before you touch this repository.

## The goal

- The page should draw a sky that looks real: a picture that could be a
  photograph from an aircraft window. Any means is fine. Physical
  simulation is a means, not a requirement: where it does not help the
  picture, it may be replaced or removed.
- Judge a change by looking at it, against real photographs.

## Rules

- `index.html` holds one line of 71 kB: the `<script id="stars">` block.
  Never print it. Read around it with offset and limit, and cut grep
  output (`grep … | cut -c1-200`).
- The skylight (`#sky2`) must stay pixel-identical unless the owner says
  otherwise. Code in `fs` outside `#if AIRCRAFT` is shared with it.
- Use only MIT-compatible material. Never copy code from Shadertoy, GPL
  projects or sources without a licence; write it from published ideas.
  The star data comes from Wikidata (CC0); `NOTICE` names the source.
- Every change goes through a pull request. Each pull request from a
  branch of this repository gets a preview at
  `https://sf624.github.io/sky/pr/N/`.
- Plans, follow-ups and known flaws go to the issues
  (https://github.com/sf624/sky/issues), not into the repository.
- `docs/` describes the code as it is. Update it in the same pull request
  when a change alters what it says.

## Where things are

- `README.md`: for users, in English. `README.ja.md`: its Japanese
  version. Keep both in step.
- `docs/design.md`: how a frame is made.
- `docs/development.md`: running, URL parameters, judging a change, GLSL
  rules, GPU time, publishing, licences.
