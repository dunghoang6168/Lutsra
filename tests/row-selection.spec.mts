import { describe, expect, it } from 'vitest';
import { RowSelection, selectRows, visibleRowSelection } from '../src/app/shared/utils/row-selection';

const visible = ['a', 'b', 'c', 'd', 'e'];
const state = (ids: string[], anchor: string | null = ids[0] ?? null): RowSelection => ({ ids: new Set(ids), anchor });
const selected = (value: RowSelection) => [...value.ids];

describe('track row selection', () => {
  it('replaces selection and sets the anchor without mutating the input', () => {
    const previous = state(['a', 'b']);
    const next = selectRows(previous, visible, { type: 'replace', id: 'd' });
    expect(selected(next)).toEqual(['d']);
    expect(next.anchor).toBe('d');
    expect(selected(previous)).toEqual(['a', 'b']);
  });

  it('selects a range in either direction, replacing the previous range', () => {
    const forward = selectRows(state(['b', 'e'], 'b'), visible, { type: 'range', id: 'd' });
    expect(selected(forward)).toEqual(['b', 'c', 'd']);
    expect(forward.anchor).toBe('b');
    const backward = selectRows(forward, visible, { type: 'range', id: 'a' });
    expect(selected(backward)).toEqual(['a', 'b']);
    expect(backward.anchor).toBe('b');
  });

  it('toggles the anchor row, preserves the new anchor even when it is unselected', () => {
    const next = selectRows(state(['b', 'c'], 'b'), visible, { type: 'toggle', id: 'b' });
    expect(selected(next)).toEqual(['c']);
    expect(next.anchor).toBe('b');
    expect(selected(selectRows(next, visible, { type: 'range', id: 'd' }))).toEqual(['b', 'c', 'd']);
  });

  it('does not toggle off the last selected row', () => {
    expect(selected(selectRows(state(['b']), visible, { type: 'toggle', id: 'b' }))).toEqual(['b']);
    expect(selected(selectRows(state(['b']), visible, { type: 'toggle', id: 'd' }))).toEqual(['b', 'd']);
  });

  it('falls back to the target when an anchor was filtered out', () => {
    const next = selectRows(state(['b', 'c'], 'b'), ['a', 'c', 'd'], { type: 'range', id: 'd' });
    expect(selected(next)).toEqual(['d']);
    expect(next.anchor).toBe('d');
  });

  it('selects all visible rows only and preserves a surviving anchor', () => {
    const next = selectRows(state(['b', 'e'], 'e'), ['a', 'c', 'e'], { type: 'all' });
    expect(selected(next)).toEqual(['a', 'c', 'e']);
    expect(next.anchor).toBe('e');
  });

  it('collapses to the focused row, including a row outside the old selection', () => {
    const next = selectRows(state(['a', 'b']), visible, { type: 'collapse', id: 'e' });
    expect(selected(next)).toEqual(['e']);
    expect(next.anchor).toBe('e');
  });

  it('projects selected IDs without changing their identity on a sort', () => {
    const previous = state(['a', 'b', 'd'], 'b');
    const next = visibleRowSelection(previous, ['d', 'b'], 'd');
    expect(selected(next)).toEqual(['b', 'd']);
    expect(next.anchor).toBe('b');
    const range = selectRows(next, ['d', 'b', 'a'], { type: 'range', id: 'a' });
    expect(selected(range)).toEqual(['b', 'a']);
  });

  it('falls back to the active row or first visible row, but permits empty data', () => {
    expect(selected(visibleRowSelection(state(['a']), ['b', 'c'], 'c'))).toEqual(['c']);
    expect(selected(visibleRowSelection(state(['a']), ['b', 'c'], 'missing'))).toEqual(['b']);
    expect(selected(visibleRowSelection(state(['a']), [], 'a'))).toEqual([]);
    expect(selected(selectRows(state(['a']), visible, { type: 'reset' }))).toEqual([]);
  });

  it('uses playlist entry identities, preserving duplicate tracks in display order', () => {
    const rows = [{ id: 'entry-1', trackId: 'same-track' }, { id: 'entry-2', trackId: 'same-track' }];
    const next = selectRows(state(['entry-1']), rows.map((row) => row.id), { type: 'all' });
    expect(rows.filter((row) => next.ids.has(row.id)).map((row) => row.trackId)).toEqual(['same-track', 'same-track']);
  });
});
