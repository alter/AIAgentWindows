// screen-reader.ts
import { Terminal } from '@xterm/headless';

export class ScreenReader {
  private readonly terminal: Terminal;

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  async text(): Promise<string> {
    await new Promise<void>((resolve) => this.terminal.write('', resolve));
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < this.terminal.rows; row += 1) lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
    return lines.join('\n');
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
