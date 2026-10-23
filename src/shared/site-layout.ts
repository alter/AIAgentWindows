// site-layout.ts
export const SIDEBAR_WIDTH = 260;
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 600;
export const SIDEBAR_STEP = 16;
export const NAV_BAR_HEIGHT = 36;
export const CAPTURE_WINDOW = { width: 1600, height: 1000 } as const;
export const DESKTOP_MIN_WIDTH = 1280;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function siteBounds(sidebarWidth: number, contentWidth: number, contentHeight: number): Bounds {
  return {
    x: sidebarWidth,
    y: NAV_BAR_HEIGHT,
    width: Math.max(0, Math.floor(contentWidth) - sidebarWidth),
    height: Math.max(0, Math.floor(contentHeight) - NAV_BAR_HEIGHT),
  };
}

export function maxSidebarWidth(windowWidth: number): number {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.floor(windowWidth / 2)));
}

export function clampSidebarWidth(width: number, windowWidth: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH;
  return Math.min(maxSidebarWidth(windowWidth), Math.max(SIDEBAR_MIN, Math.round(width)));
}

export function isSidebarWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= SIDEBAR_MIN && value <= SIDEBAR_MAX;
}

export function parseSidebarWidth(value: unknown): number {
  return isSidebarWidth(value) ? value : SIDEBAR_WIDTH;
}

export function sidebarWidthForKey(key: string, width: number, windowWidth: number): number | null {
  if (key === 'ArrowLeft') return clampSidebarWidth(width - SIDEBAR_STEP, windowWidth);
  if (key === 'ArrowRight') return clampSidebarWidth(width + SIDEBAR_STEP, windowWidth);
  if (key === 'Home') return SIDEBAR_MIN;
  if (key === 'End') return maxSidebarWidth(windowWidth);
  return null;
}
