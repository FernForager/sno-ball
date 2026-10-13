import { describe, expect, it } from 'vitest';
import { ago, parseTime, year, yearsAgo } from '../../src/lib/time';
import {
  FUTURE_INDEX,
  FUTURE_YEARS_AGO,
  NAMED_STOPS,
  NOW_INDEX,
  OLDEST_INDEX,
  STOPS,
  decodeAt,
  encodeAt,
  gearTint,
  indexOfMa,
  indexOfYear,
  isNamedIndex,
  nearestNamedStop,
  stepStop,
  stopAt,
  stopFor,
  windowOf,
  type Gear,
  type Stop,
} from '../../src/lib/stops';

const byGear = (gear: Gear): Stop[] => STOPS.filter((s) => s.gear === gear);

describe('STOPS', () => {
  it('has exactly 276 stops, indexed in order', () => {
    expect(STOPS).toHaveLength(276);
    STOPS.forEach((s, i) => expect(s.index).toBe(i));
    expect(OLDEST_INDEX).toBe(275);
  });

  it('starts with the future stop, then Now, then strictly older stops', () => {
    expect(STOPS[FUTURE_INDEX]?.gear).toBe('future');
    expect(yearsAgo(STOPS[FUTURE_INDEX]!.time)).toBe(FUTURE_YEARS_AGO);
    expect(yearsAgo(STOPS[FUTURE_INDEX]!.time)).toBe(-50_000_000);
    expect(STOPS[NOW_INDEX]?.time).toEqual(year(2026));
    for (let i = NOW_INDEX + 1; i < STOPS.length; i++) {
      expect(yearsAgo(STOPS[i]!.time)).toBeGreaterThan(yearsAgo(STOPS[i - 1]!.time));
    }
  });

  it('has the gear counts from Plan v2 §4', () => {
    expect(byGear('future')).toHaveLength(1);
    expect(byGear('now').length + byGear('years').length).toBe(182);
    expect(byGear('decades')).toHaveLength(8);
    expect(byGear('centuries')).toHaveLength(28);
    expect(byGear('millennia')).toHaveLength(16);
    expect(byGear('ice-ages')).toHaveLength(11);
    expect(byGear('millions')).toHaveLength(20);
    expect(byGear('eons')).toHaveLength(10);
  });

  it('keeps each gear in one contiguous run, oldest gear last', () => {
    const order: Gear[] = [
      'future',
      'now',
      'years',
      'decades',
      'centuries',
      'millennia',
      'ice-ages',
      'millions',
      'eons',
    ];
    const seen = STOPS.map((s) => s.gear).filter((g, i, arr) => i === 0 || arr[i - 1] !== g);
    expect(seen).toEqual(order);
  });

  it('uses calendar years down to 17,000 BCE and "ago" from 20,000 years', () => {
    expect(byGear('millennia').at(-1)?.time).toEqual(year(-17_000));
    expect(byGear('ice-ages')[0]?.time).toEqual(ago(20_000));
    expect(byGear('eons').at(-1)?.time).toEqual(ago(4_567_000_000));
  });
});

describe('readouts', () => {
  it.each<[number, string, string]>([
    [indexOfYear(1889), '1889', '1889'],
    [indexOfYear(1790), 'the 1790s', '1790s'],
    [indexOfYear(900), 'the 900s', '900s'],
    [indexOfYear(1), '1 CE', '1 CE'],
    [indexOfYear(-500), '500 BCE', '500 BCE'],
    [indexOfYear(-15_000), '15,000 BCE (about 17,000 years ago)', '15,000 BCE'],
    [indexOfYear(-2000), '2,000 BCE (about 4,000 years ago)', '2,000 BCE'],
    [indexOfMa(0.02), '20,000 years ago', '20 ka'],
    [indexOfMa(0.5), '500,000 years ago', '500 ka'],
    [indexOfMa(2.6), '2.6 million years ago', '2.6 Ma'],
    [indexOfMa(66), '66 million years ago', '66 Ma'],
    [indexOfMa(635), '635 million years ago', '635 Ma'],
    [indexOfMa(1470), '1.47 billion years ago', '1.47 Ga'],
    [indexOfMa(2500), '2.5 billion years ago', '2.5 Ga'],
    [indexOfMa(4567), '4.57 billion years ago', '4.57 Ga'],
    [FUTURE_INDEX, '50 million years from now', '+50 Ma'],
    [NOW_INDEX, 'Today', 'Now'],
  ])('stop %i reads "%s" / "%s"', (index, readout, short) => {
    expect(stopAt(index).readout).toBe(readout);
    expect(stopAt(index).short).toBe(short);
  });
});

