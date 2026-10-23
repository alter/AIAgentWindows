// popup-place.ts
export const POPUP_MARGIN = 8;

export interface PopupAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

export interface PopupPlace {
  top: number;
  left: number;
  maxHeight: number;
}

export function pointAnchor(x: number, y: number): PopupAnchor {
  return { left: x, top: y, right: x, bottom: y };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

export function placePopup(anchor: PopupAnchor, size: PopupSize, viewport: PopupSize, margin: number = POPUP_MARGIN): PopupPlace {
  const room = Math.max(0, viewport.height - 2 * margin);
  const below = viewport.height - margin - anchor.bottom;
  const above = anchor.top - margin;
  const flip = size.height > below && above > below;
  const maxHeight = clamp(flip ? above : below, 0, room);
  const height = Math.min(size.height, maxHeight);
  const wanted = flip ? anchor.top - height : anchor.bottom;
  return {
    top: clamp(wanted, margin, viewport.height - margin - height),
    left: clamp(anchor.left, margin, viewport.width - margin - size.width),
    maxHeight,
  };
}
