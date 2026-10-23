// room-table.ts
import { AGENT_LABELS, isSiteKind, type AgentKind } from '../shared/agents';
import { emptyRoomModels, type RoomModels } from '../shared/cli-models';
import {
  addMenuOptions,
  addRow,
  effortChoices,
  focusAfterRemove,
  modelSuggestions,
  moveRow,
  removeRow,
  resolveFinalizer,
  rowLabel,
  type FormRow,
} from '../shared/room-view';
import { el } from './dom';

type RowAction = 'up' | 'down' | 'remove';
type FocusTarget = { id: string; field: RowAction } | 'add';

interface RowView {
  id: string;
  kind: AgentKind;
  root: HTMLTableRowElement;
  model: HTMLInputElement | null;
  effort: HTMLSelectElement | null;
  final: HTMLInputElement;
  buttons: Record<RowAction, HTMLButtonElement>;
}

const COLUMNS = ['#', 'Agent', 'Model', 'Effort', 'Final'];
const COLUMN_COUNT = COLUMNS.length + 1;
const CLI_KINDS: readonly AgentKind[] = ['claude', 'codex'];
const NOT_APPLICABLE = '—';

function actionButton(action: RowAction, glyph: string): HTMLButtonElement {
  const button = el('button', 'room-table-action', glyph);
  button.type = 'button';
  button.dataset['rowField'] = action;
  return button;
}

function notApplicable(): HTMLTableCellElement {
  const cell = el('td');
  const mark = el('span', undefined, NOT_APPLICABLE);
  mark.setAttribute('aria-hidden', 'true');
  cell.append(mark, el('span', 'visually-hidden', 'not applicable'));
  return cell;
}

export class RoomTable {
  readonly element = el('div', 'room-table-box');
  private readonly body = el('tbody');
  private readonly trigger = el('button', 'room-button room-add', 'Add participant');
  private readonly menu = el('div', 'room-add-menu');
  private readonly lists = new Map<AgentKind, HTMLDataListElement>();
  private views: RowView[] = [];
  private models: RoomModels = emptyRoomModels();
  private finalId = '';
  private busy = false;

