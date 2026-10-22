// types.ts
import type { SiteLogValue } from '../../shared/site-log';

export interface NetSink {
  event(name: string, fields?: Readonly<Record<string, SiteLogValue>>): void;
  saveBody(text: string): Promise<string | null>;
}

export interface NetWatch {
  stop(): Promise<void>;
}

export interface PageRunner {
  run(code: string): Promise<unknown>;
  sendEnter?(): Promise<void>;
  setInputFiles?(selector: string, paths: string[]): Promise<void>;
  watchNetwork?(sink: NetSink): Promise<NetWatch>;
}

export interface PollDrops {
  seen: number;
  echo: number;
  marker: number;
  label: number;
}

export interface PollProbe {
  before: string;
  text: string;
  stop: boolean;
  accepting: boolean;
  reply: string | null;
  started: boolean;
  drops: PollDrops;
  keyHits: number;
  anchorRank: number;
  hitsAtLineStart: number;
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
  composerReady?(runner: PageRunner): Promise<boolean>;
  isIdle?(runner: PageRunner): Promise<boolean>;
  echoSeen?(): boolean;
  trace?(): Readonly<Record<string, SiteLogValue>>;
  lineReport?(): Readonly<Record<string, SiteLogValue>> | null;
  probe?(): PollProbe | null;
  settings?(): Readonly<Record<string, number>>;
  domDump?(runner: PageRunner): Promise<string>;
}

export type SiteAdapterErrorCode =
  | 'input-missing'
  | 'submit-unavailable'
  | 'attach-unsupported'
  | 'page-error'
  | 'page-gone'
  | 'no-response'
  | 'not-submitted'
  | 'timeout'
  | 'not-ready'
  | 'aborted';

export class SiteAdapterError extends Error {
  constructor(
    readonly code: SiteAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SiteAdapterError';
  }
}
