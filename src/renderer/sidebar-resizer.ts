// sidebar-resizer.ts
import { SIDEBAR_MIN, SIDEBAR_WIDTH, clampSidebarWidth, maxSidebarWidth, sidebarWidthForKey } from '../shared/site-layout';
import { el } from './dom';

const REPORT_INTERVAL_MS = 50;

export class SidebarResizer {
  readonly element = el('div', 'sidebar-divider');
  private width: number;
  private dragging = false;
  private reported: number;
  private timer: number | null = null;

  constructor(initial: number, private readonly report: (width: number) => void) {
    this.width = clampSidebarWidth(initial, window.innerWidth);
    this.reported = this.width;
    const node = this.element;
    node.setAttribute('role', 'separator');
    node.setAttribute('aria-orientation', 'vertical');
    node.setAttribute('aria-label', 'Sidebar width');
    node.tabIndex = 0;
    node.addEventListener('pointerdown', (event) => this.start(event));
    node.addEventListener('pointermove', (event) => this.move(event));
    node.addEventListener('pointerup', (event) => this.end(event));
    node.addEventListener('pointercancel', (event) => this.end(event));
    node.addEventListener('keydown', (event) => this.key(event));
    node.addEventListener('dblclick', () => this.apply(SIDEBAR_WIDTH, true));
    window.addEventListener('resize', () => this.apply(this.width, false));
    this.paint();
  }

  currentWidth(): number {
    return this.width;
  }

  private start(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragging = true;
    this.element.setPointerCapture(event.pointerId);
    this.element.classList.add('dragging');
  }

  private move(event: PointerEvent): void {
    if (!this.dragging) return;
    this.apply(event.clientX, false);
  }

  private end(event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.element.classList.remove('dragging');
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    this.flush();
  }

  private key(event: KeyboardEvent): void {
    const next = sidebarWidthForKey(event.key, this.width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    this.apply(next, true);
  }

  private apply(requested: number, immediate: boolean): void {
    this.width = clampSidebarWidth(requested, window.innerWidth);
    this.paint();
    if (immediate) this.flush();
    else this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null || this.width === this.reported) return;
    this.timer = window.setTimeout(() => this.flush(), REPORT_INTERVAL_MS);
  }

  private flush(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.width === this.reported) return;
    this.reported = this.width;
    this.report(this.width);
  }

  private paint(): void {
    document.documentElement.style.setProperty('--sidebar-width', `${this.width}px`);
    this.element.setAttribute('aria-valuenow', String(this.width));
    this.element.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
    this.element.setAttribute('aria-valuemax', String(maxSidebarWidth(window.innerWidth)));
  }
}
