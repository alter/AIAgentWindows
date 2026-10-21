// types.ts
export interface PageRunner {
  run(code: string): Promise<unknown>;
  setInputFiles?(selector: string, paths: string[]): Promise<void>;
}

export interface SelectorSet {
  input: string;
  submit?: string;
  stop?: string;
  replies: string;
  fileInput?: string;
}

export interface SiteAdapter {
  readonly site: string;
  insertText(runner: PageRunner, text: string): Promise<void>;
  submit(runner: PageRunner): Promise<void>;
  isGenerating(runner: PageRunner): Promise<boolean>;
  lastReply(runner: PageRunner): Promise<string | null>;
  attachFile(runner: PageRunner, path: string): Promise<void>;
}

export type SiteAdapterErrorCode =
  | 'input-missing'
  | 'submit-unavailable'
  | 'attach-unsupported'
  | 'page-error'
  | 'page-gone'
  | 'no-response'
  | 'timeout';

export class SiteAdapterError extends Error {
  constructor(
    readonly code: SiteAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SiteAdapterError';
  }
}
