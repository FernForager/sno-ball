# Event fixtures

All files here are SYNTHETIC: written by hand in the shape of
`public/data/events/*.json` (Plan v2 section 6, `EventRecord`) to exercise
`src/lib/events.ts` without depending on the real timelines, which change as
they are fact-checked. The facts in them are deliberately simplified; do not
quote them.

- `deep-small.json`: a three-event deep-time file (ice sheet with the
  `vashon-ice` rule, a Columbia River Basalt event with `crbg`, a statewide
  "subduction" event that is continuing).
- `human-small.json`: a four-event human file (a Seattle fire, statehood,
  a Seattle annexation event with `annexed-in-range`, a county-scoped event
  with no anchor point), plus one malformed record that the loader must skip.
- `human-bare-array.json`: the same shape as a bare array, without the file
  header, which the loader also accepts.
