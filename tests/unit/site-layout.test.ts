// site-layout.test.ts
import { describe, expect, it } from 'vitest';
import { NAV_BAR_HEIGHT, SIDEBAR_WIDTH, siteBounds } from '../../src/shared/site-layout';

describe('siteBounds', () => {
  it('places the view right of the sidebar and below the navigation bar', () => {
    expect(siteBounds(1200, 800)).toEqual({
      x: SIDEBAR_WIDTH,
      y: NAV_BAR_HEIGHT,
      width: 1200 - SIDEBAR_WIDTH,
      height: 800 - NAV_BAR_HEIGHT,
    });
  });

  it('never returns a negative size for a window smaller than the chrome', () => {
    expect(siteBounds(100, 10)).toEqual({ x: SIDEBAR_WIDTH, y: NAV_BAR_HEIGHT, width: 0, height: 0 });
  });

  it('rounds fractional content sizes down', () => {
    const bounds = siteBounds(1200.7, 800.9);
    expect(Number.isInteger(bounds.width)).toBe(true);
    expect(Number.isInteger(bounds.height)).toBe(true);
  });
});
