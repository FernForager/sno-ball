# Snowball (repo: sno-ball)

A static place-history website for Washington State, deployed to GitHub Pages at /sno-ball/. Owner is a complete beginner: explain changes in plain English, keep one build command, never add paid services or secret keys.

- Stack: Vite + TypeScript (no framework), MapLibre GL JS + @openhistoricalmap/maplibre-gl-dates, Vitest, Playwright. Node 22.
- `npm run check` runs everything CI runs. Keep it green before pushing.
- Time handling lives in `src/lib/time.ts`: `{kind:'year'}` (no year 0, negative = BCE) or `{kind:'ago'}` (years before 2000 CE, used from 20,000 years back). Convert at the edges, never elsewhere.
- Data policy: pre-bake Washington data at build time into `public/data/` where possible; runtime calls only for geocoding, parcel lookup, photos. Respect Nominatim's policy: one request per second, no autocomplete, cache results.
- Every displayed fact carries a source name and URL. Prose from Wikipedia is CC BY-SA: show it as a quoted excerpt with attribution, never rewrite it as our own.
- Plans and research: `docs/PLAN-v1.md` (original worldwide plan), `docs/API-REPORT.md` (live verification). Plan v2 (Washington edition) supersedes v1 where they differ.
