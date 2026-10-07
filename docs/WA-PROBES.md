# Washington data-source live probes (helper session in env "Histo-Globe", 2026-10-07 21:22 UTC)

All requests: curl -A "sno-ball-dev/0.1 (github.com/FernForager/sno-ball)" -H "Origin: https://fernforager.github.io". ACAO = Access-Control-Allow-Origin.

## CORS summary from a GitHub Pages origin
| Host | ACAO | Browser-fetchable? |
|---|---|---|
| aqua.kingcounty.gov (assessor zips) | none | No: build-time only |
| gis.dnr.wa.gov | echoes origin | Yes |
| services.arcgis.com/ZOyb2t4B0UYuYNYH (Seattle GeoData), Hub search | * | Yes |
| overpass-api.openhistoricalmap.org | * | Yes |
| query.wikidata.org | * | Yes |
| api.census.gov | * on data.json; data queries 302 without key | Key required (build-time only); nothing pre-2000 |
| www.loc.gov, tile.loc.gov | * | Yes |
| digitalcollections.lib.washington.edu | * | Yes (images max ~700 px, rights per item) |
| commons.wikimedia.org | * (origin=*) | Yes, but 429 after ~5 quick requests |
| historical1.arcgis.com (USGS historical topos), tnmaccess.nationalmap.gov | echoes origin / * | Yes |
| historicalmaps.arcgis.com | 502 | retired host |

## A. King County Assessor year-built extracts (BUILD-TIME)
Landing page https://info.kingcounty.gov/assessor/DataDownload/default.aspx (RCW 42.56.070(9) acknowledgment checkbox; links are static files on another host):
| Extract | URL | Zip | CSV | Last-Modified |
|---|---|---|---|---|
| Residential Building | https://aqua.kingcounty.gov/extranet/assessor/Residential%20Building.zip | 21.7 MB | EXTR_ResBldg.csv 154.6 MB | 2026-10-01 |
| Commercial Building | https://aqua.kingcounty.gov/extranet/assessor/Commercial%20Building.zip | 3.7 MB | EXTR_CommBldg.csv 11.8 MB + CommBldgSection 3.9 MB + CommBldgFeature | 2026-10-03 |
| Parcel | https://aqua.kingcounty.gov/extranet/assessor/Parcel.zip | 31.9 MB | EXTR_Parcel.csv 247.5 MB (628,594 rows) | 2026-09-26 |
No ACAO on aqua.kingcounty.gov; refreshed ~weekly; accept-ranges: bytes.

EXTR_ResBldg.csv: 533,734 rows, 525,498 distinct Major+Minor (PIN = Major(6)+Minor(4), zero padded). Header: Major,Minor,BldgNbr,NbrLivingUnits,Address,BuildingNumber,Fraction,DirectionPrefix,StreetName,StreetType,DirectionSuffix,ZipCode,Stories,BldgGrade,BldgGradeVar,SqFt1stFloor,SqFtHalfFloor,SqFt2ndFloor,SqFtUpperFloor,SqFtUnfinFull,SqFtUnfinHalf,SqFtTotLiving,SqFtTotBasement,SqFtFinBasement,FinBasementGrade,SqFtGarageBasement,SqFtGarageAttached,DaylightBasement,SqFtOpenPorch,SqFtEnclosedPorch,SqFtDeck,HeatSystem,HeatSource,BrickStone,ViewUtilization,Bedrooms,BathHalfCount,Bath3qtrCount,BathFullCount,FpSingleStory,FpMultiStory,FpFreestanding,FpAdditional,YrBuilt,YrRenovated,PcntComplete,Obsolescence,PcntNetCondition,Condition,AddnlCost
Key columns: YrBuilt, YrRenovated (0 = none; 27,999 non-zero), BldgGrade (1-13, 20), Condition (1-5), SqFtTotLiving, Stories (decimal). Values space-padded: trim.
YrBuilt by decade: 1890s 1 (1894) · 1900s 15,416 · 1910s 19,557 · 1920s 28,265 · 1930s 13,390 · 1940s 41,663 · 1950s 59,275 · 1960s 66,937 · 1970s 55,098 · 1980s 56,309 · 1990s 51,152 · 2000s 60,544 · 2010s 41,492 · 2020s 24,633. Caveat: 1900 has 2,010 rows vs ~700 for 1901-02 (placeholder floor); nothing before 1894.
EXTR_CommBldg.csv: 41,836 rows, 31,407 distinct Major+Minor. Header: Major,Minor,BldgNbr,NbrBldgs,Address,...,ZipCode,NbrStories,PredominantUse,Shape,ConstrClass,BldgQuality,BldgDescr,BldgGrossSqFt,BldgNetSqFt,YrBuilt,EffYr,PcntComplete,HeatingSystem,Sprinklers,Elevators. YrBuilt by decade: 1880s 2 · 1890s 4 · 1900s 1,526 · 1910s 1,393 · 1920s 2,242 · 1930s 1,000 · 1940s 2,162 · 1950s 4,005 · 1960s 6,059 · 1970s 5,223 · 1980s 5,996 · 1990s 3,831 · 2000s 4,259 · 2010s 2,821 · 2020s 1,312.
EXTR_Parcel.csv: 83 columns incl. Major, Minor, PropName, PlatName, PlatLot, PlatBlock, Range/Township/Section, PropType, DistrictName, CurrentZoning, PresentUse, SqFtLot, view flags, waterfront, HistoricSite, SeismicHazard, LandslideHazard. No coordinates (join to KCGIS parcel polygons by PIN).
Terms: only the RCW 42.56.070(9) acknowledgment (no commercial use of lists of individuals). No owner names in these extracts. Cite "King County Assessor".
Verdict: excellent build-time source; pre-process into a compact PIN -> YrBuilt table.

