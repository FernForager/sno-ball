# Pre-baked Washington reference data

## wa-counties.json

One object per county of Washington, sorted by `name` (39 entries). Built from the Wikidata Query Service (https://query.wikidata.org/sparql) on 2026-10-07 by a helper session (branch `helper/fixtures-1`); re-run the queries below to refresh. Wikidata content is CC0 1.0 (public domain dedication), so the file carries no attribution requirement, but the site still names "Wikidata" as the source next to every fact drawn from it (see `src/lib/counties.ts`).

Keys: `qid`, `name`, `inception`, `seat`, `areaKm2`, `population`, `populationYear`, `lat`, `lon`, `wikipedia` (English Wikipedia article title), `fips` (5-digit county FIPS code), `namedAfter` (array of labels, possibly empty).

Coverage: all 39 counties have every field; 34 of 39 have at least one `namedAfter` entry (the other five have an empty array). Dates are ISO `YYYY-MM-DD` strings; a `-01-01` date usually means Wikidata only records the year (the site then shows "Established in 1883" rather than a day). Only nine counties carry a full date: Grays Harbor, King, Lewis, Lincoln, Mason, Pierce, Skamania, Snohomish and Stevens. `null` means Wikidata has no value. Coordinates are WGS 84 decimal degrees; every area statement was in square kilometres.

One value was corrected by hand after capture: Pend Oreille County's `name` came back from the label service as its id "Q485301" and was set to "Pend Oreille County" (its Wikipedia title confirms the name); `src/lib/counties.ts` also guards against this when loading. Everything else is as Wikidata gave it. If a value looks wrong (King County's `namedAfter` is "Martin Luther King Jr.", the 1986 re-dedication, not the 1852 namesake William Rufus King), fix it on Wikidata and refresh, or note the exception here.

Queries (counties with P31 = Q13415369 "county of Washington"):

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

`population` and `populationYear` are the population statement with the latest point in time (P585); statements with no point in time lose to any dated one. The query service was rate-limiting to one request per minute at capture time, so queries were sent at least 65 s apart.

The same helper branch also holds `wa-places.json` (288 cities and towns from Wikidata, same provenance); copy it here when a module needs it.
