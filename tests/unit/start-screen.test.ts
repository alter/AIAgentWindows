// start-screen.test.ts
import { describe, expect, it } from 'vitest';
import { blockingStartScreen } from '../../src/shared/start-screen';

const CODEX_UPDATE =
  '\x1b[2J\x1b[H  Update available · 0.159.2 → 0.163.0\r\n  Release notes: https://github.com/openai/codex/releases/latest\r\n\r\n› 1. Update now (runs `sh -c \'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh\'`)\r\n  2. Skip\r\n  3. Skip until next version\r\n\r\n  enter continue · esc skip';
const CODEX_TRUST = '  Folder access\r\n  Trust this folder? Codex can read, edit, and run files here.\r\n› 1. Trust and continue\r\n  enter continue · esc back';
const CLAUDE_TRUST = ' Quick safety check: Is this a project you created or one you trust?\r\n ❯ No, exit\r\n   Yes, I trust this folder\r\n Enter to confirm · Esc to cancel';
const CODEX_PROMPT = '  >_ OpenAI Codex (v0.163.0)\r\n  /work\r\n\r\n› Ask Codex to do anything\r\n\r\n  gpt-6-astra high · /work';
const CLAUDE_PROMPT = ' ▝▜███  Claude Code v2.1.306\r\n ⏵⏵ plan mode on (shift+tab to cycle)';

describe('blocking start-up screens', () => {
  it('recognises the codex update dialog with escape codes between the words', () => {
    expect(blockingStartScreen(CODEX_UPDATE)).not.toBeNull();
    expect(blockingStartScreen('Update\x1b[1C\x1b[0m now\x1b[5;3H Skip until next\x1b[1Cversion')).not.toBeNull();
  });

  it('recognises the folder trust dialogs of both CLIs', () => {
    expect(blockingStartScreen(CODEX_TRUST)).not.toBeNull();
    expect(blockingStartScreen(CLAUDE_TRUST)).not.toBeNull();
  });

  it('lets an ordinary prompt screen through', () => {
    expect(blockingStartScreen('')).toBeNull();
    expect(blockingStartScreen(CODEX_PROMPT)).toBeNull();
    expect(blockingStartScreen(CLAUDE_PROMPT)).toBeNull();
  });

  it('does not take the update banner above the prompt for a dialog', () => {
    const banner = '✨ Update available! 0.159.2 -> 0.163.0\r\nRun sh -c \'curl ...\' to update.\r\n' + CODEX_PROMPT;
    expect(blockingStartScreen(banner)).toBeNull();
  });

  it('names the reason', () => {
    expect(blockingStartScreen(CODEX_UPDATE)).toContain('dialog');
  });
});