## B. WA DNR surface geology (gis.dnr.wa.gov, ArcGIS 11.5; ACAO reflects Origin, Vary: Origin)
Public_Geology/100K_Surface_Geology_WA_GeMS/MapServer: maxRecordCount 2000; JSON/geoJSON/PBF. Layers: 0 Vents · 1 Orientation · 2 Geochron · 3 Generic Points · 4 Fossil · 5 Lines · 6 Folds · 7 Faults · 8 Dikes · 9 Contacts · 10 Overlays · 11 100k Map Unit (polygon) · 12 Data Sources; table 13 Description of Map Units.
Layer 11 fields: MAP_UNIT_100K, MAP_UNIT_100K_ID_CONFIDENCE, MAP_UNIT_100K_LABEL, MAP_UNIT_100K_SYMBOL (short unit name), MAP_UNIT_100K_NOTES, MAP_UNIT_ORIGINAL, MAP_UNIT_100K_ID, MAP_UNIT_100K_QUAD_NAME, MAP_UNIT_100K_QUAD_UNIT, GLOBALID. No age/description on the polygon layer.
Table 13 fields: DMU_100K_MAP_UNIT, DMU_100K_FULL_NAME, DMU_100K_AGE, DMU_100K_DESCRIPTION, DMU_100K_QUAD_NAME, DMU_FEATURE_QUAD_UNIT, DMU_100K_ID. Join layer11.MAP_UNIT_100K_QUAD_UNIT = table13.DMU_FEATURE_QUAD_UNIT (1:1). Table 13: JSON/PBF only.
Point queries (layer 11, inSR=4326): Space Needle -> Qgt "Pleistocene continental glacial till" (Vashon Stade; "Till and outwash deposits from continental glaciers..."); Spokane -> Qfg "Pleistocene outburst flood deposits" (Missoula floods 15,300-12,700 years ago); Mt Rainier summit -> "ice".
Other services (ACAO ok): Earthquakes_and_Faults/MapServer (0 Fault Trenches · 1 Historical Earthquake Damage · 2 Quaternary Active Folds · 4 Relocated Earthquakes >1M · 5 Earthquakes >1M · 12 Quaternary Active Faults; tables 6 Historical Earthquake Photos, 8 Fault Citation); Volcanic_Vents/MapServer (0 Vent Locations); Geochronology/MapServer (0 Argon · 1 Uranium · 2 Radiocarbon · 3 Fission Track · 4 Fossils · 5 Luminescence · 6 Other; layer 0 fields AGE_MA, ERROR_MA, AGE_MODIFIER, ANALYSIS_TYPE, MATERIAL_DATED, GEOLOGIC_UNIT_NAME, LABEL_TXT, SYMBOLOGY (period), LATITUDE/LONGITUDE, COUNTY_NAME; e.g. 14.7 +/- 1.8 Ma K-Ar hornblende air-fall tuff at 47.5758/-122.1132; radiocarbon layer 2 uses CONVENTIONAL_AGE_BP, MEASURED_AGE_BP, TWO_SIGMA_CAL_AGE_DATA, LABEL_TXT).
Verdict: fully usable client-side; unit name/age/description need the extra table-13 query.

