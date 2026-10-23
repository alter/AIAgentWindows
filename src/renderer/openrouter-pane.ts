// openrouter-pane.ts
import type { Agent } from '../shared/agents';
import { emptyOpenRouterSettings, type ModelItem } from '../shared/openrouter';
import { MAX_MESSAGE_CHARS, dismissFailed, retryTarget, userEntry, type ChatEntry, type ChatSend } from '../shared/openrouter-chat';
import { api } from './api';
import { el } from './dom';
import { setNotice } from './openrouter-account';
import { OpenRouterCells } from './room-openrouter-row';

const EMPTY_HINT = 'Choose a model, then write a message. Enter sends, Shift+Enter starts a new line.';
const SEND_FAILED_TEXT = 'The message could not be sent.';
const COPIED_MS = 1500;
const RETRY_LABEL = 'Retry';
const RETRY_ICON = '\u21BB';
const STATUS_LABELS: Readonly<Record<string, string>> = { stopped: 'stopped', failed: 'failed', streaming: 'writing' };

export class OpenRouterPane {
  readonly element = el('div', 'or-pane');
  private readonly cells: OpenRouterCells;
  private readonly log = el('div', 'or-log');
  private readonly notice = el('div', 'or-notice');
  private readonly input = el('textarea', 'room-prompt or-input');
  private readonly sendButton = el('button', 'room-button', 'Send');
  private readonly stopButton = el('button', 'room-button stop', 'Stop');
  private readonly unsubscribe: () => void;
  private entries: ChatEntry[] = [];
  private liveText: HTMLElement | null = null;
  private models: readonly ModelItem[] = [];
  private busy = false;
  private blocked = false;

