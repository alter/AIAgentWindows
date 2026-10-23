// popup.ts
import { placePopup, type PopupAnchor } from '../shared/popup-place';

const watchers = new WeakMap<HTMLElement, () => void>();

function place(popup: HTMLElement, anchor: () => PopupAnchor, width: (() => number) | undefined): void {
  const style = popup.style;
  style.position = 'fixed';
  style.visibility = 'hidden';
  style.overflowY = 'auto';
  style.maxHeight = 'none';
  style.top = '0px';
  style.left = '0px';
  style.width = width === undefined ? '' : `${width()}px`;
  const box = popup.getBoundingClientRect();
  const spot = placePopup(anchor(), { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight });
  style.top = `${spot.top}px`;
  style.left = `${spot.left}px`;
  style.maxHeight = `${spot.maxHeight}px`;
  style.visibility = '';
}

export function hidePopup(popup: HTMLElement): void {
  const watcher = watchers.get(popup);
  if (watcher !== undefined) window.removeEventListener('resize', watcher);
  watchers.delete(popup);
  popup.hidden = true;
}

export function showPopup(popup: HTMLElement, anchor: () => PopupAnchor, width?: () => number): void {
  hidePopup(popup);
  popup.hidden = false;
  const again = (): void => place(popup, anchor, width);
  watchers.set(popup, again);
  window.addEventListener('resize', again);
  again();
}

export function rectAnchor(node: Element, gap = 0): PopupAnchor {
  const box = node.getBoundingClientRect();
  return { left: box.left, top: box.top - gap, right: box.right, bottom: box.bottom + gap };
}
