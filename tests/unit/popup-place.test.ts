// popup-place.test.ts
import { describe, expect, it } from 'vitest';
import { placePopup, pointAnchor, POPUP_MARGIN } from '../../src/shared/popup-place';

const VIEW = { width: 800, height: 600 };
const BUTTON = { left: 100, top: 100, right: 200, bottom: 130 };

describe('popup placement', () => {
  it('opens below the anchor when the popup fits there', () => {
    const place = placePopup(BUTTON, { width: 200, height: 100 }, VIEW);
    expect(place).toEqual({ top: 130, left: 100, maxHeight: 600 - POPUP_MARGIN - 130 });
  });

  it('opens above when it does not fit below and there is more room above', () => {
    const anchor = { left: 100, top: 500, right: 200, bottom: 530 };
    const place = placePopup(anchor, { width: 200, height: 200 }, VIEW);
    expect(place).toEqual({ top: 300, left: 100, maxHeight: 500 - POPUP_MARGIN });
  });

  it('stays below when it fits nowhere and there is more room below', () => {
    const place = placePopup(BUTTON, { width: 200, height: 700 }, VIEW);
    expect(place.top).toBe(130);
    expect(place.maxHeight).toBe(600 - POPUP_MARGIN - 130);
  });

  it('stays below when both sides have the same room', () => {
    const anchor = { left: 0, top: 292, right: 10, bottom: 308 };
    const place = placePopup(anchor, { width: 50, height: 400 }, VIEW);
    expect(place.top).toBe(308);
  });

  it('gives a popup taller than the window the room of its side and the margin as top', () => {
    const anchor = { left: 100, top: 300, right: 200, bottom: 330 };
    const place = placePopup(anchor, { width: 200, height: 2000 }, VIEW);
    expect(place).toEqual({ top: POPUP_MARGIN, left: 100, maxHeight: 300 - POPUP_MARGIN });
  });

  it('never gives more than the window minus both margins', () => {
    const place = placePopup({ left: 0, top: 0, right: 10, bottom: 0 }, { width: 50, height: 5000 }, VIEW);
    expect(place.maxHeight).toBe(600 - 2 * POPUP_MARGIN);
  });

  it('pulls an anchor outside the window back inside the margin', () => {
    const anchor = { left: 100, top: 700, right: 200, bottom: 730 };
    const place = placePopup(anchor, { width: 200, height: 100 }, VIEW);
    expect(place.top).toBe(600 - POPUP_MARGIN - 100);
  });

  it('clamps horizontally at both sides', () => {
    const right = placePopup({ left: 780, top: 10, right: 790, bottom: 30 }, { width: 200, height: 50 }, VIEW);
    expect(right.left).toBe(800 - POPUP_MARGIN - 200);
    const left = placePopup({ left: -20, top: 10, right: 0, bottom: 30 }, { width: 200, height: 50 }, VIEW);
    expect(left.left).toBe(POPUP_MARGIN);
  });

  it('puts a popup wider than the window at the left margin', () => {
    expect(placePopup(BUTTON, { width: 2000, height: 50 }, VIEW).left).toBe(POPUP_MARGIN);
  });

  it('places a context menu at the pointer, above it near the bottom edge', () => {
    expect(placePopup(pointAnchor(120, 80), { width: 150, height: 90 }, VIEW)).toEqual({ top: 80, left: 120, maxHeight: 600 - POPUP_MARGIN - 80 });
    const near = placePopup(pointAnchor(790, 590), { width: 150, height: 90 }, VIEW);
    expect(near).toEqual({ top: 500, left: 800 - POPUP_MARGIN - 150, maxHeight: 590 - POPUP_MARGIN });
  });

  it('never returns a negative height for a window smaller than the margins', () => {
    const place = placePopup(pointAnchor(2, 2), { width: 50, height: 50 }, { width: 10, height: 10 });
    expect(place.maxHeight).toBe(0);
    expect(place.top).toBe(POPUP_MARGIN);
  });
});
