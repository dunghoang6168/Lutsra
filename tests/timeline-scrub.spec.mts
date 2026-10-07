import { describe, expect, it } from 'vitest';
import { TimelineScrub, timelineFraction } from '../src/app/shared/utils/timeline-scrub';

describe('timeline scrub', () => {
  it('commits a click as exactly one seek target', () => {
    const scrub = new TimelineScrub();
    scrub.preview(42);
    expect(scrub.active).toBe(true);
    expect(scrub.end()).toBe(42);
    expect(scrub.active).toBe(false);
    expect(scrub.end()).toBeNull();
  });

  it('commits only the last position of a drag', () => {
    const scrub = new TimelineScrub();
    for (const time of [10, 11, 12.5, 30]) scrub.preview(time);
    expect(scrub.time()).toBe(30);
    expect(scrub.end()).toBe(30);
  });

  it('cancel drops the preview without a seek target', () => {
    const scrub = new TimelineScrub();
    scrub.preview(5);
    scrub.cancel();
    expect(scrub.active).toBe(false);
    expect(scrub.end()).toBeNull();
  });

  it('maps the pointer to a clamped fraction', () => {
    const rect = { left: 100, width: 200 };
    expect(timelineFraction(200, rect)).toBe(0.5);
    expect(timelineFraction(50, rect)).toBe(0);
    expect(timelineFraction(400, rect)).toBe(1);
    expect(timelineFraction(150, { left: 100, width: 0 })).toBeNull();
  });
});
