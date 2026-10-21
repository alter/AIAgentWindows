// site-layout.test.ts
import { describe, expect, it } from 'vitest';
import { CAPTURE_WINDOW, DESKTOP_MIN_WIDTH, NAV_BAR_HEIGHT, SIDEBAR_WIDTH, siteBounds } from '../../src/shared/site-layout';

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

describe('capture window', () => {
  it('gives the site view a desktop-sized area', () => {
    const bounds = siteBounds(CAPTURE_WINDOW.width, CAPTURE_WINDOW.height);
    expect(bounds.width).toBeGreaterThanOrEqual(DESKTOP_MIN_WIDTH);
    expect(bounds.height).toBeGreaterThanOrEqual(800);
  });
});
