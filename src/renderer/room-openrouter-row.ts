// room-openrouter-row.ts
import {
  MODEL_FILTERS,
  WEB_SEARCH_USD,
  filterModels,
  modelPick,
  modelPriceText,
  pickableModels,
  sortModels,
  type ModelFilter,
  type ModelItem,
} from '../shared/openrouter';
import { COLLECTION_SWITCH_LABEL } from '../shared/room-model';
import { openrouterEffortChoices, type FormRow } from '../shared/room-view';
import { el } from './dom';

const FILTER_LABELS: Readonly<Record<ModelFilter, string>> = { all: 'All', free: 'Free', paid: 'Paid' };
const NOT_APPLICABLE = '—';
const COLLECTION_WARNING = 'The provider may keep and train on the project map and the room history';
const WEB_NOTE = `about $${WEB_SEARCH_USD} per search, billed to credits even on free models`;

export interface OpenRouterValue {
  model: string;
  modelName?: string;
  effort: string;
  web: boolean;
  allowCollection?: boolean;
}

function option(value: string, text: string): HTMLOptionElement {
  const node = el('option', undefined, text);
  node.value = value;
  return node;
}

export class OpenRouterCells {
  readonly modelNodes: HTMLElement[];
  readonly effortNodes: HTMLElement[];
  readonly webNodes: HTMLElement[];
  readonly collectionNodes: HTMLElement[];
  private readonly controls: (HTMLInputElement | HTMLSelectElement)[];
  private readonly filter = el('select');
  private readonly search = el('input');
  private readonly model = el('select');
  private readonly hint = el('span', 'room-or-hint');
  private readonly effort = el('select');
  private readonly dash = el('span', undefined, NOT_APPLICABLE);
  private readonly web = el('input');
  private readonly collection = el('input');
  private readonly collectionWarning = el('span', 'room-or-warn', COLLECTION_WARNING);
  private readonly collectionDash = el('span', undefined, NOT_APPLICABLE);
  private projectRoom = false;
  private models: readonly ModelItem[] = [];
  private modelName: string | undefined;
  private picked: string;

  constructor(
    row: FormRow,
    private readonly onChange: () => void,
  ) {
    this.picked = row.model ?? '';
    this.modelName = row.modelName;
    this.filter.dataset['rowField'] = 'model-filter';
    for (const value of MODEL_FILTERS) this.filter.append(option(value, FILTER_LABELS[value]));
    this.search.type = 'text';
    this.search.placeholder = 'search';
    this.search.spellcheck = false;
    this.search.dataset['rowField'] = 'model-search';
    this.model.dataset['rowField'] = 'model';
    this.effort.dataset['rowField'] = 'effort';
    this.dash.setAttribute('aria-hidden', 'true');
    this.web.type = 'checkbox';
    this.web.dataset['rowField'] = 'web';
    this.web.checked = row.web === true;
    this.collection.type = 'checkbox';
    this.collection.dataset['rowField'] = 'collection';
    this.collection.checked = row.allowCollection === true;
    this.collectionWarning.dataset['rowField'] = 'collection-warning';
    this.collectionWarning.setAttribute('role', 'note');
    this.collectionDash.setAttribute('aria-hidden', 'true');
    this.collection.addEventListener('change', () => {
      this.showCollection();
      this.onChange();
    });
    this.filter.addEventListener('change', () => this.refreshModels());
    this.search.addEventListener('input', () => this.refreshModels());
    this.model.addEventListener('change', () => this.onPick());
    this.effort.addEventListener('change', () => this.onChange());
    this.web.addEventListener('change', () => this.onChange());
    const tools = el('div', 'room-or-tools');
    tools.append(this.filter, this.search);
    this.controls = [this.filter, this.search, this.model, this.effort, this.web, this.collection];
    this.modelNodes = [tools, this.model, this.hint];
    this.effortNodes = [this.effort, this.dash];
    this.webNodes = [this.web, el('span', 'room-or-hint', WEB_NOTE)];
    this.collectionNodes = [this.collection, this.collectionWarning, this.collectionDash];
    this.showCollection();
    this.refreshModels();
    this.refreshEfforts(row.effort ?? '');
  }

  setProject(project: boolean): void {
    this.projectRoom = project;
    this.showCollection();
  }

  setModels(models: readonly ModelItem[]): void {
    this.models = models;
    this.refreshModels();
    this.refreshEfforts(this.effort.value);
  }

  setBusy(busy: boolean): void {
    for (const control of this.controls) control.disabled = busy;
  }

  name(place: string): void {
    this.filter.setAttribute('aria-label', `Model filter of ${place}`);
    this.search.setAttribute('aria-label', `Search models of ${place}`);
    this.model.setAttribute('aria-label', `Model of ${place}`);
    this.effort.setAttribute('aria-label', `Effort of ${place}`);
    this.web.setAttribute('aria-label', `Web search of ${place}`);
    this.collection.setAttribute('aria-label', `${COLLECTION_SWITCH_LABEL} for ${place}`);
  }

  value(): OpenRouterValue {
    return {
      model: this.model.value,
      ...(this.modelName === undefined ? {} : { modelName: this.modelName }),
      effort: this.effort.value,
      web: this.web.checked,
      ...(this.collection.checked ? { allowCollection: true } : {}),
    };
  }

  private showCollection(): void {
    this.collection.hidden = !this.projectRoom;
    this.collectionDash.hidden = this.projectRoom;
    this.collectionWarning.hidden = !(this.projectRoom && this.collection.checked);
    this.collectionWarning.dataset['state'] = this.collection.checked ? 'allowed' : 'denied';
  }

  private current(): ModelItem | undefined {
    return this.models.find((item) => item.id === this.model.value);
  }

  private refreshModels(): void {
    const chosen = this.picked;
    const shown = sortModels(filterModels(pickableModels(this.models), this.filter.value as ModelFilter, this.search.value), 'name');
    const options = [option('', 'Choose a model')];
    if (chosen !== '' && !shown.some((item) => item.id === chosen)) {
      const known = this.models.find((item) => item.id === chosen);
      options.push(option(chosen, known?.name ?? this.modelName ?? chosen));
    }
    for (const item of shown) options.push(option(item.id, `${item.name} — ${modelPriceText(item)}`));
    this.model.replaceChildren(...options);
    this.model.value = chosen;
    this.showHint();
  }

  private showHint(): void {
    const item = this.current();
    this.hint.textContent = item === undefined ? '' : `${modelPriceText(item)}${item.contextLength === null ? '' : ` · ${Math.round(item.contextLength / 1000)}k context`}`;
  }

  private refreshEfforts(saved: string): void {
    const choices = openrouterEffortChoices(this.current(), saved);
    this.effort.replaceChildren(option('', 'Default'), ...choices.map((level) => option(level, level)));
    this.effort.value = choices.includes(saved) ? saved : '';
    this.effort.hidden = choices.length === 0;
    this.dash.hidden = choices.length > 0;
  }

  private onPick(): void {
    this.picked = this.model.value;
    const item = this.current();
    if (item !== undefined) {
      const pick = modelPick(item);
      this.modelName = pick.modelName;
      this.web.checked = pick.web;
    } else {
      this.modelName = undefined;
      this.web.checked = false;
    }
    this.showHint();
    this.refreshEfforts('');
    this.onChange();
  }
}