## C. Seattle GeoData (ArcGIS Hub + services.arcgis.com/ZOyb2t4B0UYuYNYH; ACAO *; f=geojson&outSR=4326 works; maxRecordCount 2000)
Hub search: https://data-seattlecitygis.opendata.arcgis.com/api/search/v1/collections/dataset/items?q=... ; www.arcgis.com/sharing/rest echoes origin.
1. Neighborhoods: .../rest/services/nma_nhoods_sub/FeatureServer/0 (Neighborhood Map Atlas Neighborhoods, item b4a142f592e94d39a3bf787f3c112c1d), 94 polygons; fields L_HOOD (district), S_HOOD (neighborhood), S_HOOD_ALT_NAMES. Space Needle -> "Queen Anne" / "Lower Queen Anne" (alt "Uptown, Seattle Center"). Districts: nma_nhoods_main/FeatureServer/0 (20). License PDDL; "unofficial delineation". City_Clerk_Neighborhoods is gone (400).
2. Annexations: .../rest/services/Annexation/FeatureServer/0 (item 918eba8c31524025acec7a6289cec0f8), 45 polygons 1869-1986; fields Statute, Statute_Date, Ordinance, Ordinance_Date, Method, Seattle_Archives_Link, Title, Ward, Effective_Date (epoch ms), Year. Point-in-polygon returns cumulative extents: take min Year (Space Needle -> 1869 "Area of First Incorporation"; Wedgwood -> 1945, Ordinance 73879).
3. Landmarks: .../rest/services/Landmarks/FeatureServer/0 (item 462a18bf1f9f459eb7fd8ea08c843880, SDCI, daily), 517 points; fields NAME, ADDRESS, ORIG_ADDRE, PIN, LANDNO, ORDINANCE, EFF_DATE (designation, epoch ms), PHOTO, DOCUMENT. No year built (join PIN). Space Needle: ORDINANCE 119428, EFF_DATE 1998-03-03, LANDNO 211. Multi-point landmarks repeat.
4. Modified Land: .../rest/services/Modified_Land/FeatureServer/12 (item 0cc8c64d84f9418aa01f38a22258ef77, SPU, from UW Geologic Map of Seattle), 367 polygons; fields PTYPE_1 (af/gr...), DESCRIPTIO ("artificial fill", "graded land"). No dates. Pioneer Square/stadiums -> "artificial fill". No dated historic-shoreline or regrade layer found on the portal. Shoreline/FeatureServer/0 is the modern contour.
5. Building outlines: Building_Outlines_2023/FeatureServer/0 (222,349 polygons; PIN, no year). YEAR BUILT IN SEATTLE CLIENT-SIDE: PARCEL_GEO/FeatureServer/0 (King County Tax Parcel Polygons with Seattle overlays, item d68452b5929e4d43a99201eb50ab231f, 237,102): PIN, ADDRESS, PROP_NAME, YR_BUILT_MAX (string), YR_RENOV_MAX, NR_BLDGS, LANDMARK (Y/N), BLDG_DESC. e.g. "407 Broad St, RESTAURANT, 1906"; "319 6th Ave N, Broad Street Substation, 1950, LANDMARK=Y". Filter YR_BUILT_MAX>0 (right-of-way polygons have empty PIN).
Verdict: neighborhoods, annexation, landmarks, PARCEL_GEO all usable directly in the browser.

## D. OpenHistoricalMap Overpass (overpass-api.openhistoricalmap.org; ACAO *; fast)
| bbox | ways w/ start_date | nodes | relations | ways w/ end_date |
|---|---|---|---|---|
| Seattle (47.49,-122.46,47.73,-122.22) | 6,168 | 717 | 45 | 1,565 |
| Spokane (47.60,-117.55,47.75,-117.25) | 413 | 16 | - | 61 |
| Tacoma (47.20,-122.55,47.30,-122.35) | 79 | 29 | - | 8 |
Seattle ways by decade: <=1840s 17 · 1850s 154 · 1860s 53 · 1870s 246 · 1880s 285 · 1890s 277 · 1900s 363 · 1910s 226 · 1920s 538 · 1930s 3,129 (2,845 are start_date=1936 from a bulk 1936 street-grid import) · 1940s 73 · 1950s 43 · 1960s 179 · 1970s 31 · 1980s 94 · 1990s 216 · 2000s 83 · 2010s 125 · 2020s 36. Types: highway 3,371 · building 1,606 · railway 759 · landuse 81 · natural 70. Hand-mapped detail concentrates 1850s-1920s (Pioneer Square, Great Fire era) and railways; many end_dates cluster on 1889-06-06 (Great Seattle Fire). Spokane thin; Tacoma sparse (mostly railway).
Samples: Occidental Hotel 1861-1883; Church of Our Lady of Good Help 1870-1889-06-06; Commercial Street 1852-02-28-1920-02-28; Colman Brick 1890-2019.

