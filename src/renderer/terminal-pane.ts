// terminal-pane.ts
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { PtyDataEvent } from '../shared/ipc';
import { dropPastePayload, rawKeySequence } from '../shared/terminal-input';
import { api } from './api';
import { el } from './dom';

export class TerminalPane {
  readonly element = el('div', 'terminal-pane');
  private readonly terminal = new Terminal({
    cursorBlink: true,
    macOptionIsMeta: true,
    scrollback: 5000,
    fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
    fontSize: 13,
    theme: { background: '#1a1d21', foreground: '#d1d2d3' },
  });
  private readonly fit = new FitAddon();
  private opened = false;
  private hydrated = false;
  private hydratedEnd = 0;
  private pending: PtyDataEvent[] = [];

  constructor(private readonly id: string) {
    this.element.hidden = true;
    this.terminal.loadAddon(this.fit);
    this.terminal.attachCustomKeyEventHandler((event) => this.handleKey(event));
    this.terminal.onData((data) => void api.ptyWrite(this.id, data));
    this.terminal.onResize(({ cols, rows }) => void api.ptyResize(this.id, cols, rows));
    this.element.addEventListener('dragover', (event) => event.preventDefault());
    this.element.addEventListener('drop', (event) => this.handleDrop(event));
    void this.hydrate();
  }

  push(event: PtyDataEvent): void {
    if (!this.hydrated) {
      this.pending.push(event);
      return;
    }
    this.write(event);
  }

  exited(exitCode: number): void {
    this.terminal.write(`\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`);
  }

  show(): void {
    this.element.hidden = false;
    if (!this.opened) {
      this.opened = true;
      this.terminal.open(this.element);
    }
    this.refit();
    this.terminal.focus();
  }

  hide(): void {
    this.element.hidden = true;
  }

  refit(): void {
    if (this.element.hidden || this.element.clientWidth === 0 || this.element.clientHeight === 0) return;
    this.fit.fit();
  }

  dispose(): void {
    this.terminal.dispose();
    this.element.remove();
  }

  private async hydrate(): Promise<void> {
    const backlog = await api.ptyBacklog(this.id);
    if (backlog.data.length > 0) this.terminal.write(backlog.data);
    this.hydratedEnd = backlog.end;
    this.hydrated = true;
    const queued = this.pending;
    this.pending = [];
    for (const event of queued) this.write(event);
  }

  private write(event: PtyDataEvent): void {
    if (event.end <= this.hydratedEnd) return;
    this.hydratedEnd = event.end;
    this.terminal.write(event.data);
  }

  private handleKey(event: KeyboardEvent): boolean {
    const sequence = rawKeySequence(event);
    if (sequence === null) return true;
    if (event.type === 'keydown') {
      event.preventDefault();
      void api.ptyWrite(this.id, sequence);
    }
    return false;
  }

  private handleDrop(event: DragEvent): void {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    const payload = dropPastePayload(files.map((file) => api.pathForFile(file)));
    if (payload.length > 0) this.terminal.paste(payload);
    this.terminal.focus();
  }
}
