# Bundled timelines (pre-baked events)

Two files, one shape, read by `src/lib/events.ts` (`loadEvents()`):

| File | Kind | Events | Built from |
|---|---|---|---|
| `deep-time.json` | `deep` | 36 | `docs/research/timelines/wa-deeptime-events.json` (as of 2026-10-07) |
| `human-history.json` | `human` | 115 | `docs/research/timelines/wa-history-events.json` (as of 2026-10-07) |

Those research files are the fact-checked appendices of Plan v2
(`docs/PLAN-v2.md`, section 6 "Event data model"). The files here are the
same events in the exact `EventRecord` shape the site loads, with every
field checked. No network is involved in building them.

## Shape

Each file is `{ v, kind, built_from, source_as_of, convention, count, events }`
(the human file also carries `standing_line`, the sentence about the tribes
having been here since time immemorial). Each record:

| Field | Meaning |
|---|---|
| `id` | slug (`a-z`, `0-9`, `-`), unique across both files |
| `kind` | `deep` or `human`: which file it came from, so the code can decide rings without looking |
| `title`, `when` | display text; `when` is human readable ("November 11, 1889") |
| `start_years_ago`, `end_years_ago` | years before 2000 CE (the `time.ts` convention). Negative = after 2000 (`-9` is 2009; `-50000000` is 50 million years in the future). `end` equals `start` for a moment. `end` of `0` means **continuing** (still true today). |
| `region` | scope tokens: `"statewide"`, a WaRegion name exactly as in `src/data/wa-regions.ts`, `"<Name> County"`, or a city name as in `wa-places.json` |
| `lat`, `lon` | anchor point for `{distance}`; both `null` when there is no single place |
| `summary` | the facts, in the project's own words |
| `at_your_spot` | sentence template about the visitor's spot, or `null`. Placeholders: `{place}` `{distance}` `{county}` `{city}` `{inc_year}` `{annex_year}` `{ice_thickness}` `{basalt_unit}` `{nearest_volcano}` `{flood_depth}` |
| `spot_rule` | optional gate on `at_your_spot` (what the ground must say): `flood-deposits`, `vashon-ice`, `osceola-lahar`, `electron-lahar`, `crbg`, `seattle-fault-near`, `annexed-in-range`, `incorporated-in-range` |
| `sources` | `[{ title, url }]`, at least one, all `http(s)` |
| `confidence` | `high`, `medium` or `low` |

One consequence of the `0 = continuing` convention: an event that ended in
the year 2000 itself cannot end at `0`. `kingdome` (1976 to March 26, 2000)
therefore ends at `-0.23` (0.23 years after January 1, 2000); everything
with `end_years_ago: 0` really is ongoing.

## Licensing

- `summary` and `at_your_spot` are the project's own words, written by the
  research agents from the linked sources and then fact-checked. Nothing is
  copied from Wikipedia (CC BY-SA), HistoryLink or any other site, so these
  files carry no outside licence; the site may show the text as its own.
- Every event links its sources (`sources[].title`, `sources[].url`), and
  the page shows them next to the event, as the project rule requires.
  HistoryLink pages appear as links only.
- Scope tokens were checked against `wa-counties.json` and `wa-places.json`
  (both from Wikidata, CC0).

## The conversion

The conversion script is small and kept out of the repo (it ran from a
scratch directory). It is reproduced in full below so a rebuild is one copy
and paste away: save it as `build-events.mjs` anywhere and run
`node build-events.mjs /path/to/sno-ball`. It needs nothing but Node.

What it does, in order, for each source file:

1. Slugs the `id` (lower case, runs of other characters become `-`) and
   refuses duplicates, within a file and across both.
2. Turns `region` into an array of canonical tokens: `statewide`;
   a WaRegion name (matched ignoring case); `"<Name> County"` for any of the
   39 counties in `wa-counties.json`; or a city name from `wa-places.json`.
   Any string it cannot map is reported as a problem (none were: all 50
   distinct tokens in the two files mapped).
3. Fills a missing `end_years_ago` with `start_years_ago` (none were
   missing) and flags an end older than its start (none, allowing `0`).
4. Keeps `lat`/`lon` only when both are numbers, otherwise `null`
   (14 human events and no deep-time events have no anchor point).
5. Keeps `at_your_spot` as `null` when empty.
6. Applies the Plan v2 spot rules by id when the source has none:
   `missoula-floods` → `flood-deposits`, `vashon-ice-sheet` → `vashon-ice`,
   `osceola-mudflow` → `osceola-lahar`, `electron-mudflow` →
   `electron-lahar`, `columbia-river-basalt` → `crbg`, `seattle-fault-923`
   → `seattle-fault-near` (the sources already carried these six, plus
   `annexed-in-range` on `seattle-annexations-1907` and
   `incorporated-in-range` on `suburban-incorporations`).
7. Checks that every source has a title and an `http(s)` url and that
   `confidence` is one of the three values.
8. Adds `kind`, writes the two files with 2-space indentation, and prints
   the counts, the token list and any problems. The output is
   deterministic: the same inputs give byte-identical files.

