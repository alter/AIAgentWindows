// generic-adapter.ts
import { MAX_REPLY_CHARS } from '../../shared/room-model';
import {
  genericComposerScript,
  genericEnterScript,
  genericInsertScript,
  genericSendButtonScript,
  genericStateScript,
} from './generic-scripts';
import { callPage } from './page-call';
import { extractReply } from './reply-lines';
import { SiteAdapterError, type PageRunner, type SiteAdapter } from './types';

export interface GenericOptions {
  quietMs: number;
  submitCheckMs: number;
  maxReplyChars: number;
}

export const DEFAULT_GENERIC_OPTIONS: GenericOptions = {
  quietMs: 3000,
  submitCheckMs: 400,
  maxReplyChars: MAX_REPLY_CHARS,
};

export const FILE_INPUT_SELECTOR = 'input[type="file"]';

interface PageState {
  stop: boolean;
  reply: string | null;
}

interface PageSnapshot {
  stop: boolean;
  text: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGenericAdapter(site: string, options: GenericOptions = DEFAULT_GENERIC_OPTIONS): SiteAdapter {
  let prompt: string | null = null;
  let before = '';
  let submitted = false;
  let lastSeen: string | null = null;
  let changedAt = 0;

  async function readState(runner: PageRunner): Promise<PageState> {
    if (!submitted || prompt === null) return { stop: false, reply: null };
    const reply = await callPage(runner, genericStateScript());
    const value = reply.value as PageSnapshot;
    const found = extractReply(value.text, before, prompt);
    const text = found === null ? null : found.slice(0, options.maxReplyChars);
    if (text !== lastSeen) {
      lastSeen = text;
      changedAt = Date.now();
    }
    return { stop: value.stop, reply: text };
  }

  return {
    site,
    async insertText(runner, text) {
      submitted = false;
      lastSeen = null;
      const reply = await callPage(runner, genericInsertScript(text));
      if (reply.value !== true) throw new SiteAdapterError('page-error', 'the composer did not keep the inserted text');
      prompt = text;
    },
    async submit(runner) {
      const entered = await callPage(runner, genericEnterScript());
      before = typeof entered.value === 'string' ? entered.value : '';
      submitted = true;
      await sleep(options.submitCheckMs);
      await callPage(runner, genericSendButtonScript());
    },
    async isGenerating(runner) {
      const state = await readState(runner);
      return state.stop || (state.reply !== null && Date.now() - changedAt < options.quietMs);
    },
    async lastReply(runner) {
      return (await readState(runner)).reply;
    },
    async composerReady(runner) {
      try {
        return (await callPage(runner, genericComposerScript())).value === true;
      } catch (error) {
        if (error instanceof SiteAdapterError && error.code === 'page-gone') throw error;
        return false;
      }
    },
    async attachFile(runner, path) {
      if (runner.setInputFiles === undefined) {
        throw new SiteAdapterError('attach-unsupported', `${site} cannot set files on this page`);
      }
      await runner.setInputFiles(FILE_INPUT_SELECTOR, [path]);
    },
  };
}
