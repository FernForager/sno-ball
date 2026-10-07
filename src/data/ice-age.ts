/**
 * Hand-curated facts about the last ice age in Washington, one per region
 * and one each for the big Puget Sound cities, so every address can show
 * what the ground looked like roughly 16,000 years ago.
 *
 * The numbers come from the published literature on the Cordilleran ice
 * sheet (Thorson 1980; Porter and Swanson 1998; Booth and others 2003) as
 * summarised on the public pages cited below. Ice thicknesses are
 * reconstructions from the heights of ice-marginal features, so they are
 * marked 'medium' confidence; the dates and the broad story are 'high'.
 *
 * All `yearsAgo` values are years before 2000 CE, as everywhere on the site.
 */

import type { Source, WaRegion } from '../lib/types';

export interface IceAgeFact {
  region: WaRegion | 'Seattle' | 'Tacoma' | 'Everett' | 'Olympia' | 'Bellingham';
  title: string;
  body: string;
  yearsAgo: number;
  source: Source;
  confidence?: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Sources (shared by several facts)
// ---------------------------------------------------------------------------

const DNR_ICE_AGE_FLOODS: Source = {
  name: 'Washington Geological Survey (WA DNR): Ice Age Floods',
  url: 'https://www.dnr.wa.gov/programs-and-services/geology/explore-popular-geology/ice-age-floods',
  license: 'Public record',
};

const DNR_PROVINCES: Source = {
  name: 'Washington Geological Survey (WA DNR): Geologic Provinces of Washington',
  url: 'https://www.dnr.wa.gov/programs-and-services/geology/explore-popular-geology/geologic-provinces-washington',
  license: 'Public record',
};

const USGS_SEATTLE_MAP: Source = {
  name: 'USGS Open-File Report 2005-1252: The Geologic Map of Seattle',
  url: 'https://pubs.usgs.gov/of/2005/1252/',
  license: 'Public domain',
};

const USGS_PUGET_AQUIFER: Source = {
  name: 'USGS Professional Paper 1424-C: Geologic Framework for the Puget Sound Aquifer System',
  url: 'https://pubs.usgs.gov/pp/1424c/',
  license: 'Public domain',
};

const NPS_ICE_AGE_FLOODS: Source = {
  name: 'National Park Service: Ice Age Floods National Geologic Trail',
  url: 'https://www.nps.gov/iafl/index.htm',
  license: 'Public domain',
};

const NPS_OLYMPIC_GLACIERS: Source = {
  name: 'National Park Service: Glaciers of Olympic National Park',
  url: 'https://www.nps.gov/olym/learn/nature/glaciers.htm',
  license: 'Public domain',
};

const NPS_RAINIER_GLACIERS: Source = {
  name: 'National Park Service: Glaciers of Mount Rainier',
  url: 'https://www.nps.gov/mora/learn/nature/glaciers.htm',
  license: 'Public domain',
};

/** When the Puget lobe reached its farthest extent (the Vashon Stade maximum). */
const VASHON_MAXIMUM = 16_900;

// ---------------------------------------------------------------------------
// The facts
// ---------------------------------------------------------------------------

export const ICE_AGE_FACTS: readonly IceAgeFact[] = [
  // --- Puget Sound cities -------------------------------------------------
  {
    region: 'Seattle',
    title: 'Under 3,000 feet of ice',
    body:
      'About 16,900 years ago the Puget lobe of the Cordilleran ice sheet reached its greatest extent (the Vashon Stade). ' +
      'Over what is now downtown Seattle the ice stood roughly 3,000 feet (900 m) thick, five times the height of the Space Needle. ' +
      'The long north-south hills and troughs of the city, and the hard grey till under most yards, were left behind as it melted back.',
    yearsAgo: VASHON_MAXIMUM,
    source: USGS_SEATTLE_MAP,
    confidence: 'medium',
  },
  {
    region: 'Tacoma',
    title: 'Under about 1,700 feet of ice',
    body:
      'At the ice-age maximum about 16,900 years ago, Tacoma lay beneath roughly 1,700 feet (500 m) of glacier ice. ' +
      'The ice thinned southward toward its edge, and meltwater pouring off its front built the broad gravel plains south of the city.',
    yearsAgo: VASHON_MAXIMUM,
    source: DNR_PROVINCES,
    confidence: 'medium',
  },
  {
    region: 'Everett',
    title: 'Under about 4,000 feet of ice',
    body:
      'Everett sat beneath roughly 4,000 feet (1,200 m) of ice about 16,900 years ago, when the Puget lobe of the Cordilleran ice sheet was at its largest. ' +
      'The ice flowed south out of British Columbia, thickest in the north and thinning toward its end south of Olympia.',
    yearsAgo: VASHON_MAXIMUM,
    source: DNR_PROVINCES,
    confidence: 'medium',
  },
  {
    region: 'Bellingham',
    title: 'Under about 5,500 feet of ice',
    body:
      'Close to the source of the ice, Bellingham was buried under roughly 5,500 feet (1,700 m) of glacier about 16,900 years ago, more than a mile of ice. ' +
      'Only the highest peaks of the North Cascades stood above it.',
    yearsAgo: VASHON_MAXIMUM,
    source: DNR_PROVINCES,
    confidence: 'medium',
  },
  {
    region: 'Olympia',
    title: 'The edge of the ice',
    body:
      'The Puget lobe stopped just south of Olympia about 16,900 years ago. Its melting front dumped the sand and gravel that make up the prairies and ' +
      'outwash plains of southern Thurston County, and meltwater carved channels toward the Chehalis River because the ice itself blocked the way north.',
    yearsAgo: VASHON_MAXIMUM,
    source: USGS_PUGET_AQUIFER,
    confidence: 'high',
  },

  // --- Regions --------------------------------------------------------------
  {
    region: 'Puget Sound',
    title: 'Carved by the Puget lobe',
    body:
      'About 16,900 years ago the Puget lobe of the Cordilleran ice sheet filled the whole lowland from the Canadian border to south of Olympia. ' +
      'Meltwater under the ice scoured the deep troughs that Puget Sound and Lake Washington now fill, and the ice left the hard, grey Vashon till that lies under most of the region.',
    yearsAgo: VASHON_MAXIMUM,
    source: USGS_PUGET_AQUIFER,
    confidence: 'high',
  },
  {
    region: 'Olympic Peninsula',
    title: 'Ice on every side',
    body:
      'The Olympic Mountains were never buried, but ice surrounded them: the Juan de Fuca lobe pressed along the northern coast while the mountains grew their own alpine glaciers, ' +
      'which flowed far down the Hoh, Elwha and Quinault valleys. Today about 60 glaciers remain on the high peaks.',
    yearsAgo: 17_000,
    source: NPS_OLYMPIC_GLACIERS,
    confidence: 'high',
  },
  {
    region: 'Southwest Washington',
    title: 'Where the floods spread out',
    body:
      'The Missoula floods, between about 18,000 and 15,000 years ago, roared down the Columbia Gorge and spread across the lowlands around Vancouver, ' +
      'leaving gravel bars and scattered boulders carried from Montana. Beyond the floods, the region stayed free of ice-sheet cover.',
    yearsAgo: 15_000,
    source: DNR_ICE_AGE_FLOODS,
    confidence: 'high',
  },
  {
    region: 'North Cascades',
    title: 'Buried to the peaks',
    body:
      'The Cordilleran ice sheet flowed south over the North Cascades about 17,000 years ago, burying all but the highest summits, while valley glaciers ' +
      'carved the sharp ridges and deep U-shaped valleys the range is known for. Lake Chelan sits in a trough gouged by one of them.',
    yearsAgo: 17_000,
    source: DNR_PROVINCES,
    confidence: 'high',
  },
  {
    region: 'South Cascades',
    title: 'Mountain glaciers reached far down the valleys',
    body:
      'The ice sheet never reached the South Cascades, but the volcanoes grew enormous glaciers of their own: around 20,000 years ago ice from Mount Rainier ' +
      'stretched tens of miles down the Cowlitz, Nisqually and Puyallup valleys, far beyond the glaciers that remain on the mountain today.',
    yearsAgo: 20_000,
    source: NPS_RAINIER_GLACIERS,
    confidence: 'medium',
  },
  {
    region: 'Columbia Basin',
    title: 'Swept by the Missoula floods',
    body:
      'Between about 18,000 and 15,000 years ago an ice dam in Idaho failed again and again, releasing glacial Lake Missoula across eastern Washington in floods ' +
      'hundreds of feet deep. They stripped the soil and tore the Channeled Scablands into the basalt, leaving dry waterfalls, giant ripples and coulees.',
    yearsAgo: 15_000,
    source: DNR_ICE_AGE_FLOODS,
    confidence: 'high',
  },
  {
    region: 'Okanogan',
    title: 'The ice that dammed the Columbia',
    body:
      'About 16,000 years ago the Okanogan lobe of the ice sheet spread across the Columbia River and blocked it. The river backed up into glacial Lake Columbia and was ' +
      'forced south, and the Missoula floods that poured through this detour carved Grand Coulee and the 3.5-mile-wide cataract of Dry Falls.',
    yearsAgo: 16_000,
    source: NPS_ICE_AGE_FLOODS,
    confidence: 'high',
  },
  {
    region: 'Northeast Washington',
    title: 'Lobes of ice down every valley',
    body:
      'Tongues of the Cordilleran ice sheet (the Colville, Pend Oreille and Okanogan lobes) pushed south down the valleys of northeastern Washington about 16,000 years ago, ' +
      'damming the Columbia to form glacial Lake Columbia, whose silts still floor the valleys around Spokane and Kettle Falls.',
    yearsAgo: 16_000,
    source: DNR_ICE_AGE_FLOODS,
    confidence: 'high',
  },
  {
    region: 'Palouse and Blue Mountains',
    title: 'Floods at the edge of the Palouse',
    body:
      'The Missoula floods lapped against the Palouse hills and backed up behind the narrows at Wallula Gap, filling the Walla Walla valley with temporary Lake Lewis. ' +
      'Each flood, between about 18,000 and 15,000 years ago, left a layer of silt, now the striped Touchet Beds, while the rolling Palouse hills themselves are wind-blown dust (loess) piled up over the ice ages.',
    yearsAgo: 15_000,
    source: DNR_ICE_AGE_FLOODS,
    confidence: 'high',
  },
  {
    region: 'Yakima Valley',
    title: 'Drowned by Lake Lewis',
    body:
      'When the Missoula floods jammed at Wallula Gap, between about 18,000 and 15,000 years ago, the water backed up into the Yakima valley as temporary Lake Lewis, ' +
      'hundreds of feet deep. Its still water dropped the layered silts of the Touchet Beds, and stray icebergs left boulders from Montana on the valley slopes.',
    yearsAgo: 15_000,
    source: NPS_ICE_AGE_FLOODS,
    confidence: 'high',
  },
];

/** The city names that have their own fact, lower-cased for matching. */
const CITY_FACTS = new Map<string, IceAgeFact>(
  ICE_AGE_FACTS.filter((f) => ['Seattle', 'Tacoma', 'Everett', 'Olympia', 'Bellingham'].includes(f.region)).map((f) => [
    f.region.toLowerCase(),
    f,
  ]),
);

/**
 * The best ice-age fact for a place: the city's own fact when it is one of
 * the Puget Sound cities with a dedicated entry, otherwise the fact for its
 * region, otherwise undefined. The city name is matched ignoring case and
 * surrounding spaces, so "seattle" and "Seattle " both work.
 */
export function iceAgeFactFor(region: WaRegion | undefined, city?: string): IceAgeFact | undefined {
  const cityFact = city ? CITY_FACTS.get(city.trim().toLowerCase()) : undefined;
  if (cityFact) return cityFact;
  if (!region) return undefined;
  return ICE_AGE_FACTS.find((f) => f.region === region);
}
