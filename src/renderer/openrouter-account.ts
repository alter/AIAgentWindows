// openrouter-account.ts
import {
  MODEL_FILTERS,
  filterModels,
  noticeText,
  sortModels,
  type ModelFilter,
  type ModelItem,
  type OpenRouterStatus,
} from '../shared/openrouter';
import { api } from './api';
import { el } from './dom';

const FILTER_LABELS: Record<ModelFilter, string> = { all: 'All models', free: 'Free', paid: 'Paid' };
const MAX_ROWS = 200;

function formatContext(tokens: number | null): string {
  if (tokens === null) return 'context unknown';
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k context` : `${tokens} context`;
}

function formatPrice(value: number | null): string {
  return value === null ? '?' : `$${Number(value.toFixed(4))}`;
}

function modelMeta(model: ModelItem): string {
  const price = model.free ? 'free' : `${formatPrice(model.promptUsdPerMillion)} in / ${formatPrice(model.completionUsdPerMillion)} out per 1M tokens`;
  return `${price} · ${formatContext(model.contextLength)}`;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export class OpenRouterAccount {
  readonly element = el('section', 'or-account');
  private readonly stateText = el('p', 'or-state');
  private readonly freeText = el('p', 'or-free');
  private readonly notice = el('p', 'or-notice');
  private readonly connectButton = button('Connect', 'or-button', () => void api.openrouterConnect('browser').then((status) => this.render(status)));
  private readonly pasteButton = button('Paste key', 'or-button-plain', () => this.openPaste());
  private readonly codeButton = button('Use a code instead', 'or-button-plain', () => void api.openrouterConnect('code').then((status) => this.render(status)));
  private readonly cancelButton = button('Cancel', 'or-button-plain', () => void api.openrouterCancel().then((status) => this.render(status)));
  private readonly refreshButton = button('Refresh', 'or-button-plain', () => void this.refresh());
  private readonly disconnectButton = button('Disconnect', 'or-button-plain', () => void api.openrouterDisconnect().then((status) => this.render(status)));
  private readonly pasteForm = el('form', 'or-paste');
  private readonly pasteInput = el('input', 'or-paste-input');
  private readonly pasteLabel = el('label', 'or-paste-label', 'Key');
  private readonly details = el('details', 'or-models');
  private readonly summary = el('summary', 'or-models-summary', 'Models');
  private readonly filter = el('select', 'or-filter');
  private readonly list = el('ul', 'or-model-list');
  private status: OpenRouterStatus = { state: 'signed-out', mode: null, notice: null, info: null };
  private models: ModelItem[] = [];
  private modelsLoaded = false;
  private modelsFailed = false;
  private pasteOpen = false;

  constructor() {
    const title = el('h2', 'or-title', 'OpenRouter');
    title.id = 'or-title';
    this.element.setAttribute('aria-labelledby', title.id);
    this.notice.setAttribute('role', 'status');
    this.setupPaste();
    this.setupModels();
    const actions = el('div', 'or-actions');
    actions.append(this.connectButton, this.pasteButton, this.codeButton, this.cancelButton, this.refreshButton, this.disconnectButton);
    this.element.append(title, this.stateText, this.freeText, this.notice, actions, this.pasteForm, this.details);
    this.render(this.status);
    api.onOpenRouterChanged((status) => this.render(status));
    void api.openrouterStatus().then((status) => this.render(status));
  }

  private setupPaste(): void {
    this.pasteInput.type = 'password';
    this.pasteInput.id = 'or-paste-input';
    this.pasteInput.autocomplete = 'off';
    this.pasteInput.spellcheck = false;
    this.pasteLabel.htmlFor = this.pasteInput.id;
    const save = el('button', 'or-button', 'Save');
    save.type = 'submit';
    this.pasteForm.append(this.pasteLabel, this.pasteInput, save);
    this.pasteForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.pasteInput.value;
      this.pasteInput.value = '';
      this.pasteOpen = false;
      void api.openrouterPaste(text).then((status) => this.render(status));
    });
  }

  private setupModels(): void {
    for (const choice of MODEL_FILTERS) {
      const option = el('option', undefined, FILTER_LABELS[choice]);
      option.value = choice;
      this.filter.append(option);
    }
    this.filter.setAttribute('aria-label', 'Show models');
    this.filter.addEventListener('change', () => this.renderModels());
    this.details.append(this.summary, this.filter, this.list);
    this.details.addEventListener('toggle', () => {
      if (this.details.open && !this.modelsLoaded) void this.loadModels(false);
    });
  }

  private openPaste(): void {
    this.pasteOpen = true;
    this.render(this.status);
    this.pasteInput.focus();
  }

  private async refresh(): Promise<void> {
    this.render(await api.openrouterRefresh());
    if (this.modelsLoaded || this.details.open) await this.loadModels(true);
  }

  private async loadModels(refresh: boolean): Promise<void> {
    const result = await api.openrouterModels(refresh);
    this.modelsLoaded = true;
    this.modelsFailed = !result.ok;
    this.models = result.models;
    this.renderModels();
  }

  private render(status: OpenRouterStatus): void {
    this.status = status;
    const connected = status.state === 'connected';
    const signing = status.state === 'signing-in';
    const codeMode = signing && status.mode === 'code';
    this.pasteLabel.textContent = codeMode ? 'Code' : 'Key';
    this.stateText.textContent = connected ? 'Connected' : codeMode ? 'Paste the code shown on the OpenRouter page.' : signing ? 'Finish signing in in your browser.' : 'Not connected';
    const free = status.info?.freeRequests ?? null;
    this.freeText.textContent = connected && free !== null ? `Free requests left today: ${free.remaining} of ${free.limit}` : '';
    this.notice.textContent = noticeText(status.notice);
    this.connectButton.hidden = connected || signing;
    this.pasteButton.hidden = connected || signing;
    this.codeButton.hidden = !signing || codeMode;
    this.cancelButton.hidden = !signing;
    this.refreshButton.hidden = !connected;
    this.disconnectButton.hidden = !connected;
    this.pasteForm.hidden = connected || !(this.pasteOpen || codeMode);
    this.freeText.hidden = this.freeText.textContent === '';
    this.notice.hidden = this.notice.textContent === '';
  }

  private renderModels(): void {
    const choice = this.filter.value as ModelFilter;
    const shown = sortModels(filterModels(this.models, choice, ''), 'name');
    this.summary.textContent = this.modelsLoaded ? `Models (${shown.length})` : 'Models';
    const rows: HTMLElement[] = [];
    if (this.modelsFailed && this.models.length === 0) rows.push(el('li', 'or-model-note', 'The model list could not be loaded.'));
    for (const model of shown.slice(0, MAX_ROWS)) {
      const row = el('li', 'or-model');
      row.append(el('span', 'or-model-name', model.name), el('span', 'or-model-meta', modelMeta(model)));
      row.title = model.id;
      rows.push(row);
    }
    if (shown.length > MAX_ROWS) rows.push(el('li', 'or-model-note', `${shown.length - MAX_ROWS} more, narrow the list with the filter.`));
    this.list.replaceChildren(...rows);
  }
}
