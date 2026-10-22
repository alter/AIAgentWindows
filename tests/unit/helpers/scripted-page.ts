// scripted-page.ts
import {
  genericComposerScript,
  genericComposerStateScript,
  genericDomScript,
  genericEnterScript,
  genericInsertScript,
  genericStateScript,
} from '../../../src/main/site-adapters/generic-scripts';
import type { PageRunner } from '../../../src/main/site-adapters/types';

export const SCRIPT_PROMPT = 'Explain the relay rounds in detail please';
export const SCRIPT_BEFORE = 'Earlier chat line one\nEarlier chat line two';
export const SCRIPT_DOM = '<main id="log">SCRIPTED-DOM</main>';

export interface ScriptedFrame {
  from: number;
  lines: string[];
  stop: boolean;
}

export interface ScriptedPage {
  runner: PageRunner;
  open(): void;
}

function ok(value: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: true, value, ...extra });
}

export function scriptedPage(prompt: string, frames: readonly ScriptedFrame[], now: () => number = Date.now): ScriptedPage {
  let submittedAt = now();
  const frameAt = (elapsed: number): ScriptedFrame => {
    let current = frames[0] as ScriptedFrame;
    for (const frame of frames) if (frame.from <= elapsed) current = frame;
    return current;
  };
  const runner: PageRunner = {
    run(code) {
      if (code === genericInsertScript(prompt)) return Promise.resolve(ok(true, { length: prompt.length, kind: 'textarea', count: 1 }));
      if (code === genericEnterScript()) {
        submittedAt = now();
        return Promise.resolve(ok(SCRIPT_BEFORE));
      }
      if (code === genericComposerStateScript()) return Promise.resolve(ok({ empty: true, visible: 1 }));
      if (code === genericComposerScript()) return Promise.resolve(ok(true));
      if (code === genericDomScript()) return Promise.resolve(ok(SCRIPT_DOM));
      if (code === genericStateScript()) {
        const frame = frameAt(now() - submittedAt);
        const text = [...SCRIPT_BEFORE.split('\n'), prompt, ...frame.lines].join('\n');
        return Promise.resolve(ok({ stop: frame.stop, text, accepting: !frame.stop, frames: 5 }));
      }
      return Promise.reject(new Error('unexpected page script'));
    },
  };
  return { runner, open: () => undefined };
}

export const ANSWER_FRAMES: readonly ScriptedFrame[] = [
  { from: 0, lines: [], stop: false },
  { from: 100, lines: ['First part of the scripted answer arrives'], stop: true },
  { from: 300, lines: ['First part of the scripted answer arrives', 'Second part of the scripted answer arrives'], stop: true },
  { from: 500, lines: ['First part of the scripted answer arrives', 'Second part of the scripted answer arrives'], stop: false },
];
