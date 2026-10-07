import { describe, expect, it } from 'vitest';
import {
  ago,
  formatReadout,
  fromDecimalDate,
  fromWikidataTime,
  fromYearsAgo,
  parseTime,
  toDecimalDate,
  year,
  yearsAgo,
} from '../../src/lib/time';

describe('yearsAgo / fromYearsAgo', () => {
  it.each([
    [year(2000), 0],
    [year(1889), 111],
    [year(1), 1999],
    [year(-1), 2000], // 1 BCE: no year 0
    [year(-800), 2799],
    [ago(20_000), 20_000],
    [ago(66_000_000), 66_000_000],
  ])('%o is %i years before 2000', (t, expected) => {
    expect(yearsAgo(t)).toBe(expected);
  });

  it('round-trips calendar years through years-ago', () => {
    for (const y of [2026, 1889, 1500, 1, -1, -800, -12_000]) {
      expect(fromYearsAgo(yearsAgo(year(y)))).toEqual(year(y));
    }
  });

  it('switches to "ago" at the threshold', () => {
    expect(fromYearsAgo(19_999)).toEqual(year(-18_000));
    expect(fromYearsAgo(20_000)).toEqual(ago(20_000));
  });

  it('rejects year 0', () => {
    expect(() => year(0)).toThrow();
  });
});

describe('OpenHistoricalMap decimal dates', () => {
  it.each([
    [1, 1.0],
    [2026, 2026.0],
    [-1, 0.0], // 1 BCE
    [-2, -1.0], // 2 BCE
    [-500, -499.0],
  ])('year %i -> decimal %f', (y, decimal) => {
    expect(toDecimalDate(y)).toBe(decimal);
    expect(fromDecimalDate(decimal)).toBe(y);
  });

  it('keeps a fraction inside the year', () => {
    expect(toDecimalDate(1889, 0.5)).toBe(1889.5);
    expect(fromDecimalDate(1889.5)).toBe(1889);
    expect(fromDecimalDate(0.5)).toBe(-1); // mid 1 BCE spans [0, 1)
    expect(fromDecimalDate(-0.5)).toBe(-2); // 2 BCE spans [-1, 0)
  });
});

describe('Wikidata time values', () => {
  it.each([
    ['+1790-07-16T00:00:00Z', 1790],
    ['+0079-00-00T00:00:00Z', 79],
    ['-0500-00-00T00:00:00Z', -500],
    ['-0001-00-00T00:00:00Z', -1],
  ])('%s -> %i', (value, y) => {
    expect(fromWikidataTime(value)).toBe(y);
  });

  it('returns null for garbage', () => {
    expect(fromWikidataTime('1790')).toBeNull();
    expect(fromWikidataTime('+0000-00-00T00:00:00Z')).toBeNull();
  });
});

describe('formatReadout', () => {
  it.each([
    [year(1889), '1889'],
    [year(79), '79 CE'],
    [year(-500), '500 BCE'],
    [ago(20_000), '20,000 years ago'],
    [ago(66_000_000), '66 million years ago'],
    [ago(2_600_000), '2.6 million years ago'],
    [ago(4_567_000_000), '4.57 billion years ago'],
  ])('%o reads as %s', (t, text) => {
    expect(formatReadout(t)).toBe(text);
  });
});

describe('parseTime', () => {
  it.each([
    ['1924', year(1924)],
    ['1924 CE', year(1924)],
    ['AD 79', year(79)],
    ['800 BC', year(-800)],
    ['800 BCE', year(-800)],
    ['1860s', year(1860)],
    ['20,000 years ago', ago(20_000)],
    ['20 ka', ago(20_000)],
    ['8,000 years ago', year(-6001)],
    ['66 Ma', ago(66_000_000)],
    ['66 million years ago', ago(66_000_000)],
    ['2.4 billion years ago', ago(2_400_000_000)],
    ['4.5 Ga', ago(4_500_000_000)],
  ])('%s', (text, expected) => {
    expect(parseTime(text)).toEqual(expected);
  });

  it('understands "now" as the current year', () => {
    expect(parseTime('now', 2026)).toEqual(year(2026));
  });

  it('returns null for nonsense and year 0', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('banana')).toBeNull();
    expect(parseTime('0 BC')).toBeNull();
  });
});
