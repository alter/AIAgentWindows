// selector-adapter.ts
import { insertTextScript, isGeneratingScript, lastReplyScript, submitScript } from './page-scripts';
import { callPage as call } from './page-call';
import { SiteAdapterError, type SelectorSet, type SiteAdapter } from './types';

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
