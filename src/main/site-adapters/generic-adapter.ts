// generic-adapter.ts
import { MAX_REPLY_CHARS } from '../../shared/room-model';
import type { SiteLogValue } from '../../shared/site-log';
import {
  genericComposerScript,
  genericComposerStateScript,
  genericEnterScript,
  genericFocusScript,
  genericInsertScript,
  genericSendButtonScript,
  genericStateScript,
} from './generic-scripts';
import { callPage } from './page-call';
import { describeLines, extractAnchoredReply, isAnswerStart, type ReplyDrops } from './reply-lines';
import { SiteAdapterError, type PageRunner, type SiteAdapter } from './types';

export interface GenericOptions {
  quietMs: number;
  confirmMs: number;
  confirmPollMs: number;
  maxReplyChars: number;
}

export const DEFAULT_GENERIC_OPTIONS: GenericOptions = {
  quietMs: 5000,
  confirmMs: 1500,
  confirmPollMs: 50,
  maxReplyChars: MAX_REPLY_CHARS,
};

export const FILE_INPUT_SELECTOR = 'input[type="file"]';

interface PageSnapshot {
  stop: boolean;
  text: string;
  accepting: boolean;
  frames?: number;
}

interface ComposerState {
  empty: boolean;
  visible: number;
}

interface PageState {
  stop: boolean;
  accepting: boolean;
  text: string;
  reply: string | null;
}

const NO_DROPS: ReplyDrops = { seen: 0, echo: 0, marker: 0, label: 0 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGenericAdapter(site: string, options: GenericOptions = DEFAULT_GENERIC_OPTIONS): SiteAdapter {
  let prompt: string | null = null;
  let before = '';
  let submitted = false;
  let submittedAt = 0;
  let echoFound = false;
  let keyHits = 0;
  let anchorRank = -1;
  let hitsAtLineStart = 0;
  let lastText = '';
  let visibleComposers = 0;
  let composerClearedMs = -1;
  let lastSeen: string | null = null;
  let changedAt = 0;
  let started = false;
  let firstGrowthMs = -1;
  let stopSeen = false;
  let composerKind = 'none';
  let inserted = 0;
  let submitPath = 'none';
  let drops = NO_DROPS;
  let idleText: string | null = null;
  let idleSince = 0;
  let settledText: string | null = null;
  let frames = -1;
  let textLenBefore = -1;
  let textLenAtEnd = -1;

  async function snapshot(runner: PageRunner): Promise<PageSnapshot> {
    return (await callPage(runner, genericStateScript())).value as PageSnapshot;
  }

  async function readState(runner: PageRunner): Promise<PageState> {
    if (!submitted || prompt === null) return { stop: false, accepting: false, text: '', reply: null };
    const value = await snapshot(runner);
    const found = extractAnchoredReply(value.text, before, prompt);
    drops = found.dropped;
    echoFound = found.echoFound;
    keyHits = found.keyHits;
    anchorRank = found.anchorRank;
    hitsAtLineStart = found.hitsAtLineStart;
    lastText = value.text;
    const now = Date.now();
    if (value.stop) stopSeen = true;
    textLenAtEnd = value.text.length;
    frames = typeof value.frames === 'number' ? value.frames : -1;
    const text = started || isAnswerStart(found.reply) ? found.reply : null;
    if (text !== null && !started) {
      started = true;
      firstGrowthMs = now - submittedAt;
    }
    if (text !== lastSeen) {
      lastSeen = text;
      changedAt = now;
    }
    return {
      stop: value.stop,
      accepting: value.accepting,
      text: value.text,
      reply: text === null ? null : text.slice(0, options.maxReplyChars),
    };
  }

  async function confirmCleared(runner: PageRunner, since: number): Promise<boolean> {
    const begun = Date.now();
    for (;;) {
      const state = (await callPage(runner, genericComposerStateScript())).value as ComposerState;
      visibleComposers = state.visible;
      if (state.empty) {
        composerClearedMs = Date.now() - since;
        return true;
      }
      if (Date.now() - begun >= options.confirmMs) return false;
      await sleep(options.confirmPollMs);
    }
  }

  return {
    site,
    async insertText(runner, text) {
      submitted = false;
      lastSeen = null;
      started = false;
      firstGrowthMs = -1;
      stopSeen = false;
      composerKind = 'none';
      inserted = 0;
      submitPath = 'none';
      echoFound = false;
      keyHits = 0;
      anchorRank = -1;
      hitsAtLineStart = 0;
      lastText = '';
      visibleComposers = 0;
      composerClearedMs = -1;
      drops = NO_DROPS;
      idleText = null;
      frames = -1;
      textLenBefore = -1;
      textLenAtEnd = -1;
      const reply = await callPage(runner, genericInsertScript(text));
      composerKind = reply.kind ?? 'none';
      inserted = reply.length ?? 0;
      visibleComposers = reply.count ?? 0;
      if (reply.value !== true) throw new SiteAdapterError('page-error', 'the composer did not keep the inserted text');
      prompt = text;
    },
    async submit(runner) {
      const entered = await callPage(runner, genericEnterScript());
      before = typeof entered.value === 'string' ? entered.value : '';
      textLenBefore = before.length;
      submitted = true;
      submittedAt = Date.now();
      submitPath = 'enter';
      if (await confirmCleared(runner, submittedAt)) return;
      const sent = await callPage(runner, genericSendButtonScript());
      if (sent.value === 'clicked') {
        submitPath = 'button';
        if (await confirmCleared(runner, submittedAt)) return;
      }
      if (runner.sendEnter !== undefined) {
        await callPage(runner, genericFocusScript());
        await runner.sendEnter();
        submitPath = 'trusted';
        if (await confirmCleared(runner, submittedAt)) return;
      }
      submitPath = 'unconfirmed';
      throw new SiteAdapterError('not-submitted', `${site} did not accept the prompt: the composer stayed full`);
    },
    async isGenerating(runner) {
      const state = await readState(runner);
      if (state.stop) return true;
      if (!started) return false;
      const generating = Date.now() - changedAt < options.quietMs || !state.accepting;
      if (!generating) settledText = state.text;
      return generating;
    },
    async lastReply(runner) {
      return (await readState(runner)).reply;
    },
    async isIdle(runner) {
      const value = await snapshot(runner);
      const now = Date.now();
      if (value.text !== idleText) {
        idleText = value.text;
        idleSince = now;
      }
      if (value.stop || !value.accepting) return false;
      return value.text === settledText || now - idleSince >= options.quietMs;
    },
    echoSeen() {
      return echoFound;
    },
    trace(): Readonly<Record<string, SiteLogValue>> {
      return {
        composer: composerKind,
        inserted,
        submit: submitPath,
        composerClearedMs,
        echoFound,
        keyHits,
        anchorRank,
        hitsAtLineStart,
        visibleComposers,
        firstGrowthMs,
        stopSeen,
        frames,
        textLenBefore,
        textLenAtEnd,
        quietForMs: started ? Date.now() - changedAt : -1,
        droppedSeen: drops.seen,
        droppedEcho: drops.echo,
        droppedMarker: drops.marker,
        droppedLabel: drops.label,
      };
    },
    lineReport(): Readonly<Record<string, SiteLogValue>> | null {
      if (!submitted || prompt === null) return null;
      return { ...describeLines(lastText, before, prompt) };
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
