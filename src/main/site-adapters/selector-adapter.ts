// selector-adapter.ts
import { insertTextScript, isGeneratingScript, lastReplyScript, submitScript } from './page-scripts';
import { SiteAdapterError, type PageRunner, type SelectorSet, type SiteAdapter } from './types';

interface PageReply {
  ok: boolean;
  error?: string;
  detail?: string;
  value?: unknown;
}

const CODES = new Set(['input-missing', 'submit-unavailable']);

function parse(raw: unknown): PageReply {
  if (typeof raw !== 'string') throw new SiteAdapterError('page-error', 'page script returned no result');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed as PageReply;
  } catch {
    // falls through to the error below
  }
  throw new SiteAdapterError('page-error', 'page script returned unreadable result');
}

async function call(runner: PageRunner, code: string): Promise<PageReply> {
  const reply = parse(await runner.run(code));
  if (reply.ok) return reply;
  const known = reply.error !== undefined && CODES.has(reply.error);
  if (known) throw new SiteAdapterError(reply.error as 'input-missing' | 'submit-unavailable', reply.error as string);
  throw new SiteAdapterError('page-error', reply.detail ?? 'page script failed');
}

export function createSelectorAdapter(site: string, selectors: SelectorSet): SiteAdapter {
  return {
    site,
    async insertText(runner, text) {
      const reply = await call(runner, insertTextScript(selectors.input, text));
      if (reply.value !== true) throw new SiteAdapterError('page-error', 'the input did not keep the inserted text');
    },
    async submit(runner) {
      await call(runner, submitScript(selectors.input, selectors.submit));
    },
    async isGenerating(runner) {
      const reply = await call(runner, isGeneratingScript(selectors.stop));
      return reply.value === true;
    },
    async lastReply(runner) {
      const reply = await call(runner, lastReplyScript(selectors.replies));
      return typeof reply.value === 'string' ? reply.value : null;
    },
    async attachFile(runner, path) {
      if (selectors.fileInput === undefined || runner.setInputFiles === undefined) {
        throw new SiteAdapterError('attach-unsupported', `${site} has no file input to set files on`);
      }
      await runner.setInputFiles(selectors.fileInput, [path]);
    },
  };
}
