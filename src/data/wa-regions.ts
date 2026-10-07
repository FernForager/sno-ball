/**
 * Which part of Washington each county belongs to.
 *
 * The state has 39 counties, and the site tells "region-scale" stories (the
 * ice-age floods, the Puget Sound glacier, the Palouse wheat country...) at a
 * level between county and state. There is no official list of regions, so
 * this is our own grouping of the counties into ten familiar areas.
 *
 * A few counties straddle two regions (Whatcom and Skagit reach from salt
 * water to the North Cascades; Kittitas sits between the Cascades and the
 * Yakima Valley). In those cases the county goes where most of its people
 * live, because visitors type the addresses of houses, not of mountains.
 *
 * The WaRegion names themselves are fixed in src/lib/types.ts; this file only
 * decides which county gets which name, and gives each region a short blurb.
 */

import type { WaRegion } from '../lib/types';

/** The ten regions, roughly west to east, for menus and tests. */
export const WA_REGIONS: readonly WaRegion[] = [
  'Olympic Peninsula',
  'Puget Sound',
  'Southwest Washington',
  'North Cascades',
  'South Cascades',
  'Yakima Valley',
  'Columbia Basin',
  'Okanogan',
  'Northeast Washington',
  'Palouse and Blue Mountains',
];

/**
 * County name (without the word "County") to region, for all 39 counties.
 * Look names up with regionOf(), which also accepts "King County" and
 * ignores letter case.
 */
export const COUNTY_REGION: Readonly<Record<string, WaRegion>> = {
  // Puget Sound: the inland sea and the cities on its shores.
  King: 'Puget Sound',
  Pierce: 'Puget Sound',
  Snohomish: 'Puget Sound',
  Kitsap: 'Puget Sound',
  Thurston: 'Puget Sound',
  Island: 'Puget Sound',
  'San Juan': 'Puget Sound',
  Skagit: 'Puget Sound',
  Whatcom: 'Puget Sound',

  // Olympic Peninsula: the mountains, rainforest and coast west of the Sound.
  Clallam: 'Olympic Peninsula',
  Jefferson: 'Olympic Peninsula',
  'Grays Harbor': 'Olympic Peninsula',
  Mason: 'Olympic Peninsula',

  // Southwest Washington: the lower Columbia and the I-5 corridor south of Olympia.
  Clark: 'Southwest Washington',
  Cowlitz: 'Southwest Washington',
  Lewis: 'Southwest Washington',
  Pacific: 'Southwest Washington',
  Wahkiakum: 'Southwest Washington',

  // North Cascades: the east slope around Wenatchee and Lake Chelan.
  Chelan: 'North Cascades',

  // South Cascades: the volcano country and the Columbia River Gorge.
  Skamania: 'South Cascades',
  Klickitat: 'South Cascades',

  // Yakima Valley: the Yakima River from Ellensburg down to the Tri-Cities.
  Yakima: 'Yakima Valley',
  Kittitas: 'Yakima Valley',

  // Columbia Basin: the dry centre of the state, irrigated from Grand Coulee.
  Grant: 'Columbia Basin',
  Adams: 'Columbia Basin',
  Franklin: 'Columbia Basin',
  Benton: 'Columbia Basin',
  Douglas: 'Columbia Basin',
  Lincoln: 'Columbia Basin',

  // Okanogan: the big northern valley, the largest county by area.
  Okanogan: 'Okanogan',

  // Northeast Washington: Spokane and the forested counties to its north.
  Spokane: 'Northeast Washington',
  Stevens: 'Northeast Washington',
  'Pend Oreille': 'Northeast Washington',
  Ferry: 'Northeast Washington',

  // Palouse and Blue Mountains: the wheat hills of the southeast corner.
  Whitman: 'Palouse and Blue Mountains',
  'Walla Walla': 'Palouse and Blue Mountains',
  Columbia: 'Palouse and Blue Mountains',
  Garfield: 'Palouse and Blue Mountains',
  Asotin: 'Palouse and Blue Mountains',
};

/** Two sentences about each region, in our own words (no source needed). */
export const REGION_BLURB: Readonly<Record<WaRegion, string>> = {
  'Puget Sound':
    'The inland sea at the heart of western Washington, carved by ice-age glaciers and ringed by the cities where most Washingtonians live. Coast Salish peoples have fished and travelled these waters for thousands of years; Seattle, Tacoma and Everett grew up on its shores in the late 1800s on timber, shipping and railroads.',
  'Olympic Peninsula':
    'A thumb of land wrapped by the Pacific, the Strait of Juan de Fuca and Hood Canal, with the Olympic Mountains and temperate rainforests at its core. Logging towns, tribal nations such as the Makah, Quileute and Quinault, and Olympic National Park shape its story.',
  'Southwest Washington':
    "The lower Columbia River country, from the Cascade foothills to the river's mouth at the Pacific. Fur traders, Fort Vancouver and the Oregon Trail put it on the map long before the lumber mills and the Interstate 5 corridor did.",
  'North Cascades':
    'Rugged, glaciated peaks east of Puget Sound, with mountain passes that long kept the two halves of the state apart. Mining camps, apple orchards along the Wenatchee and Chelan valleys, and the North Cascades Highway tell its history.',
  'South Cascades':
    "The volcanic country of Mount St. Helens and Mount Adams, dropping south to the Columbia River Gorge. Native trade routes and fisheries on the Columbia, the 1980 eruption and the Gorge's winds and orchards define it.",
  'Columbia Basin':
    'The dry heart of the state, scoured by the Ice Age Missoula floods and then made green by irrigation from Grand Coulee Dam. The secret wartime plutonium works at Hanford and the Tri-Cities grew here along the Columbia.',
  Okanogan:
    "A high, dry valley running north to Canada between the Cascades and the Okanogan Highlands. Gold rushes, cattle ranches, orchards and the Colville Reservation mark its past, and it is Washington's largest county by area.",
  'Northeast Washington':
    'Forested mountains and river valleys around Spokane, where the Spokane and Columbia rivers meet the foothills of the Rockies. Fur-trading posts, mining booms and the railroads made Spokane the hub of the Inland Northwest.',
  'Palouse and Blue Mountains':
    "Rolling hills of wind-blown silt that became some of the richest wheat land on Earth, with the Blue Mountains rising to the south. Walla Walla's mission and fort era, the Nez Perce homelands and the Snake River dams shape its story.",
  'Yakima Valley':
    'A broad river valley on the dry east side of the Cascades, home of the Yakama Nation and vast irrigated orchards, hop yards and vineyards. Ellensburg and Yakima grew with the railroads and the canals that turned sagebrush into farmland.',
};

/** Lower-cased county name -> region, built once so lookups are cheap. */
const BY_LOWER_NAME: ReadonlyMap<string, WaRegion> = new Map(
  Object.entries(COUNTY_REGION).map(([name, region]) => [name.toLowerCase(), region]),
);

/**
 * Strip the word "County", extra spaces and letter case from a county name,
 * so "King County", " king ", "KING" and "King" all become "king".
 */
export function normaliseCountyName(county: string): string {
  return county
    .replace(/\s+county\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The region a county belongs to, or undefined when the name is not one of
 * Washington's 39 counties. Accepts the name with or without "County" and
 * in any letter case, which is how geocoders tend to hand it back
 * ("King County", "Walla Walla County").
 */
export function regionOf(county: string): WaRegion | undefined {
  return BY_LOWER_NAME.get(normaliseCountyName(county));
}
