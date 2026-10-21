// pty-manager.ts
import * as pty from 'node-pty';
import type { SpawnSpec } from '../shared/cli-args';

export interface PtyListeners {
  onData(id: string, data: string): void;
  onExit(id: string, exitCode: number, signal: number | undefined): void;
}

export interface PtySize {
  cols: number;
  rows: number;
}

const DEFAULT_SIZE: PtySize = { cols: 80, rows: 24 };

export class PtyManager {
  private readonly sessions = new Map<string, pty.IPty>();

  constructor(private readonly listeners: PtyListeners) {}

  spawn(id: string, spec: SpawnSpec, size: PtySize = DEFAULT_SIZE): number {
    if (this.sessions.has(id)) throw new Error(`pty ${id} already exists`);
    const terminal = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: spec.cwd,
      env: spec.env,
    });
    this.sessions.set(id, terminal);
    terminal.onData((data) => this.listeners.onData(id, data));
    terminal.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id);
      this.listeners.onExit(id, exitCode, signal);
    });
    return terminal.pid;
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  write(id: string, data: string): boolean {
    const terminal = this.sessions.get(id);
    if (!terminal) return false;
    terminal.write(data);
    return true;
  }

  resize(id: string, size: PtySize): boolean {
    const terminal = this.sessions.get(id);
    if (!terminal) return false;
    terminal.resize(size.cols, size.rows);
    return true;
  }

  kill(id: string): boolean {
    const terminal = this.sessions.get(id);
    if (!terminal) return false;
    terminal.kill();
    return true;
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}