## E. Wikidata SPARQL (ACAO *) and Census API
Counties: ?c wdt:P31 wd:Q13415369 ("county of Washington") -> 39 rows, 39 with inception (King 1852-12-22; Snohomish 1861-01-14; Kittitas 1883-01-01; Mason 1854-03-13; Thurston 1852-01-01).
Cities/towns: VALUES ?cls {Q515 Q3957 Q1093829 Q15284 Q17343829 Q498162} ... P131 county in WA -> 1,166 distinct places (unincorporated 628, CDP 382, city in the US 220, ...); inception only 155/1,166 (13%); population 610 (52%); coordinates 99.8%. Only ~225 incorporated vs 281 real: use P131+ and class filter; founding dates must come from Wikipedia/HistoryLink/curation.
Seattle neighborhoods: P31 Q123705 + P131 Q5083 -> 70 (67 with coords, 4 with inception). Try P31/P279*.
Census API: keyless queries 302 to missing-key page (no CORS); data.json lists no decennial dataset before 2000. Not usable for historical populations.

## F. Photos and maps
1. Library of Congress (ACAO *): Sanborn maps for Seattle: https://www.loc.gov/collections/sanborn-maps/?q=seattle&fo=json -> 32 items (e.g. item sanborn09315_026, 1950, 129 sheets); IIIF via tile.loc.gov/image-services/iiif/service:gmd:...:09315_06_1950-covr/{region}/{size}/{rotation}/default.jpg, info.json works (6846x7914, 512 px tiles). Photos: https://www.loc.gov/photos/?q=seattle+1900&fo=json -> 591 results; filter access_restricted. Pre-1964 Sanborn sheets public domain. Rate limits ~20 req/10 s collections, 40/10 s items.
2. UW Libraries CONTENTdm (ACAO *): /digital/api/search/collection/all/searchterm/seattle/maxRecords/5 -> 77,896 results; item detail /digital/api/collections/<alias>/items/<id>/false has date, rights (rightsstatements.org URIs, many In Copyright), imageUri, iiifInfoUri; IIIF level1 max ~700 px. Use per-item rights.
3. Seattle Municipal Archives on Commons: real categories "Category:Seattle Municipal Archives", "Category:Seattle Municipal Archives via Flickr", "Category:CC-BY Seattle Municipal Archives", "Category:Files from Seattle Municipal Archives Flickr stream" (CC BY 2.0); API 429s quickly: build a static manifest at build time.
4. USGS historical topos: https://historical1.arcgis.com/arcgis/rest/services/USGS_Historical_Topographic_Maps/ImageServer (ACAO echoes origin; Web Mercator; public domain). Catalog query at Space Needle -> 31 maps: Seattle 1:125,000 1897 (imprints 1897-1909); Snohomish 1:125,000 1895/1897; Seattle 1:62,500 1894, 1908, 1909; Seattle Special 1909; Seattle South 1:24,000 1949; 1:25,000 1983; 1:100,000 1975, 1992; 1:250,000 1958, 1962. Fields Map_Name, Map_Scale, Date_On_Map, Imprint_Year, Year, Download_GeoPDF, View_Thumbnail_Image, Citation, OBJECTID. Render one sheet: exportImage with mosaicRule {"mosaicMethod":"esriMosaicLockRaster","lockRasterIds":[OBJECTID]}. TNM Access: https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Historical%20Topographic%20Maps&bbox=...&outputFormat=JSON -> 37 products with GeoPDF downloadURL.
Verdict: LOC and USGS are the cleanest client-side, public-domain image/map sources; the USGS ImageServer gives a real "map as it was in 1897/1909/1949" layer for the whole state.
