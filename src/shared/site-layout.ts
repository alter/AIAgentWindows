// site-layout.ts
export const SIDEBAR_WIDTH = 260;
export const NAV_BAR_HEIGHT = 36;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function siteBounds(contentWidth: number, contentHeight: number): Bounds {
  return {
    x: SIDEBAR_WIDTH,
    y: NAV_BAR_HEIGHT,
    width: Math.max(0, Math.floor(contentWidth) - SIDEBAR_WIDTH),
    height: Math.max(0, Math.floor(contentHeight) - NAV_BAR_HEIGHT),
  };
}
