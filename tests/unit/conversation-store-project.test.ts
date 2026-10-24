// conversation-store-project.test.ts
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore, projectChatsDir } from '../../src/main/openrouter/conversation-store';
import { emptyConversation } from '../../src/shared/openrouter-chat';

const IN_PROJECT = '3f2b8c1e-9a4d-4e57-b6a0-1c2d3e4f5a6b';
const LOOSE = '4f2b8c1e-9a4d-4e57-b6a0-1c2d3e4f5a6b';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'aiaw-chat-dir-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('where a conversation is stored', () => {
  it('puts the chat of a project agent under the project storage folder and a loose one where it always was', async () => {
    const shared = path.join(dir, 'shared', 'openrouter');
    const store = new ConversationStore((agentId) => (agentId === IN_PROJECT ? projectChatsDir(dir, 'proj-1') : shared));
    await store.save(emptyConversation(IN_PROJECT));
    await store.save(emptyConversation(LOOSE));
    expect(await readdir(path.join(dir, 'projects', 'proj-1', 'chats'))).toEqual([`${IN_PROJECT}.json`]);
    expect(await readdir(shared)).toEqual([`${LOOSE}.json`]);
    expect(store.file(IN_PROJECT)).toBe(path.join(dir, 'projects', 'proj-1', 'chats', `${IN_PROJECT}.json`));
    expect(await store.load(IN_PROJECT)).toEqual({ ok: true, conversation: emptyConversation(IN_PROJECT) });
  });

  it('keeps a plain folder working as before', () => {
    expect(new ConversationStore(path.join(dir, 'x')).file(LOOSE)).toBe(path.join(dir, 'x', `${LOOSE}.json`));
  });

  it('refuses a project id that could leave the projects folder', () => {
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'x'.repeat(65)]) expect(() => projectChatsDir(dir, bad)).toThrow();
  });
});
