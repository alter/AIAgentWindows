// conversation-store.ts
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isUuid } from '../../shared/agents';
import { isProjectId } from '../../shared/projects';
import { MAX_CONVERSATION_BYTES, emptyConversation, parseConversation, serializeConversation, type Conversation } from '../../shared/openrouter-chat';

export type LoadedConversation = { ok: true; conversation: Conversation } | { ok: false };

export function projectChatsDir(userData: string, projectId: string): string {
  if (!isProjectId(projectId)) throw new Error('invalid project id');
  return path.join(userData, 'projects', projectId, 'chats');
}

export class ConversationStore {
  constructor(private readonly dir: string | ((agentId: string) => string)) {}

  private dirOf(agentId: string): string {
    return typeof this.dir === 'string' ? this.dir : this.dir(agentId);
  }

  file(agentId: string): string {
    if (!isUuid(agentId)) throw new Error('invalid agent id');
    return path.join(this.dirOf(agentId), `${agentId}.json`);
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
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, serializeConversation(conversation), 'utf8');
    await rename(temp, file);
  }
}
