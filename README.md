# Snowball

Type a Washington address and read the history of that exact spot: the house, the street, the neighborhood, the city, the county, the state, and finally the rock under the floor and where it has travelled across the planet. A time control re-tells the story for any date, from last year back to the birth of the Earth.

This is a static website. There is no server and no account to run; the pages are built from this folder and published for free by GitHub Pages at https://fernforager.github.io/sno-ball/ (once Pages is switched on).

## What's in this folder

| Path | What it is |
|---|---|
| `index.html`, `src/` | The website: one page, plain TypeScript, no framework |
| `src/lib/time.ts` | The time engine: one way to represent any date from 1889 to 4.5 billion years ago |
| `tests/unit/` | Fast tests of the logic (run with `npm test`) |
| `tests/e2e/` | A real-browser smoke test of the built site (run with `npm run test:e2e`) |
| `.github/workflows/` | Automation: CI checks every push; the deploy workflow publishes `main` to GitHub Pages |
| `docs/` | The project plan and research notes, written in plain English first |

## Running it yourself

You need Node.js 22 or newer.

```sh
npm install        # once
npm run dev        # local preview with live reload
npm run check      # everything CI runs: typecheck, tests, build, browser test
```

## How publishing works

1. Changes land on the `main` branch (through a pull request).
2. GitHub Actions builds the site and publishes it to GitHub Pages.
3. The live site updates within a couple of minutes.

The one-time setup, done by the repository owner: **Settings → Pages → Build and deployment → Source → GitHub Actions**.

## Data and credits

Every fact on the site names its source. The data comes from free public services and open datasets: OpenStreetMap, Wikipedia, Wikidata and Wikimedia Commons, OpenHistoricalMap, OpenFreeMap, Macrostrat, the GPlates Web Service, the Paleobiology Database, King County GIS, the City of Seattle, and the Washington Department of Natural Resources. See `docs/` for the full list and licenses.
