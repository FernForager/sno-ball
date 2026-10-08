# Pre-baked Washington reference data

`wa-counties.json` and `wa-places.json` were built from the Wikidata Query Service (https://query.wikidata.org/sparql) on 2026-10-07; `wiki-summaries.json` holds Wikipedia text and is described at the end of this file. Wikidata content is released under CC0 1.0 (public domain dedication), so these files carry no attribution requirement, but the site should still name "Wikidata" as the source next to any fact drawn from them. Re-run the queries below to refresh; values such as population change over time.

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

## wiki-summaries.json

Opening paragraphs of the English Wikipedia articles the site asks for most, so the page can show them without a request to Wikipedia (which rate-limited six of twenty summary requests in a live check and left the Seattle card empty). An object keyed by the title the site REQUESTS (`"Seattle"`, `"King County, Washington"`, `"Washington (state)"`, `"Lower Queen Anne, Seattle"`); each value has `title` (the article's real title after any redirect), `extract` (the opening paragraph as plain text), `url` (the desktop article URL), `thumbnail` (`{ source, width, height }` or `null`), `description` (Wikidata's short description or `null`) and `fetchedAt` (ISO date-time of the capture). The lookup in `src/lib/wiki-summaries.ts` matches the key exactly first, then ignoring letter case; a title the file lacks is fetched live.

**Licence: this text is Wikipedia prose under CC BY-SA 4.0**, not CC0 like the two Wikidata files. The site shows it only as a quoted excerpt with "Wikipedia" named and the article linked, and never rewrites it as its own words.

**Placeholder.** The file checked in here holds just four entries (Washington (state), King County, Seattle and Walla Walla), copied from the real REST summary responses captured on 2026-10-07 in `tests/fixtures/places/wikipedia-summary-*.json`. A helper session is building the full file (the state, every county, every city and town in `wa-places.json`, and the Seattle neighborhoods) from `https://en.wikipedia.org/api/rest_v1/page/summary/<title>`, one request per second; it replaces this placeholder on merge. Refresh it the same way when the excerpts go stale (a year is fine; article openings change slowly).
