# Live API reachability report (helper session in env "Histo-Globe", 2026-10-07 21:09 UTC)

Requests sent with: -A "sno-ball-dev/0.1 (github.com/FernForager/sno-ball)" -H "Origin: https://fernforager.github.io". No host was blocked. Nominatim hit twice, 2 s apart.

| # | host / endpoint | HTTP | ACAO | Content-Type | note |
|---|---|---|---|---|---|
| 1 | nominatim.openstreetmap.org /search (400 Broad St Seattle, addressdetails, extratags) | 200 | * | json | resolves to Space Needle way osm_id 12903132 |
| 2 | nominatim /reverse lat=47.6205 lon=-122.3493 zoom=18 | 200 | * | json | returns a nearby node (3359850618), not the building way; reverse at z18 may land on a POI |
| 3 | photon.komoot.io /api?q=Space+Needle&bbox=WA | 200 | * | json | same way found |
| 4 | en.wikipedia.org action=query list=geosearch | 200 | * | json | SkyCity 11.7 m, etc. |
| 5 | en.wikipedia.org /api/rest_v1/page/summary/Seattle | 200 | * | json | 2.7 KB |
| 6 | en.wikipedia.org action=parse page=History_of_Seattle prop=sections | 200 | * | json | harmless "warnings" block precedes parse data |
| 7 | www.wikidata.org wbgetentities ids=Q5083 props=claims,labels | 200 | * | json | 224 KB (restrict props/claims) |
| 8 | query.wikidata.org SPARQL (Seattle population by time) | 200 | * | sparql-results+json | rows returned |
| 9 | commons.wikimedia.org geosearch ns=6 | 200 | * | json | photos near point |
| 10 | vtiles.openhistoricalmap.org /maps/ohm/14/2623/5720.pbf | 200 | * | x-protobuf | 73,914 bytes, chunked, no Content-Encoding seen |
| 11 | vtiles.openhistoricalmap.org /maps/ohm.json (TileJSON) | 200 | * | json | 252 KB; NOTE /maps/ohm (no .json) is 404 |
| 12 | www.openhistoricalmap.org/map-styles/main/main.json | 200 | * | json | 252 KB, style name "ohm-historical" |
| 13 | tiles.openfreemap.org/styles/positron | 200 | * | json | 25 KB |
| 14 | macrostrat.org /api/v2/geologic_units/map | 200 | * | json | "Younger glacial drift" (Vashon Drift; Sumas Drift); license CC-BY 4.0 |
| 15 | macrostrat.org /api/v2/columns | 200 | * | json | col 281 "Bremerton Area" |
| 16 | gws.gplates.org reconstruct_points time=100 MERDITH2021 | 200 | * | json | Seattle at 100 Ma -> lon -72.5869, lat 55.0114 |
| 17 | gws.gplates.org reconstruct/coastlines time=100 | 200 | * | json | 2.2 MB uncompressed |
| 18 | paleobiodb.org data1.2/occs/list.json bbox Puget | 200 | * | json | e.g. Phenacomys intermedius |
| 19 | gismaps.kingcounty.gov/arcgis/rest/services | 200 | echoes Origin | json | ArcGIS 10.91; folders incl. Property |
| 20 | data.seattle.gov /api/views.json | 200 | * | json | Socrata OK |
| 21 | www.historylink.org | 200 | (none) | html | no API; link-out only |
| 22a | gis.dnr.wa.gov/site3/rest/services | 200 | echoes Origin | json | Geology folder: 24K_Surface_Geology_WA_GeMS, 25_to_99K_Surface_Geology_WA_GeMS, Landslide_Inventory_Database, Subsurface_Data, Tsunami_Hazard, Lidar_Hillshade |
| 22b | gis.dnr.wa.gov/site1/rest/services | 200 | echoes Origin | json | Public_Geology: 100K_Surface_Geology_WA_GeMS (Map+Feature), 250k, 500k, Earthquakes_and_Faults, Volcanic_Hazards, Volcanic_Vents, Geochronology, Photograph_Collection, Seattle_Seismic_Scenario, ... |
| 23 | fernforager.github.io/sno-ball/ | 404 | (none) | html | expected (not deployed yet) |

## Findings
- BLOCKED: none. No CORS header: historylink.org, GitHub 404 page. ArcGIS servers echo the Origin (fine for browsers). Everything else returns *.
- OHM TileJSON is at /maps/ohm.json. Style at openhistoricalmap.org/map-styles/main/main.json.
- Large responses: Wikidata Q5083 claims 224 KB; GPlates coastlines 2.2 MB; OHM style/TileJSON ~250 KB each.
- King County parcels: Property/KingCo_Parcels/MapServer layer 0 (PIN only). Property/KingCo_PropertyInfo/MapServer layer 2 "Parcels" fields: PIN, MAJOR, MINOR, ADDR_HN, ADDR_FULL, ZIP5, CTYNAME, POSTALCTYNAME, PROP_NAME, PLAT_NAME, LOTSQFT, APPRLNDVAL, APPR_IMPR, ANNEXING_CITY, PROPTYPE, KCA_ZONING, KCA_ACRES, PREUSE_CODE, PREUSE_DESC, STATE_ABBR. Layer 3 "Property sales" (SaleDate, SalePrice, HistoricProperty...). Point query works (inSR=4326, esriGeometryPoint): Space Needle -> PIN 1985200495, PREUSE "Restaurant/Lounge". NO year-built field in any map layer; year built lives in the Assessor's eReal Property extracts (Residential Building / Commercial Building tables keyed by Major+Minor), a separate bulk download.
- Also present: Address/KingCo_ParcelAddress_locator (GeocodeServer).
