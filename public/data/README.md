# Pre-baked Washington reference data

Both files were built from the Wikidata Query Service (https://query.wikidata.org/sparql) on 2026-10-07. Wikidata content is released under CC0 1.0 (public domain dedication), so these files carry no attribution requirement, but the site should still name "Wikidata" as the source next to any fact drawn from them. Re-run the queries below to refresh; values such as population change over time.

Dates are ISO `YYYY-MM-DD` strings taken from Wikidata's dateTime values (a `-01-01` date usually means Wikidata only records the year). `null` means Wikidata has no value. Coordinates are WGS 84 decimal degrees.

## wa-counties.json

One object per county of Washington, sorted by `name` (39 entries). Keys: `qid`, `name`, `inception`, `seat`, `areaKm2`, `population`, `populationYear`, `lat`, `lon`, `wikipedia` (English Wikipedia article title), `fips` (5-digit county FIPS code), `namedAfter` (array of labels, possibly empty).

Coverage: all 39 counties have every field (qid, name, inception, seat, areaKm2, population, populationYear, lat, lon, wikipedia, fips); 34 of 39 have at least one `namedAfter` entry (the other five have an empty array).

Built from three queries (counties with P31 = Q13415369 "county of Washington"):

```sparql
SELECT ?c ?cLabel ?inception ?seatLabel ?area ?areaUnit ?fips ?coord ?article WHERE {
  ?c wdt:P31 wd:Q13415369 .
  OPTIONAL { ?c wdt:P571 ?inception }
  OPTIONAL { ?c wdt:P36 ?seat }
  OPTIONAL { ?c p:P2046 ?as . ?as ps:P2046 ?area . ?as psv:P2046 ?av . ?av wikibase:quantityUnit ?areaUnit }
  OPTIONAL { ?c wdt:P882 ?fips }
  OPTIONAL { ?c wdt:P625 ?coord }
  OPTIONAL { ?article schema:about ?c ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

```sparql
SELECT ?c ?pop ?time WHERE { ?c wdt:P31 wd:Q13415369 . ?c p:P1082 ?s . ?s ps:P1082 ?pop . OPTIONAL { ?s pq:P585 ?time } }
```

```sparql
SELECT ?c ?naLabel WHERE { ?c wdt:P31 wd:Q13415369 ; wdt:P138 ?na . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }
```

Every area statement was in square kilometres (unit Q712226), so `areaKm2` is the stated value unchanged. `population` and `populationYear` are the population statement with the latest point in time (P585); statements with no point in time lose to any dated one.

## wa-places.json

Cities and towns of Washington according to Wikidata, sorted by `name` (288 entries). Keys: `qid`, `name`, `county` (label of the P131 parent that is a county), `inception`, `population`, `populationYear`, `lat`, `lon`, `wikipedia`.

Coverage: 288 places (856 raw rows, 327 distinct items, minus the 39 counties, which Wikidata also classes under "municipality" and which were removed). name 288/288; county 284/288; inception 156/288; population and populationYear 281/288; lat and lon 287/288; wikipedia 285/288. A few entries are former towns later annexed into Seattle (Georgetown, Columbia City, Hillman City, Blue Ridge, Snowden) that Wikidata still classes as towns.

Selection: instance of (P31), or of a subclass of (P279*), one of Q515 city, Q3957 town, Q1093829 city in the United States, Q15284 municipality; located in (P131, transitively) Q1223 Washington. Rows were de-duplicated by `qid` (a place with several P131 values or classes appears once; the first county label found is kept). Note that this is Wikidata's classification, not the state's official list of 281 incorporated cities and towns, so expect a few extra or missing entries; `inception` is sparsely populated and should be treated as a hint, not a founding date.

```sparql
SELECT DISTINCT ?p ?pLabel ?clsLabel ?countyLabel ?inception ?coord ?article WHERE {
  VALUES ?cls { wd:Q515 wd:Q3957 wd:Q1093829 wd:Q15284 }
  ?p wdt:P31/wdt:P279* ?cls .
  ?p wdt:P131+ wd:Q1223 .
  OPTIONAL { ?p wdt:P131 ?county . ?county wdt:P31 wd:Q13415369 }
  OPTIONAL { ?p wdt:P571 ?inception }
  OPTIONAL { ?p wdt:P625 ?coord }
  OPTIONAL { ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

```sparql
SELECT ?p ?pop ?time WHERE {
  VALUES ?cls { wd:Q515 wd:Q3957 wd:Q1093829 wd:Q15284 }
  ?p wdt:P31/wdt:P279* ?cls . ?p wdt:P131+ wd:Q1223 .
  ?p p:P1082 ?s . ?s ps:P1082 ?pop . OPTIONAL { ?s pq:P585 ?time } }
```

Queries were sent with the user agent `sno-ball-dev/0.1 (github.com/FernForager/sno-ball)` and, because the query service was rate-limiting to one request per minute at capture time, at least 65 s apart.

## wiki-summaries.json and wiki-summaries-missing.json

Pre-baked opening sentences from English Wikipedia for the state, every county, every city/town in `wa-places.json` that has a `wikipedia` title, and about 120 Seattle neighborhood article titles. The site reads this file first and only calls Wikipedia live for a title that is not in it, because live calls to en.wikipedia.org get rate-limited (HTTP 429) when several happen close together.

`wiki-summaries.json` is an object keyed by the **requested** title (exactly the `wikipedia` value in the other data files, or the neighborhood title we asked for). Each value:

| field | meaning |
| --- | --- |
| `title` | the article Wikipedia actually served (differs from the key when the request redirected, e.g. `Wedgewood, Seattle` -> `Wedgwood, Seattle`) |
| `extract` | the first one or two sentences of the article's intro, at most 320 characters, cut only at a sentence boundary (an ellipsis marks the rare single sentence that was longer than 320 characters) |
| `url` | the article's desktop URL, for the "source" link |
| `thumbnail` | `{ source, width, height }` of the article's lead image at 320 px wide, or `null` |
| `description` | Wikipedia's short description (e.g. "City in Washington, United States"), or `null` |
| `fetchedAt` | ISO timestamp of the fetch |

`wiki-summaries-missing.json` is an array of requested titles that have no article (HTTP 404 / `missing`), are disambiguation pages, or redirect to a "List of ..." page. The site should treat these as "no Wikipedia excerpt" rather than retrying them live.

**License.** The `extract` text is Wikipedia prose, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). It must always be shown as a quotation with attribution to Wikipedia and a link to the article (`url`), never rewritten as our own words; the site's excerpt component does this. Thumbnails are hosted by Wikimedia and each has its own license on the Commons file page.

**How it was built.** Fetched on 2026-10-07 (UTC) with the user agent `sno-ball-build/0.1 (github.com/FernForager/sno-ball; morgan.ritchie@gmail.com)`. The per-page REST summary endpoint (`/api/rest_v1/page/summary/<title>`) answered 429 on roughly every other request even at one request per 1.2 s (Wikimedia's edge rate-limits per IP), so the data was instead pulled from the MediaWiki Action API in batches of 20 titles per request:

```
https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1
  &prop=extracts|pageimages|description|info|pageprops&exintro=1&explaintext=1&exlimit=20
  &piprop=thumbnail&pithumbsize=320&pilimit=20&inprop=url&ppprop=disambiguation&titles=<20 titles>
```

Requests were sent one at a time, 1.2 s apart, honouring `Retry-After` on 429 (it happened 2 times, each asking for about 45 s). Each entry was then trimmed to its first two sentences with an abbreviation-aware splitter (so "U.S." and "Mt." do not end a sentence).

Counts: 435 unique titles requested, 418 fetched, 17 missing (all missing titles are Seattle neighborhood names that have no article of their own). To refresh, rerun the same query and rewrite both files; keys must stay the requested titles.
