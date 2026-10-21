// terminal-pane.ts
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { PtyBacklog, PtyDataEvent } from '../shared/ipc';
import { dropPastePayload, rawKeySequence, sanitizePaste } from '../shared/terminal-input';
import { api } from './api';
import { el } from './dom';

export interface TerminalIo {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  backlog(): Promise<PtyBacklog>;
  restart?(): Promise<boolean>;
}

export function agentIo(id: string): TerminalIo {
  return {
    write: (data) => void api.ptyWrite(id, data),
    resize: (cols, rows) => void api.ptyResize(id, cols, rows),
    backlog: () => api.ptyBacklog(id),
    restart: () => api.restartAgent(id),
  };
}

export function roomSessionIo(id: string): TerminalIo {
  return {
    write: (data) => void api.roomTerminalWrite(id, data),
    resize: (cols, rows) => void api.roomTerminalResize(id, cols, rows),
    backlog: () => api.roomTerminalBacklog(id),
  };
}

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
  private readonly host = el('div', 'terminal-host');
  private readonly fit = new FitAddon();
  private readonly restartButton = el('button', 'restart-button', 'Restart');
  private opened = false;
  private hydrated = false;
  private hydratedEnd = 0;
  private pending: PtyDataEvent[] = [];

  constructor(private readonly io: TerminalIo) {
    this.element.hidden = true;
    this.restartButton.type = 'button';
    this.restartButton.hidden = true;
    this.restartButton.addEventListener('click', () => void this.restart());
    this.element.append(this.host, this.restartButton);
    this.terminal.loadAddon(this.fit);
    this.terminal.attachCustomKeyEventHandler((event) => this.handleKey(event));
    this.terminal.onData((data) => this.io.write(data));
    this.terminal.onResize(({ cols, rows }) => this.io.resize(cols, rows));
    this.element.addEventListener('paste', (event) => this.handlePaste(event), true);
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
    this.restartButton.hidden = this.io.restart === undefined;
  }

  private async restart(): Promise<void> {
    this.restartButton.disabled = true;
    const started = (await this.io.restart?.()) ?? false;
    this.restartButton.disabled = false;
    if (started) this.restartButton.hidden = true;
    this.terminal.focus();
  }

  show(): void {
    this.element.hidden = false;
    if (!this.opened) {
      this.opened = true;
      this.terminal.open(this.host);
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
    const backlog = await this.io.backlog();
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
      this.io.write(sequence);
    }
    return false;
  }

  private handlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const text = sanitizePaste(event.clipboardData?.getData('text/plain') ?? '');
    if (text.length > 0) this.terminal.paste(text);
  }

  private handleDrop(event: DragEvent): void {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    const payload = dropPastePayload(files.map((file) => api.pathForFile(file)));
    if (payload.length > 0) this.terminal.paste(sanitizePaste(payload));
    this.terminal.focus();
  }
}
