// site-layout.test.ts
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_WINDOW,
  DESKTOP_MIN_WIDTH,
  NAV_BAR_HEIGHT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_STEP,
  SIDEBAR_WIDTH,
  clampSidebarWidth,
  maxSidebarWidth,
  parseSidebarWidth,
  isSidebarWidth,
  sidebarWidthForKey,
  siteBounds,
} from '../../src/shared/site-layout';

describe('siteBounds', () => {
  it('places the view right of the sidebar and below the navigation bar', () => {
    expect(siteBounds(SIDEBAR_WIDTH, 1200, 800)).toEqual({
      x: SIDEBAR_WIDTH,
      y: NAV_BAR_HEIGHT,
      width: 1200 - SIDEBAR_WIDTH,
      height: 800 - NAV_BAR_HEIGHT,
    });
  });

  it('never returns a negative size for a window smaller than the chrome', () => {
    expect(siteBounds(SIDEBAR_WIDTH, 100, 10)).toEqual({ x: SIDEBAR_WIDTH, y: NAV_BAR_HEIGHT, width: 0, height: 0 });
  });

  it('rounds fractional content sizes down', () => {
    const bounds = siteBounds(SIDEBAR_WIDTH, 1200.7, 800.9);
    expect(Number.isInteger(bounds.width)).toBe(true);
    expect(Number.isInteger(bounds.height)).toBe(true);
  });
});

describe('siteBounds with a custom sidebar width', () => {
  it('starts the view at the given width and shrinks it by the same amount', () => {
    expect(siteBounds(400, 1200, 800)).toEqual({ x: 400, y: NAV_BAR_HEIGHT, width: 800, height: 800 - NAV_BAR_HEIGHT });
  });
});

describe('sidebar width limits', () => {
  it('allows half the window, never above 600 and never below 180', () => {
    expect(maxSidebarWidth(1000)).toBe(500);
    expect(maxSidebarWidth(1200)).toBe(SIDEBAR_MAX);
    expect(maxSidebarWidth(3000)).toBe(SIDEBAR_MAX);
    expect(maxSidebarWidth(300)).toBe(SIDEBAR_MIN);
    expect(maxSidebarWidth(1001)).toBe(500);
  });

  it('clamps a width into the limits and rounds it to an integer', () => {
    expect(clampSidebarWidth(50, 1200)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(900, 1200)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(900, 800)).toBe(400);
    expect(clampSidebarWidth(333.6, 1200)).toBe(334);
    expect(clampSidebarWidth(Number.NaN, 1200)).toBe(SIDEBAR_WIDTH);
  });

  it('reads a stored width: only an integer in range, otherwise the default', () => {
    expect(parseSidebarWidth(320)).toBe(320);
    expect(parseSidebarWidth(SIDEBAR_MIN)).toBe(SIDEBAR_MIN);
    expect(parseSidebarWidth(SIDEBAR_MAX)).toBe(SIDEBAR_MAX);
    for (const value of [undefined, null, 179, 601, 300.5, '300', Number.NaN, Infinity, [], {}]) {
      expect(parseSidebarWidth(value)).toBe(SIDEBAR_WIDTH);
    }
  });

  it('tells a valid width from an invalid one', () => {
    expect(isSidebarWidth(260)).toBe(true);
    expect(isSidebarWidth(180.5)).toBe(false);
    expect(isSidebarWidth('260')).toBe(false);
    expect(isSidebarWidth(601)).toBe(false);
  });
});

describe('sidebar width by key', () => {
  it('moves by one step with the arrows and clamps at the ends', () => {
    expect(sidebarWidthForKey('ArrowRight', 260, 1200)).toBe(260 + SIDEBAR_STEP);
    expect(sidebarWidthForKey('ArrowLeft', 260, 1200)).toBe(260 - SIDEBAR_STEP);
    expect(sidebarWidthForKey('ArrowLeft', SIDEBAR_MIN, 1200)).toBe(SIDEBAR_MIN);
    expect(sidebarWidthForKey('ArrowRight', SIDEBAR_MAX, 1200)).toBe(SIDEBAR_MAX);
    expect(sidebarWidthForKey('ArrowRight', 490, 1000)).toBe(500);
  });

  it('jumps to the limits with Home and End', () => {
    expect(sidebarWidthForKey('Home', 300, 1200)).toBe(SIDEBAR_MIN);
    expect(sidebarWidthForKey('End', 300, 1200)).toBe(SIDEBAR_MAX);
    expect(sidebarWidthForKey('End', 300, 800)).toBe(400);
  });

  it('ignores every other key', () => {
    expect(sidebarWidthForKey('Enter', 300, 1200)).toBeNull();
    expect(sidebarWidthForKey('a', 300, 1200)).toBeNull();
  });
});

describe('capture window', () => {
  it('gives the site view a desktop-sized area', () => {
    const bounds = siteBounds(SIDEBAR_WIDTH, CAPTURE_WINDOW.width, CAPTURE_WINDOW.height);
    expect(bounds.width).toBeGreaterThanOrEqual(DESKTOP_MIN_WIDTH);
    expect(bounds.height).toBeGreaterThanOrEqual(800);
  });
});
