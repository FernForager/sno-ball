# Resume notes (for Claude, and for the owner's curiosity)

Last updated 2026-10-07 ~22:00 UTC. Paused because the owner's weekly usage ran out; resets Thursday 2026-10-08 ~18:00 Pacific.

## Where things stand
- Repo `FernForager/sno-ball`, work branch `claude/ultra-code-wmnysa`. No `main` yet (repo was empty); the first merge creates it and needs the owner's OK.
- Scaffold is pushed and verified locally: Vite + TypeScript, `src/lib/time.ts` (43 unit tests), Playwright smoke test (desktop + phone), CI workflow on every push, Pages deploy workflow on `main`.
- Scope (owner's decision): Washington State only, emphasis Seattle, whole state included. Repo name stays `sno-ball`. Site name leaning "Snowball"; "Histo-Globe" also liked. Custom domain: later.
- Owner is a complete beginner working from a phone. Explain in plain English, one step at a time. Owner must do by hand: the GitHub Pages switch (Settings -> Pages -> Source: GitHub Actions) and, later, the merge button.

## Research already done (all in this folder)
- `PLAN-v1.md`: original worldwide plan. Stack, UX concept (story-first), time-scale design, caching rules and deploy workflow still apply.
- `API-REPORT.md`: live browser-style checks of every global data service (all reachable, CORS confirmed).
- `WA-PROBES.md`: live probes of Washington sources. Headlines: Seattle parcels expose year built client-side (PARCEL_GEO `YR_BUILT_MAX`); King County assessor bulk extracts (build-time) cover ~530k homes; Seattle neighborhoods (94), annexation years (45), landmarks (517); WA DNR geology statewide (layer 11 + table 13 join); OHM Overpass has Seattle coverage; USGS Historical Topographic Maps ImageServer gives real 1894-1990s map sheets statewide; LOC Sanborn maps and photos; Wikidata has all 39 counties with founding dates but few town founding dates; Census API needs a key and has nothing pre-2000.
- `research/plan-v1-*.{md,json}`: the verified source table, UX concepts and judgements, and the critic's gaps from the first plan.
- `research/wa-plan-v2-partial-results.json`: completed Washington research agents (`research-parcels`, `research-seattle`) from the paused plan-v2 workflow. Reuse these as inputs instead of re-running them.

## What remains for Plan v2 (Washington edition)
The paused workflow's script lives in this session's container and may be gone if the container was recycled. Rebuild it from this description if needed:
1. Research (not yet done): `statewide` (counties, cities, DNR geology fields, OHM coverage, USGS topos, LOC Sanborn, HistoryLink link table), `deeptime-wa` (structured geologic timeline of WA with ages, regions, sources), `people-wa` (structured human-history timeline of WA with dates, regions, sources; respectful Indigenous history). Agents should read `WA-PROBES.md` first.
2. Verify: one access-skeptic per top-2 data source; one fact-checker per timeline.
3. Synthesize: "Plan v2: Washington edition" = Part 1 plain English (what changes vs v1, what the visitor sees for a Seattle address vs a small eastern-WA town, $0, owner's two manual steps, build order whose first milestone is small and visible) + Part 2 technical appendix (pre-baked vs runtime data with exact endpoints from WA-PROBES, dataset schemas and sizes, ring resolution, ~25 WA-specific named time stops, map strategy incl. USGS topo sheet nearest the selected date, event data model, repo layout, tests, phases, risks) + the two corrected timelines as JSON ready for `public/data/`.
4. Present Part 1 to the owner; then build Phase 1 (type any WA address -> rings with names, county founding, rock under you, ice-age fact, present-day map), push, CI green, then publish (create `main` with owner's OK, owner flips Pages switch).

## Environment notes
- This session's environment ("Morg") blocks outbound data hosts. The owner's other environment "Histo-Globe" (env_01Lvk1R44GwemxZypPNVXLm9) has Full network access. Pattern that worked: `create_session` in Histo-Globe with a self-contained prompt that ends by calling `send_message` back to the parent session with the report. Two such helper sessions ran and are archived.
- Container tooling: Node 22, Playwright 1.56.1 with Chromium preinstalled at /opt/pw-browsers/chromium (config already handles it). npm registry reachable.
- Owner usage: near/over the weekly limit this week. Prefer light fan-out; ask before big workflows.
