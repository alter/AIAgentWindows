// conversation-store.ts
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isUuid } from '../../shared/agents';
import { MAX_CONVERSATION_BYTES, emptyConversation, parseConversation, serializeConversation, type Conversation } from '../../shared/openrouter-chat';

export type LoadedConversation = { ok: true; conversation: Conversation } | { ok: false };

export class ConversationStore {
  constructor(private readonly dir: string) {}

  file(agentId: string): string {
    if (!isUuid(agentId)) throw new Error('invalid agent id');
    return path.join(this.dir, `${agentId}.json`);
  }

  async load(agentId: string): Promise<LoadedConversation> {
    if (!isUuid(agentId)) return { ok: false };
    const file = this.file(agentId);
    try {
      if ((await stat(file)).size > MAX_CONVERSATION_BYTES) return { ok: false };
      const conversation = parseConversation(await readFile(file, 'utf8'), agentId);
      return conversation === null ? { ok: false } : { ok: true, conversation };
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: true, conversation: emptyConversation(agentId) } : { ok: false };
    }
  }

  async save(conversation: Conversation): Promise<void> {
    const file = this.file(conversation.agentId);
    await mkdir(this.dir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, serializeConversation(conversation), 'utf8');
    await rename(temp, file);
  }
}
