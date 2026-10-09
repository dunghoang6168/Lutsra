import { describe, expect, it } from 'vitest';
import { splitDuplicates } from '../src/app/shared/utils/list-media';

const entries = [{ trackId: 'a' }, { trackId: 'b' }];

describe('splitDuplicates', () => {
  it('keeps every track fresh when the playlist has none', () => {
    expect(splitDuplicates(entries, ['c', 'd'])).toEqual({ duplicates: [], fresh: ['c', 'd'] });
  });
  it('flags every track already in the playlist', () => {
    expect(splitDuplicates(entries, ['b', 'a'])).toEqual({ duplicates: ['b', 'a'], fresh: [] });
  });
  it('splits a partial overlap in selection order', () => {
    expect(splitDuplicates(entries, ['c', 'a', 'd'])).toEqual({ duplicates: ['a'], fresh: ['c', 'd'] });
  });
  it('keeps repeated selection ids', () => {
    expect(splitDuplicates(entries, ['a', 'c', 'a', 'c'])).toEqual({ duplicates: ['a', 'a'], fresh: ['c', 'c'] });
  });
});
