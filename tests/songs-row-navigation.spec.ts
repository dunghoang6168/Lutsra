import { describe, expect, it } from 'vitest';
import { nextRowIndex } from '../src/app/features/songs/row-navigation';

describe('nextRowIndex', () => {
  it('moves one row with arrows and stops at either boundary', () => {
    expect(nextRowIndex('ArrowUp', 12, 25, 10)).toBe(11);
    expect(nextRowIndex('ArrowDown', 12, 25, 10)).toBe(13);
    expect(nextRowIndex('ArrowUp', 0, 25, 10)).toBe(0);
    expect(nextRowIndex('ArrowDown', 0, 25, 10)).toBe(1);
    expect(nextRowIndex('ArrowUp', 24, 25, 10)).toBe(23);
    expect(nextRowIndex('ArrowDown', 24, 25, 10)).toBe(24);
  });

  it('moves to the first or last row with Home and End', () => {
    expect(nextRowIndex('Home', 12, 25, 10)).toBe(0);
    expect(nextRowIndex('End', 12, 25, 10)).toBe(24);
    expect(nextRowIndex('Home', 0, 25, 10)).toBe(0);
    expect(nextRowIndex('End', 24, 25, 10)).toBe(24);
  });

  it('moves by ten rows with page keys and clamps overshoots', () => {
    expect(nextRowIndex('PageUp', 12, 25, 10)).toBe(2);
    expect(nextRowIndex('PageDown', 12, 25, 10)).toBe(22);
    expect(nextRowIndex('PageUp', 4, 25, 10)).toBe(0);
    expect(nextRowIndex('PageDown', 20, 25, 10)).toBe(24);
    expect(nextRowIndex('PageUp', 0, 25, 10)).toBe(0);
    expect(nextRowIndex('PageDown', 0, 25, 10)).toBe(10);
    expect(nextRowIndex('PageUp', 24, 25, 10)).toBe(14);
    expect(nextRowIndex('PageDown', 24, 25, 10)).toBe(24);
  });

  it('has no navigable row in an empty list', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(nextRowIndex(key, 0, 0, 10)).toBeNull();
    }
  });

  it('leaves playback keys and unrelated keys to other handlers', () => {
    for (const key of ['a', ' ', 'Enter']) {
      expect(nextRowIndex(key, 12, 25, 10)).toBeNull();
    }
  });

  it('keeps a single row active and uses at least one row per page', () => {
    expect(nextRowIndex('PageDown', 0, 1, 10)).toBe(0);
    expect(nextRowIndex('ArrowUp', 0, 1, 10)).toBe(0);
    expect(nextRowIndex('PageDown', 12, 25, 0)).toBe(13);
    expect(nextRowIndex('PageUp', 12, 25, 0)).toBe(11);
  });
});