  constructor() {
    const table = el('table', 'room-table');
    table.dataset['room'] = 'participants';
    table.setAttribute('aria-label', 'Participants in relay order');
    const head = el('tr');
    for (const name of COLUMNS) head.append(this.header(name));
    const actions = el('th');
    actions.scope = 'col';
    actions.append(el('span', 'visually-hidden', 'Actions'));
    head.append(actions);
    const thead = el('thead');
    thead.append(head);
    table.append(thead, this.body);
    for (const kind of CLI_KINDS) {
      const list = el('datalist');
      list.id = `room-models-${kind}`;
      this.lists.set(kind, list);
      this.element.append(list);
    }
    const adder = el('div', 'room-add-box');
    this.trigger.type = 'button';
    this.trigger.dataset['room'] = 'add-participant';
    this.trigger.setAttribute('aria-haspopup', 'menu');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', 'room-add-menu');
    this.trigger.addEventListener('click', () => (this.menu.hidden ? this.openMenu() : this.closeMenu(false)));
    this.trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' || this.busy) return;
      event.preventDefault();
      this.openMenu();
    });
    this.menu.id = 'room-add-menu';
    this.menu.dataset['room'] = 'add-menu';
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Add participant');
    this.menu.addEventListener('keydown', (event) => this.onMenuKey(event));
    adder.append(this.trigger, this.menu);
    this.element.append(table, adder);
    document.addEventListener('click', (event) => {
      if (!this.menu.hidden && !adder.contains(event.target as Node)) this.closeMenu(false);
    });
    adder.addEventListener('focusout', (event) => {
      if (!this.menu.hidden && !adder.contains(event.relatedTarget as Node | null)) this.closeMenu(false);
    });
    this.render([]);
  }

  setRows(rows: readonly FormRow[], finalizerId: string): void {
    this.finalId = finalizerId;
    this.render(rows);
  }

  rows(): FormRow[] {
    return this.views.map((view) => ({
      id: view.id,
      kind: view.kind,
      ...(view.model === null ? {} : { model: view.model.value }),
      ...(view.effort === null ? {} : { effort: view.effort.value }),
    }));
  }

  ids(): string[] {
    return this.views.map((view) => view.id);
  }

  finalizerId(): string {
    return resolveFinalizer(this.ids(), this.finalId, this.rows());
  }

  setModels(models: RoomModels): void {
    this.models = models;
    for (const [kind, list] of this.lists) {
      list.replaceChildren(
        ...modelSuggestions(kind, models).map((name) => {
          const option = el('option');
          option.value = name;
          return option;
        }),
      );
    }
    for (const view of this.views) this.refreshEfforts(view);
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) this.closeMenu(false);
    this.applyBusy();
  }

  private header(name: string): HTMLTableCellElement {
    const cell = el('th', undefined, name);
    cell.scope = 'col';
    return cell;
  }

  private applyBusy(): void {
    this.trigger.disabled = this.busy;
    for (const view of this.views) {
      const last = view === this.views[this.views.length - 1];
      view.final.disabled = this.busy;
      if (view.model !== null) view.model.disabled = this.busy;
      if (view.effort !== null) view.effort.disabled = this.busy;
      view.buttons.remove.disabled = this.busy;
      view.buttons.up.disabled = this.busy || view === this.views[0];
      view.buttons.down.disabled = this.busy || last;
    }
  }

  private refreshEfforts(view: RowView): void {
    const select = view.effort;
    if (select === null || view.model === null) return;
    const current = select.value;
    const none = el('option', undefined, 'CLI default');
    none.value = '';
    select.replaceChildren(none);
    for (const level of effortChoices(view.kind, view.model.value, current, this.models)) {
      const option = el('option', undefined, level);
      option.value = level;
      select.append(option);
    }
    select.value = current;
  }

  private nameRows(): void {
    const rows = this.rows();
    this.views.forEach((view, index) => {
      const name = rowLabel(rows[index] as FormRow);
      view.buttons.up.setAttribute('aria-label', `Move ${name} up`);
      view.buttons.down.setAttribute('aria-label', `Move ${name} down`);
      view.buttons.remove.setAttribute('aria-label', `Remove ${name}`);
      view.final.setAttribute('aria-label', `Final writer: ${name}`);
      const place = `row ${index + 1} ${AGENT_LABELS[view.kind]}`;
      view.model?.setAttribute('aria-label', `Model of ${place}`);
      view.effort?.setAttribute('aria-label', `Effort of ${place}`);
    });
  }

  private buildRow(row: FormRow, index: number): RowView {
    const root = el('tr');
    root.dataset['row'] = row.id;
    const place = el('td', 'room-table-number', String(index + 1));
    const agent = el('th', undefined, AGENT_LABELS[row.kind]);
    agent.scope = 'row';
    const final = el('input');
    final.type = 'radio';
    final.name = 'room-final';
    final.dataset['rowField'] = 'final';
    final.checked = row.id === this.finalId;
    final.addEventListener('change', () => {
      if (final.checked) this.finalId = row.id;
    });
    const buttons = { up: actionButton('up', '↑'), down: actionButton('down', '↓'), remove: actionButton('remove', '×') };
    const view: RowView = { id: row.id, kind: row.kind, root, model: null, effort: null, final, buttons };
    const modelCell = el('td');
    const effortCell = el('td');
    if (!isSiteKind(row.kind)) {
      const model = el('input');
      model.type = 'text';
      model.value = row.model ?? '';
      model.placeholder = 'model';
      model.setAttribute('list', `room-models-${row.kind}`);
      model.dataset['rowField'] = 'model';
      model.spellcheck = false;
      const effort = el('select');
      effort.dataset['rowField'] = 'effort';
      const none = el('option', undefined, 'CLI default');
      none.value = '';
      effort.append(none);
      if (row.effort !== undefined && row.effort !== '') {
        const saved = el('option', undefined, row.effort);
        saved.value = row.effort;
        effort.append(saved);
        effort.value = row.effort;
      }
      view.model = model;
      view.effort = effort;
      model.addEventListener('input', () => {
        this.refreshEfforts(view);
        this.nameRows();
      });
      effort.addEventListener('change', () => this.nameRows());
      modelCell.append(model);
      effortCell.append(effort);
    }
    buttons.up.addEventListener('click', () => this.move(row.id, -1));
    buttons.down.addEventListener('click', () => this.move(row.id, 1));
    buttons.remove.addEventListener('click', () => this.remove(row.id));
    const finalCell = el('td');
    finalCell.append(final);
    const actions = el('td', 'room-table-actions');
    actions.append(buttons.up, buttons.down, buttons.remove);
    root.append(place, agent, view.model === null ? notApplicable() : modelCell, view.effort === null ? notApplicable() : effortCell, finalCell, actions);
    return view;
  }

  private render(rows: readonly FormRow[], focus?: FocusTarget): void {
    this.views = rows.map((row, index) => this.buildRow(row, index));
    for (const view of this.views) this.refreshEfforts(view);
    this.finalId = resolveFinalizer(this.ids(), this.finalId, rows);
    for (const view of this.views) view.final.checked = view.id === this.finalId;
    if (this.views.length === 0) {
      const empty = el('tr', 'room-table-empty');
      const cell = el('td', undefined, 'No participants yet.');
      cell.colSpan = COLUMN_COUNT;
      empty.append(cell);
      this.body.replaceChildren(empty);
    } else {
      this.body.replaceChildren(...this.views.map((view) => view.root));
    }
    this.nameRows();
    this.applyBusy();
    if (focus !== undefined) this.focus(focus);
  }

  private focus(target: FocusTarget): void {
    if (target === 'add') {
      this.trigger.focus();
      return;
    }
    const view = this.views.find((item) => item.id === target.id);
    const wanted = view?.buttons[target.field];
    const other = target.field === 'up' ? view?.buttons.down : view?.buttons.up;
    (wanted?.disabled === false ? wanted : other?.disabled === false ? other : view?.buttons.remove)?.focus();
  }

  private move(id: string, step: -1 | 1): void {
    this.render(moveRow(this.rows(), id, step), { id, field: step === -1 ? 'up' : 'down' });
  }

  private remove(id: string): void {
    const rows = this.rows();
    const next = focusAfterRemove(rows, id);
    this.render(removeRow(rows, id), next === null ? 'add' : { id: next, field: 'remove' });
  }

  private items(): HTMLButtonElement[] {
    return [...this.menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }

  private openMenu(): void {
    if (this.busy) return;
    this.menu.replaceChildren(
      ...addMenuOptions(this.rows()).map((option) => {
        const item = el('button', 'room-add-item');
        item.type = 'button';
        item.dataset['add'] = option.kind;
        item.setAttribute('role', 'menuitem');
        item.append(el('span', undefined, option.label));
        if (!option.available) {
          item.setAttribute('aria-disabled', 'true');
          item.append(el('span', 'room-add-note', option.note));
        }
        item.addEventListener('click', () => {
          if (!option.available) return;
          this.closeMenu(false);
          this.render(addRow(this.rows(), option.kind), 'add');
        });
        return item;
      }),
    );
    this.menu.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.items()[0]?.focus();
  }

  private closeMenu(refocus: boolean): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (refocus) this.trigger.focus();
  }

  private onMenuKey(event: KeyboardEvent): void {
    const items = this.items();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const to: Record<string, number> = { ArrowDown: (at + 1) % items.length, ArrowUp: (at - 1 + items.length) % items.length, Home: 0, End: items.length - 1 };
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu(true);
      return;
    }
    const index = to[event.key];
    if (index === undefined) return;
    event.preventDefault();
    items[index]?.focus();
  }
}