describe('NAMED_STOPS', () => {
  it('has the 27 named stops, each on a real gear stop, youngest first', () => {
    expect(NAMED_STOPS).toHaveLength(27);
    for (const n of NAMED_STOPS) {
      expect(STOPS[n.index]).toBeDefined();
      expect(isNamedIndex(n.index)).toBe(true);
    }
    const indices = NAMED_STOPS.map((n) => n.index);
    expect(indices[0]).toBe(NOW_INDEX);
    expect(indices.at(-1)).toBe(FUTURE_INDEX);
    for (let i = 2; i < indices.length - 1; i++) expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
  });

  it('points at the expected years and ages', () => {
    // 1792 is not a gear stop, so that chapter lives on the 1790s decade stop.
    const years = [1980, 1942, 1936, 1916, 1909, 1897, 1889, 1855, 1846, 1790, 1700, 1500, 900, -6000, -12_000, -15_000];
    const ma = [0.5, 2.6, 16, 50, 100, 539, 720, 1470, 4567];
    const times = NAMED_STOPS.map((n) => STOPS[n.index]!.time);
    expect(times[0]).toEqual(year(2026));
    years.forEach((y, i) => expect(times[i + 1]).toEqual(year(y)));
    ma.forEach((m, i) => expect(times[i + 1 + years.length]).toEqual(ago(m * 1_000_000)));
    expect(times.at(-1)).toEqual({ kind: 'ago', value: -50_000_000 });
  });

  it('carries the table readouts and event ids', () => {
    const find = (label: string) => NAMED_STOPS.find((n) => n.label === label)!;
    expect(find('1980').readout).toBe('May 18, 1980 · Mount St. Helens erupts');
    expect(find('1980').eventIds).toEqual(['st-helens-1980']);
    expect(find('1942').eventIds).toEqual(['hanford-1943', 'japanese-american-removal-1942']);
    expect(find('15,000 BCE').readout).toMatch(/^17,000 years ago · Ice age peak/);
    expect(find('15,000 BCE').eventIds).toEqual(['vashon-ice-sheet', 'missoula-floods']);
    expect(find('+50 Ma').readout).toBe('50 million years from now');
    expect(find('+50 Ma').eventIds).toEqual(['future-50ma']);
    expect(find('1.47 Ga').readout).toBe("1.47 billion years ago · Washington's oldest rocks");
    expect(find('1792').index).toBe(indexOfYear(1790));
    expect(find('1792').readout).toMatch(/^1792 · Vancouver/);
    for (const n of NAMED_STOPS) {
      expect(n.teaser.length).toBeGreaterThan(0);
      for (const id of n.eventIds) expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('stopFor', () => {
  it.each<[ReturnType<typeof year>, number]>([
    [year(1888), indexOfYear(1888)],
    [year(2026), NOW_INDEX],
    [year(2040), NOW_INDEX],
    [year(1843), indexOfYear(1845)], // 2 years to 1845, 3 to the 1840s
    [year(1842), indexOfYear(1840)],
    [year(1765), indexOfYear(1770)],
    [year(1730), indexOfYear(1700)], // 30 years to 1700, 40 to the 1770s
    [year(-17_500), indexOfYear(-17_000)],
    [ago(17_500), indexOfYear(-16_000)], // 15,500 BCE: 499 years from 16,000 BCE, 2,500 from 20,000 ya
    [ago(19_400), indexOfYear(-17_000)],
    [ago(19_600), indexOfMa(0.02)],
    [ago(70_000_000), indexOfMa(66)],
    [ago(5_000_000_000), indexOfMa(4567)],
    [{ kind: 'ago', value: -50_000_000 }, FUTURE_INDEX],
    [{ kind: 'ago', value: -1_000_000 }, NOW_INDEX],
  ])('%o snaps to stop %i', (t, index) => {
    expect(stopFor(t).index).toBe(index);
  });

  it('sends an exact tie to the older stop', () => {
    // 1842.5 is not a calendar year, so use the ice-age gear: 22,500 sits exactly between 20,000 and 25,000.
    expect(stopFor(ago(22_500)).index).toBe(indexOfMa(0.025));
    expect(stopFor(ago(27_500)).index).toBe(indexOfMa(0.03));
  });
});

describe('nearestNamedStop', () => {
  it('returns the named stop itself when on one', () => {
    for (const n of NAMED_STOPS) expect(nearestNamedStop(n.index)).toBe(n);
  });

  it('measures distance in years, not stops', () => {
    expect(nearestNamedStop(indexOfYear(1900)).label).toBe('1897');
    expect(nearestNamedStop(indexOfYear(1990)).label).toBe('1980');
    expect(nearestNamedStop(indexOfYear(2010)).label).toBe('Today');
    expect(nearestNamedStop(indexOfMa(1)).label).toBe('500,000 ya');
    expect(nearestNamedStop(indexOfMa(66)).label).toBe('50 Ma');
    expect(nearestNamedStop(indexOfMa(3500)).label).toBe('4.57 Ga');
  });
});

describe('windowOf', () => {
  it('gives a year stop plus or minus half a year', () => {
    expect(windowOf(stopAt(indexOfYear(1889)))).toEqual({ fromYearsAgo: 110.5, toYearsAgo: 111.5 });
  });

  it('gives a decade, century and millennium stop half the step each way', () => {
    expect(windowOf(stopAt(indexOfYear(1790)))).toEqual({ fromYearsAgo: 205, toYearsAgo: 215 });
    expect(windowOf(stopAt(indexOfYear(900)))).toEqual({ fromYearsAgo: 1050, toYearsAgo: 1150 });
    expect(windowOf(stopAt(indexOfYear(-500)))).toEqual({ fromYearsAgo: 2449, toYearsAgo: 2549 });
    expect(windowOf(stopAt(indexOfYear(-15_000)))).toEqual({ fromYearsAgo: 16_499, toYearsAgo: 17_499 });
  });

  it('splits uneven gears halfway to each neighbour', () => {
    expect(windowOf(stopAt(indexOfMa(66)))).toEqual({ fromYearsAgo: 61_000_000, toYearsAgo: 83_000_000 });
    expect(windowOf(stopAt(indexOfMa(0.02)))).toEqual({ fromYearsAgo: 19_499.5, toYearsAgo: 22_500 });
    expect(windowOf(stopAt(indexOfMa(4567)))).toEqual({
      fromYearsAgo: 4_283_500_000,
      toYearsAgo: 4_850_500_000,
    });
  });

  it('leaves Now open toward the present and the future a point', () => {
    expect(windowOf(stopAt(NOW_INDEX))).toEqual({ fromYearsAgo: -Infinity, toYearsAgo: -25.5 });
    expect(windowOf(stopAt(FUTURE_INDEX))).toEqual({ fromYearsAgo: -50_000_000, toYearsAgo: -50_000_000 });
  });

  it('tiles the dial without gaps inside a gear', () => {
    for (let i = NOW_INDEX + 1; i < STOPS.length; i++) {
      const a = STOPS[i - 1]!;
      const b = STOPS[i]!;
      if (a.gear !== b.gear || a.gear === 'now') continue;
      // There is no year 0, so 1 CE is 99 years from 100 CE and 100 from 100 BCE:
      // the century windows around it leave a one-year seam. Nothing else may.
      const seam = Math.abs(windowOf(a).toYearsAgo - windowOf(b).fromYearsAgo);
      const atYearOne = a.time.value === 1 || b.time.value === 1;
      expect(seam).toBeLessThanOrEqual(atYearOne ? 1 : 1e-6);
    }
  });
});

describe('encodeAt / decodeAt', () => {
  it.each<[number, string]>([
    [NOW_INDEX, 'now'],
    [indexOfYear(1890), '1890'],
    [indexOfYear(1), '1'],
    [indexOfYear(-100), '-100'],
    [indexOfYear(-8000), '-8000'],
    [indexOfMa(0.02), '20ka'],
    [indexOfMa(0.75), '750ka'],
    [indexOfMa(2.6), '2.6Ma'],
    [indexOfMa(66), '66Ma'],
    [indexOfMa(635), '635Ma'],
    [indexOfMa(1470), '1.47Ga'],
    [indexOfMa(2500), '2.5Ga'],
    [FUTURE_INDEX, '+50Ma'],
  ])('stop %i encodes as "%s" and back', (index, text) => {
    expect(encodeAt(stopAt(index))).toBe(text);
    expect(decodeAt(text)?.index).toBe(index);
  });

  it('round-trips every stop and every named stop', () => {
    for (const s of STOPS) expect(decodeAt(encodeAt(s))?.index).toBe(s.index);
    for (const n of NAMED_STOPS) expect(decodeAt(encodeAt(stopAt(n.index)))?.index).toBe(n.index);
  });

  it('accepts what people type and snaps it', () => {
    expect(decodeAt('1889')?.index).toBe(indexOfYear(1889));
    expect(decodeAt('800 BC')?.index).toBe(indexOfYear(-800));
    expect(decodeAt('15,000 BCE')?.index).toBe(indexOfYear(-15_000));
    expect(decodeAt('17,000 years ago')?.index).toBe(indexOfYear(-15_000)); // the plan's own readout
    expect(decodeAt('16 Ma')?.index).toBe(indexOfMa(16));
    expect(decodeAt('70 million years ago')?.index).toBe(indexOfMa(66));
    expect(decodeAt('4.5 Ga')?.index).toBe(indexOfMa(4567));
    expect(decodeAt(' Today ')?.index).toBe(NOW_INDEX);
    expect(decodeAt('+50 ma')?.index).toBe(FUTURE_INDEX);
    expect(decodeAt('1860s')?.index).toBe(indexOfYear(1860));
    expect(decodeAt('2040')?.index).toBe(NOW_INDEX);
  });

  it('agrees with parseTime for the forms it understands', () => {
    for (const text of ['1924', '800 bc', '20 ka', '66 Ma', '2.4 billion years ago']) {
      expect(decodeAt(text)?.index).toBe(stopFor(parseTime(text)!).index);
    }
  });

  it('returns null for nonsense', () => {
    expect(decodeAt('')).toBeNull();
    expect(decodeAt('yesterday')).toBeNull();
    expect(decodeAt('-0')).toBeNull();
    expect(decodeAt('0')).toBeNull();
  });
});

describe('gearTint', () => {
  it('has a light and a dark colour for every gear', () => {
    const gears: Gear[] = ['now', 'years', 'decades', 'centuries', 'millennia', 'ice-ages', 'millions', 'eons', 'future'];
    const seen = new Set<string>();
    for (const g of gears) {
      const t = gearTint(g);
      expect(t.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.light).not.toBe(t.dark);
      seen.add(t.light);
    }
    expect(seen.size).toBe(gears.length);
  });
});

describe('stepStop', () => {
  it('steps one stop at a time and stays on the dial', () => {
    expect(stepStop(NOW_INDEX, 1, 'stop')).toBe(NOW_INDEX + 1);
    expect(stepStop(NOW_INDEX, -1, 'stop')).toBe(FUTURE_INDEX);
    expect(stepStop(FUTURE_INDEX, -1, 'stop')).toBe(FUTURE_INDEX);
    expect(stepStop(OLDEST_INDEX, 1, 'stop')).toBe(OLDEST_INDEX);
    expect(stepStop(999, 1, 'stop')).toBe(OLDEST_INDEX);
  });

  it('steps between named stops', () => {
    expect(stepStop(NOW_INDEX, 1, 'named')).toBe(indexOfYear(1980));
    expect(stepStop(indexOfYear(1980), 1, 'named')).toBe(indexOfYear(1942));
    expect(stepStop(indexOfYear(1942), -1, 'named')).toBe(indexOfYear(1980));
    expect(stepStop(indexOfYear(1950), 1, 'named')).toBe(indexOfYear(1942));
    expect(stepStop(indexOfYear(1950), -1, 'named')).toBe(indexOfYear(1980));
    expect(stepStop(NOW_INDEX, -1, 'named')).toBe(FUTURE_INDEX);
    expect(stepStop(FUTURE_INDEX, -1, 'named')).toBe(FUTURE_INDEX);
    expect(stepStop(indexOfMa(4567), 1, 'named')).toBe(indexOfMa(4567));
    expect(stepStop(indexOfMa(4000), 1, 'named')).toBe(indexOfMa(4567));
  });

  it('walks the whole named dial from Now to the oldest stop in 25 steps', () => {
    let i = NOW_INDEX;
    let steps = 0;
    for (;;) {
      const next = stepStop(i, 1, 'named');
      if (next === i) break;
      i = next;
      steps++;
    }
    expect(i).toBe(indexOfMa(4567));
    expect(steps).toBe(25);
  });
});