  constructor(private readonly agent: Agent) {
    const settings = agent.openrouter ?? emptyOpenRouterSettings();
    this.cells = new OpenRouterCells(
      { id: agent.id, kind: 'openrouter', model: settings.model, effort: settings.effort, web: settings.web, ...(settings.modelName === undefined ? {} : { modelName: settings.modelName }) },
      () => void this.settingsChanged(),
    );
    this.cells.name('this chat');
    this.element.hidden = true;
    this.element.dataset['or'] = 'pane';
    this.element.dataset['agentId'] = agent.id;
    this.log.dataset['or'] = 'log';
    this.log.setAttribute('role', 'log');
    this.notice.dataset['or'] = 'notice';
    this.notice.setAttribute('role', 'status');
    setNotice(this.notice, '');
    this.input.dataset['or'] = 'input';
    this.input.setAttribute('aria-label', 'Message');
    this.input.maxLength = MAX_MESSAGE_CHARS;
    this.input.rows = 3;
    this.sendButton.type = 'button';
    this.sendButton.dataset['or'] = 'send';
    this.stopButton.type = 'button';
    this.stopButton.dataset['or'] = 'stop';
    this.stopButton.hidden = true;
    this.element.append(this.bar(), this.log, this.notice, this.composer());
    this.sendButton.addEventListener('click', () => void this.send());
    this.stopButton.addEventListener('click', () => void api.openrouterChatStop(agent.id));
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void this.send();
    });
    this.unsubscribe = api.onOpenRouterChatDelta((delta) => {
      if (delta.id !== agent.id || this.liveText === null) return;
      this.liveText.textContent = `${this.liveText.textContent ?? ''}${delta.text}`;
      this.log.scrollTop = this.log.scrollHeight;
    });
    void this.load();
    void this.loadModels(false);
  }

  show(): void {
    this.element.hidden = false;
    if (this.models.length === 0) void this.loadModels(true);
  }

  hide(): void {
    this.element.hidden = true;
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }

  private bar(): HTMLElement {
    const bar = el('div', 'or-bar');
    const group = (label: string, nodes: HTMLElement[]): HTMLElement => {
      const box = el('div', 'or-group');
      box.append(el('span', 'or-group-label', label), ...nodes);
      return box;
    };
    bar.append(group('Model', this.cells.modelNodes), group('Effort', this.cells.effortNodes), group('Web search', this.cells.webNodes));
    return bar;
  }

  private composer(): HTMLElement {
    const row = el('div', 'or-composer');
    const buttons = el('div', 'or-buttons');
    buttons.append(this.sendButton, this.stopButton);
    row.append(this.input, buttons);
    return row;
  }

  private async load(): Promise<void> {
    const result = await api.openrouterChatLoad(this.agent.id).catch(() => null);
    if (result === null || !result.ok) {
      this.blocked = true;
      this.input.disabled = true;
      this.sendButton.disabled = true;
      setNotice(this.notice, result === null ? SEND_FAILED_TEXT : result.error);
      return;
    }
    this.entries = result.entries;
    this.renderAll();
  }

  private async loadModels(refresh: boolean): Promise<void> {
    const result = await api.openrouterModels(refresh).catch(() => null);
    if (result === null || !result.ok) return;
    this.models = result.models;
    this.cells.setModels(result.models);
  }

  private renderAll(): void {
    if (this.entries.length === 0) {
      this.log.replaceChildren(el('div', 'or-empty', EMPTY_HINT));
      return;
    }
    const target = retryTarget(this.entries);
    this.log.replaceChildren(...this.entries.map((entry, index) => this.message(entry, index, target)));
    this.log.scrollTop = this.log.scrollHeight;
  }

  private message(entry: ChatEntry | { role: 'assistant'; status: 'streaming'; text: string }, index: number, target: number | null = null): HTMLElement {
    const node = el('article', 'or-msg');
    node.dataset['role'] = entry.role;
    node.dataset['status'] = entry.status;
    const head = el('div', 'or-msg-head');
    head.append(el('span', 'or-msg-author', entry.role === 'user' ? 'You' : 'Model'));
    const label = STATUS_LABELS[entry.status];
    if (label !== undefined) head.append(el('span', 'or-msg-state', label));
    if (entry.role === 'assistant' && entry.status !== 'streaming' && entry.text !== '') head.append(this.copyButton(index));
    if (entry.role === 'user' && index === target) head.append(this.retryButton(index));
    node.append(head, el('pre', 'or-msg-text', entry.text));
    if ('error' in entry && entry.error !== undefined) node.append(el('p', 'or-msg-error', entry.error));
    return node;
  }

  private copyButton(index: number): HTMLButtonElement {
    const button = el('button', 'room-button or-copy', 'Copy');
    button.type = 'button';
    button.dataset['or'] = 'copy';
    button.addEventListener('click', () => {
      void api.openrouterChatCopy(this.agent.id, index).then((copied) => {
        if (!copied) return;
        button.textContent = 'Copied';
        setTimeout(() => {
          button.textContent = 'Copy';
        }, COPIED_MS);
      });
    });
    return button;
  }

  private retryButton(index: number): HTMLButtonElement {
    const button = el('button', 'room-button or-retry', RETRY_ICON);
    button.type = 'button';
    button.dataset['or'] = 'retry';
    button.setAttribute('aria-label', RETRY_LABEL);
    button.title = RETRY_LABEL;
    button.disabled = this.busy;
    button.addEventListener('click', () => void this.retry(index));
    return button;
  }

  private async settingsChanged(): Promise<void> {
    await api.openrouterSettings(this.agent.id, this.cells.value());
    if (this.busy || this.blocked) return;
    const kept = dismissFailed(this.entries);
    if (kept.length === this.entries.length) return;
    this.entries = kept;
    this.renderAll();
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const button of this.log.querySelectorAll<HTMLButtonElement>('[data-or="retry"]')) button.disabled = busy;
    this.sendButton.hidden = busy;
    this.stopButton.hidden = !busy;
    this.cells.setBusy(busy);
  }

  private async send(): Promise<void> {
    const text = this.input.value;
    if (this.busy || this.blocked || text.trim() === '') return;
    this.setBusy(true);
    setNotice(this.notice, '');
    this.input.value = '';
    const asked = userEntry(text, Date.now());
    const asking = this.message(asked, this.entries.length);
    const writing = this.message({ role: 'assistant', status: 'streaming', text: '' }, this.entries.length + 1);
    this.log.querySelector('.or-empty')?.remove();
    this.log.append(asking, writing);
    this.liveText = writing.querySelector('.or-msg-text');
    this.log.scrollTop = this.log.scrollHeight;
    const result = await api.openrouterChatSend(this.agent.id, text).catch(() => ({ ok: false as const, error: SEND_FAILED_TEXT }));
    this.liveText = null;
    if (result.ok) {
      this.entries.push(asked, result.entry);
      this.renderAll();
    } else {
      asking.remove();
      writing.remove();
      this.input.value = text;
      setNotice(this.notice, result.error);
      if (this.entries.length === 0) this.renderAll();
    }
    this.setBusy(false);
    this.input.focus();
  }

  private async retry(index: number): Promise<void> {
    if (this.busy || this.blocked || retryTarget(this.entries) !== index) return;
    this.setBusy(true);
    setNotice(this.notice, '');
    this.entries = dismissFailed(this.entries);
    this.renderAll();
    const writing = this.message({ role: 'assistant', status: 'streaming', text: '' }, this.entries.length);
    this.log.append(writing);
    this.liveText = writing.querySelector('.or-msg-text');
    this.log.scrollTop = this.log.scrollHeight;
    const result: ChatSend = await api.openrouterChatRetry(this.agent.id, index).catch(() => ({ ok: false as const, error: SEND_FAILED_TEXT }));
    this.liveText = null;
    if (result.ok) {
      this.entries.push(result.entry);
      this.renderAll();
    } else {
      writing.remove();
      setNotice(this.notice, result.error);
      await this.load();
    }
    this.setBusy(false);
  }
}