```js
// Convert docs/research/timelines/*.json into public/data/events/*.json
// (the EventRecord shape of Plan v2 section 6, plus a `kind` field).
// Usage: node build-events.mjs /path/to/repo
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2] ?? '.';
const read = (p) => JSON.parse(readFileSync(join(repo, p), 'utf8'));

const WA_REGIONS = ['Olympic Peninsula', 'Puget Sound', 'Southwest Washington', 'North Cascades', 'South Cascades',
  'Yakima Valley', 'Columbia Basin', 'Okanogan', 'Northeast Washington', 'Palouse and Blue Mountains'];
const COUNTIES = read('public/data/wa-counties.json').map((c) => c.name.replace(/ County$/, ''));
const CITIES = read('public/data/wa-places.json').map((p) => p.name);
const SPOT_RULES = ['flood-deposits', 'vashon-ice', 'osceola-lahar', 'electron-lahar', 'crbg', 'seattle-fault-near',
  'annexed-in-range', 'incorporated-in-range'];
// Deep-time events that gate their second-person line on the DNR unit (Plan v2 section 6).
const RULE_BY_ID = { 'missoula-floods': 'flood-deposits', 'vashon-ice-sheet': 'vashon-ice', 'osceola-mudflow': 'osceola-lahar',
  'electron-mudflow': 'electron-lahar', 'columbia-river-basalt': 'crbg', 'seattle-fault-923': 'seattle-fault-near' };

const lower = (s) => s.trim().toLowerCase();
const slug = (s) => lower(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const problems = [];

/** A raw region string -> canonical scope token, or null when unknown. */
function regionToken(raw) {
  const s = raw.trim();
  if (lower(s) === 'statewide' || lower(s) === 'washington') return 'statewide';
  const region = WA_REGIONS.find((r) => lower(r) === lower(s));
  if (region) return region;
  const m = /^(.*?)\s+county$/i.exec(s);
  if (m) {
    const county = COUNTIES.find((c) => lower(c) === lower(m[1]));
    return county ? `${county} County` : null;
  }
  const city = CITIES.find((c) => lower(c) === lower(s));
  return city ?? null;
}

function convert(file, kind) {
  const src = read(file);
  const seen = new Set();
  const events = src.events.map((e) => {
    const id = slug(e.id ?? e.title);
    if (seen.has(id)) problems.push(`${file}: duplicate id ${id}`);
    seen.add(id);
    const regions = [];
    for (const raw of Array.isArray(e.region) ? e.region : [e.region]) {
      const token = regionToken(String(raw));
      if (token === null) problems.push(`${file}: ${id}: unmapped region "${raw}"`);
      else if (!regions.includes(token)) regions.push(token);
    }
    const start = Number(e.start_years_ago);
    const end = e.end_years_ago === undefined || e.end_years_ago === null ? start : Number(e.end_years_ago);
    if (!Number.isFinite(start) || !Number.isFinite(end)) problems.push(`${file}: ${id}: bad years`);
    if (end > start && end !== 0) problems.push(`${file}: ${id}: end ${end} is older than start ${start}`);
    const sources = (e.sources ?? []).map((s) => ({ title: String(s.title ?? s.name ?? '').trim(), url: String(s.url ?? '').trim() }));
    for (const s of sources) if (!/^https?:\/\//.test(s.url)) problems.push(`${file}: ${id}: bad source url "${s.url}"`);
    if (sources.length === 0) problems.push(`${file}: ${id}: no sources`);
    const confidence = ['high', 'medium', 'low'].includes(e.confidence) ? e.confidence : (problems.push(`${file}: ${id}: confidence "${e.confidence}"`), 'low');
    const spotRule = e.spot_rule ?? RULE_BY_ID[id];
    if (spotRule !== undefined && !SPOT_RULES.includes(spotRule)) problems.push(`${file}: ${id}: unknown spot_rule ${spotRule}`);
    const out = {
      id, kind, title: String(e.title).trim(), when: String(e.when).trim(),
      start_years_ago: start, end_years_ago: end, region: regions,
      lat: typeof e.lat === 'number' ? e.lat : null, lon: typeof e.lon === 'number' ? e.lon : null,
      summary: String(e.summary).trim(), at_your_spot: typeof e.at_your_spot === 'string' && e.at_your_spot.trim() ? e.at_your_spot.trim() : null,
    };
    if (spotRule) out.spot_rule = spotRule;
    out.sources = sources;
    out.confidence = confidence;
    return out;
  });
  return { v: 1, kind, built_from: file, source_as_of: src.asOf, convention: 'start_years_ago and end_years_ago are years before 2000 CE; negative = after 2000; end_years_ago 0 = continuing',
    ...(src.standing_line ? { standing_line: src.standing_line } : {}), count: events.length, events };
}

const deep = convert('docs/research/timelines/wa-deeptime-events.json', 'deep');
const human = convert('docs/research/timelines/wa-history-events.json', 'human');
const allIds = [...deep.events, ...human.events].map((e) => e.id);
for (const id of allIds) if (allIds.indexOf(id) !== allIds.lastIndexOf(id)) problems.push(`id ${id} appears in both files`);
writeFileSync(join(repo, 'public/data/events/deep-time.json'), JSON.stringify(deep, null, 2) + '\n');
writeFileSync(join(repo, 'public/data/events/human-history.json'), JSON.stringify(human, null, 2) + '\n');
console.log(`deep-time.json: ${deep.count} events; human-history.json: ${human.count} events`);
const tokens = new Map();
for (const e of [...deep.events, ...human.events]) for (const t of e.region) tokens.set(t, (tokens.get(t) ?? 0) + 1);
console.log('scope tokens:', [...tokens.keys()].sort().join(', '));
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no problems');
```
