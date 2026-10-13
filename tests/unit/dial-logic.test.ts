/**
 * Tests for the pure helpers in src/ui/dial.ts: which chapter sits on
 * either side of a stop, whether a move crosses a gear, and which readout
 * to show. They run in plain Node; nothing here touches the DOM.
 */
import { describe, expect, it } from 'vitest';
import type { NamedStop, Stop } from '../../src/ui/dial';
import { isGearChange, namedNeighbour, readoutFor } from '../../src/ui/dial';

const stop = (index: number, gear: Stop['gear'], readout = `stop ${index}`): Stop => ({ index, gear, readout, short: readout });
const named = (index: number, label = `chapter ${index}`): NamedStop => ({ index, label, readout: `${label} readout`, teaser: `${label} teaser` });

/** Chapters at 0, 5, 12 and 40, as if the stops ran 0..50. */
const CHAPTERS: readonly NamedStop[] = [named(0, 'Now'), named(5, 'Statehood'), named(12, 'Cascadia'), named(40, 'Birth of the Earth')];

describe('namedNeighbour', () => {
  it('steps to the next chapter above the current index', () => {
    expect(namedNeighbour(CHAPTERS, 0, 1).index).toBe(5);
    expect(namedNeighbour(CHAPTERS, 5, 1).index).toBe(12);
  });

  it('steps to the previous chapter below the current index', () => {
    expect(namedNeighbour(CHAPTERS, 12, -1).index).toBe(5);
    expect(namedNeighbour(CHAPTERS, 5, -1).index).toBe(0);
  });

  it('skips stops that are not chapters', () => {
    expect(namedNeighbour(CHAPTERS, 6, 1).index).toBe(12);
    expect(namedNeighbour(CHAPTERS, 6, -1).index).toBe(5);
    expect(namedNeighbour(CHAPTERS, 39, 1).index).toBe(40);
  });

  it('clamps at the last chapter in each direction instead of wrapping', () => {
    expect(namedNeighbour(CHAPTERS, 40, 1).index).toBe(40);
    expect(namedNeighbour(CHAPTERS, 0, -1).index).toBe(0);
    // Beyond every chapter, the nearest end is the answer.
    expect(namedNeighbour(CHAPTERS, 45, 1).index).toBe(40);
    expect(namedNeighbour(CHAPTERS, -3, -1).index).toBe(0);
  });

  it('from beyond the ends, stepping back inward reaches the end chapter', () => {
    expect(namedNeighbour(CHAPTERS, 45, -1).index).toBe(40);
    expect(namedNeighbour(CHAPTERS, -3, 1).index).toBe(0);
  });

  it('does not depend on the order of the list', () => {
    const shuffled = [CHAPTERS[2]!, CHAPTERS[0]!, CHAPTERS[3]!, CHAPTERS[1]!];
    expect(namedNeighbour(shuffled, 5, 1).index).toBe(12);
    expect(namedNeighbour(shuffled, 5, -1).index).toBe(0);
    expect(namedNeighbour(shuffled, 100, 1).index).toBe(40);
  });

  it('returns the chapter object itself, with its label', () => {
    expect(namedNeighbour(CHAPTERS, 0, 1).label).toBe('Statehood');
  });

  it('works with a single chapter', () => {
    const only = [named(7, 'Only')];
    expect(namedNeighbour(only, 7, 1).index).toBe(7);
    expect(namedNeighbour(only, 7, -1).index).toBe(7);
    expect(namedNeighbour(only, 2, 1).index).toBe(7);
    expect(namedNeighbour(only, 20, -1).index).toBe(7);
  });

  it('throws when there are no chapters at all', () => {
    expect(() => namedNeighbour([], 0, 1)).toThrow(RangeError);
  });
});

describe('isGearChange', () => {
  it('is false within one gear', () => {
    expect(isGearChange(stop(1, 'years'), stop(2, 'years'))).toBe(false);
    expect(isGearChange(stop(3, 'eons'), stop(3, 'eons'))).toBe(false);
  });

  it('is true when the gear differs', () => {
    expect(isGearChange(stop(181, 'years'), stop(182, 'decades'))).toBe(true);
    expect(isGearChange(stop(0, 'now'), stop(275, 'future'))).toBe(true);
    expect(isGearChange(stop(10, 'ice-ages'), stop(11, 'millions'))).toBe(true);
  });
});

describe('readoutFor', () => {
  it('uses the stop readout when no chapter is given', () => {
    expect(readoutFor(stop(5, 'years', '1889'))).toBe('1889');
  });

  it('prefers the chapter readout when its index matches the stop', () => {
    const chapter: NamedStop = { index: 5, label: 'Statehood', readout: '1889 · Statehood and the great fires', teaser: '' };
    expect(readoutFor(stop(5, 'years', '1889'), chapter)).toBe('1889 · Statehood and the great fires');
  });

  it('ignores a chapter for a different stop', () => {
    const chapter: NamedStop = { index: 6, label: 'Elsewhere', readout: 'other', teaser: '' };
    expect(readoutFor(stop(5, 'years', '1889'), chapter)).toBe('1889');
  });
});
