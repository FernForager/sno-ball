# Resume notes (for Claude, and for the owner's curiosity)

Last updated 2026-10-14 ~06:30 UTC. Paused at the owner's request until their usage allowance refills.

## Where things stand
- Repo `FernForager/sno-ball`. Default branch `main`. Work branch `claude/ultra-code-wmnysa` (all development, commits and pushes go here; never push elsewhere without the owner's OK).
- Site is live at https://fernforager.github.io/sno-ball/ with milestone 1 (PR #1, merged): type any Washington address, get the rings (house, block, street, neighborhood, city, county, region, state), county founding, the rock under you, the ice-age picture, Wikipedia excerpts with attribution, Seattle extras (annexation, landmarks, year built) and a present-day map.
- Milestone 2, the time dial, is finished and sits in PR #2 (https://github.com/FernForager/sno-ball/pull/2), head 75ff63d, CI green, no conflicts, waiting on the owner's Merge tap. It adds 276 stops, 27 named Washington chapters, 151 dated events placed on the right ring, "Not yet" lines with jump links, USGS historical map sheets, OpenHistoricalMap old streets, the ice-age map and the globe for deep time, and share links with `&at=`.
- Checks: `npm run check` (typecheck, 612 unit tests, build, 20 browser tests) passes locally and on CI. `LIVE=1` browser tests hit the real services and were run three times from the full-network environment.

## After the owner merges PR #2
1. The Pages deploy from `main` will likely fail in the "deploy" job: the `github-pages` environment's deployment-branch rule still only allows `claude/ultra-code-wmnysa`. Fix for the owner (one time): GitHub repo → Settings → Environments → github-pages → Deployment branches → add `main`.
2. Until then, publish by dispatching `deploy.yml` on `claude/ultra-code-wmnysa` (its content equals merged `main`). Confirm the live page serves a new bundle (the `index-*.js` hash changes).
3. Do not edit `.github/workflows/deploy.yml` from a session; that edit was refused as a production change and publishing is the owner's call.

## Next milestone (only when the owner asks)
Plan v2 milestone 3: year built for every King County house from the assessor bulk extracts (build-time, pre-baked), plat names, statewide parcel lookup, populations by decade on the city and county rings. Then photos and HistoryLink links. See `docs/PLAN-v2.md` Part 1 for the build order and Part 2 for endpoints and schemas.

Known follow-ups already noted in the PRs: misspelled landmark names resolve as non-precise; OpenHistoricalMap is sparse outside downtown Seattle; the King County 1936 aerial and ice-margin overlays are later milestones.

## Research and data (all in this repo)
- `PLAN-v1.md` (original worldwide plan), `PLAN-v2.md` (Washington edition, supersedes v1 where they differ), `API-REPORT.md` and `WA-PROBES.md` (live checks of every data service), `research/` (source tables, critiques, timeline JSON, helper findings).
- `public/data/`: 39 counties, 288 places, 418 pre-baked Wikipedia excerpts, 36 deep-time and 115 human-history events. Every fact carries a source name and URL.

## Environment notes
- This session's environment ("Morg") blocks outbound data hosts (only npm and GitHub reachable). The owner's "Histo-Globe" environment (env_01Lvk1R44GwemxZypPNVXLm9) has full network access. Pattern that works: `create_session` there with a self-contained prompt that ends by sending its report back with `send_message`; helpers push only to `helper/*` branches. Eight helpers have run; all are archived. Their `helper/*` branches on GitHub hold screenshots and notes already folded into the work branch and can be deleted whenever the owner likes.
- Container tooling: Node 22, Playwright 1.56.1 with Chromium preinstalled at /opt/pw-browsers/chromium (config already handles it).
- Owner is a complete beginner working from a phone. Explain in plain English, one step at a time, keep one build command, never add paid services or secret keys.
- Owner usage: tight. Prefer light fan-out; ask before big workflows; pause when asked.
