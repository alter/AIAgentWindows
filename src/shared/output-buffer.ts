// output-buffer.ts
export const OUTPUT_BACKLOG_LIMIT = 256 * 1024;

export interface OutputSnapshot {
  data: string;
  end: number;
}

export class OutputBuffer {
  private chunks: string[] = [];
  private size = 0;
  private total = 0;

  constructor(private readonly limit: number = OUTPUT_BACKLOG_LIMIT) {}

  append(data: string): number {
    if (data.length === 0) return this.total;
    this.total += data.length;
    const chunk = data.length > this.limit ? data.slice(data.length - this.limit) : data;
    this.chunks.push(chunk);
    this.size += chunk.length;
    this.trim();
    return this.total;
  }

  snapshot(): OutputSnapshot {
    return { data: this.chunks.join(''), end: this.total };
  }

  private trim(): void {
    while (this.size > this.limit) {
      const first = this.chunks[0] as string;
      const excess = this.size - this.limit;
      if (first.length <= excess) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        this.chunks[0] = first.slice(excess);
        this.size -= excess;
      }
    }
  }
}
