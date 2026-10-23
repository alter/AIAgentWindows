// chats.ts
import {
  BUSY_TEXT,
  CHAT_SIGNED_OUT_TEXT,
  NO_MODEL_TEXT,
  NOTHING_TO_RETRY_TEXT,
  SAVE_FAILED_TEXT,
  UNKNOWN_AGENT_TEXT,
  UNREADABLE_CONVERSATION_TEXT,
  assistantEntry,
  contextMessages,
  dismissFailed,
  retryTarget,
  sendProblem,
  userEntry,
  type ChatDelta,
  type ChatEntry,
  type ChatLoad,
  type ChatSend,
} from '../../shared/openrouter-chat';
import type { OpenRouterSettings, OpenRouterStatus } from '../../shared/openrouter';
import type { ChatRequest } from './chat';
import { DEFAULT_IDLE_MS, type KeyedOutcome, type StreamOptions } from './chat-stream';
import type { ConversationStore } from './conversation-store';

export interface ChatsDeps {
  service: {
    status(): Pick<OpenRouterStatus, 'state'>;
    chatStream(request: ChatRequest, options: StreamOptions): Promise<KeyedOutcome>;
  };
  store: ConversationStore;
  settingsOf(agentId: string): OpenRouterSettings | undefined;
  emit(delta: ChatDelta): void;
  copy(text: string): void;
  idleMs?: number;
  now?: () => number;
}

type Prepare = (entries: ChatEntry[], now: number) => ChatEntry[] | string;

function refused(error: string): ChatSend {
  return { ok: false, error };
}

export class OpenRouterChats {
  private readonly active = new Map<string, AbortController>();

  constructor(private readonly deps: ChatsDeps) {}

  async load(agentId: string): Promise<ChatLoad> {
    const loaded = await this.deps.store.load(agentId);
    return loaded.ok ? { ok: true, entries: loaded.conversation.entries } : { ok: false, error: UNREADABLE_CONVERSATION_TEXT };
  }

  send(agentId: string, text: string): Promise<ChatSend> {
    return this.guarded(agentId, (entries, now) => sendProblem(entries, text) ?? [...entries, userEntry(text, now)]);
  }

  retry(agentId: string, index: number): Promise<ChatSend> {
    return this.guarded(agentId, (entries) => (retryTarget(entries) === index ? dismissFailed(entries) : NOTHING_TO_RETRY_TEXT));
  }

  async dismiss(agentId: string): Promise<boolean> {
    if (this.active.has(agentId)) return false;
    this.active.set(agentId, new AbortController());
    try {
      const loaded = await this.deps.store.load(agentId);
      if (!loaded.ok) return false;
      const entries = dismissFailed(loaded.conversation.entries);
      return entries.length < loaded.conversation.entries.length && (await this.save({ ...loaded.conversation, entries }));
    } finally {
      this.active.delete(agentId);
    }
  }

  private async guarded(agentId: string, prepare: Prepare): Promise<ChatSend> {
    const settings = this.deps.settingsOf(agentId);
    if (settings === undefined) return refused(UNKNOWN_AGENT_TEXT);
    if (this.active.has(agentId)) return refused(BUSY_TEXT);
    if (settings.model === '') return refused(NO_MODEL_TEXT);
    if (this.deps.service.status().state !== 'connected') return refused(CHAT_SIGNED_OUT_TEXT);
    const controller = new AbortController();
    this.active.set(agentId, controller);
    try {
      return await this.run(agentId, prepare, settings, controller.signal);
    } finally {
      this.active.delete(agentId);
    }
  }

  stop(agentId: string): void {
    this.active.get(agentId)?.abort();
  }

  async copy(agentId: string, index: number): Promise<boolean> {
    const loaded = await this.deps.store.load(agentId);
    const entry = loaded.ok ? loaded.conversation.entries[index] : undefined;
    if (entry === undefined || entry.role !== 'assistant') return false;
    this.deps.copy(entry.text);
    return true;
  }

  shutdown(): void {
    for (const controller of this.active.values()) controller.abort();
  }

  private async run(agentId: string, prepare: Prepare, settings: OpenRouterSettings, signal: AbortSignal): Promise<ChatSend> {
    const now = this.deps.now ?? Date.now;
    const loaded = await this.deps.store.load(agentId);
    if (!loaded.ok) return refused(UNREADABLE_CONVERSATION_TEXT);
    const { conversation } = loaded;
    const entries = prepare(conversation.entries, now());
    if (typeof entries === 'string') return refused(entries);
    if (!(await this.save({ ...conversation, entries }))) return refused(SAVE_FAILED_TEXT);
    const outcome = await this.deps.service.chatStream(
      { model: settings.model, messages: contextMessages(entries), effort: settings.effort === '' ? null : settings.effort, web: settings.web },
      { signal, idleMs: this.deps.idleMs ?? DEFAULT_IDLE_MS, onDelta: (delta) => this.deps.emit({ id: agentId, text: delta }) },
    );
    const entry = assistantEntry(outcome, now());
    const saved = await this.save({ ...conversation, entries: [...entries, entry] });
    return { ok: true, entry: saved ? entry : { ...entry, error: SAVE_FAILED_TEXT } };
  }

  private async save(conversation: Parameters<ConversationStore['save']>[0]): Promise<boolean> {
    try {
      await this.deps.store.save(conversation);
      return true;
    } catch {
      return false;
    }
  }
}
