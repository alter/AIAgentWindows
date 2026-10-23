// room-tree.ts
import { renameTitle, type RoomTreeRow } from '../shared/room-view';
import { el } from './dom';

export interface RoomTreeHandlers {
  onPane(): void;
  onOpen(id: string): void;
  onNew(): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

export interface RoomTreeState {
  rows: readonly RoomTreeRow[];
  busy: boolean;
}

interface Editing {
  id: string;
  draft: string;
}

const MAX_TITLE_LENGTH = 80;

export class RoomTree {
  readonly element = el('section', 'rooms');
  private readonly toggle = el('button', 'rooms-toggle');
  private readonly title = el('button', 'rooms-title', '# Rooms');
  private readonly add = el('button', 'rooms-add', '+');
  private readonly list = el('ul', 'rooms-list');
  private readonly menu = el('div', 'rooms-menu');
  private readonly renameItem = el('button', 'rooms-menu-item', 'Rename');
  private readonly deleteItem = el('button', 'rooms-menu-item', 'Delete');
  private readonly confirm = el('div', 'rooms-confirm');
  private readonly confirmText = el('span', 'rooms-confirm-text');
  private readonly confirmYes = el('button', 'rooms-confirm-yes', 'Delete');
  private readonly confirmNo = el('button', 'rooms-confirm-no', 'Cancel');
  private state: RoomTreeState = { rows: [], busy: false };
  private paneOpen = false;
  private expanded = true;
  private menuId: string | null = null;
  private pendingId: string | null = null;
  private editing: Editing | null = null;
  private rebuilding = false;

  constructor(private readonly handlers: RoomTreeHandlers) {
    this.element.dataset['room'] = 'tree';
    this.toggle.type = 'button';
    this.toggle.dataset['room'] = 'tree-toggle';
    this.toggle.setAttribute('aria-label', 'Rooms');
    this.toggle.setAttribute('aria-controls', 'rooms-list');
    this.toggle.addEventListener('click', () => this.setExpanded(!this.expanded));
    this.title.type = 'button';
    this.title.dataset['room'] = 'open';
    this.title.addEventListener('click', () => this.handlers.onPane());
    this.add.type = 'button';
    this.add.dataset['room'] = 'new';
    this.add.title = 'New room';
    this.add.setAttribute('aria-label', 'New room');
    this.add.addEventListener('click', () => this.handlers.onNew());
    this.list.id = 'rooms-list';
    const header = el('div', 'rooms-header');
    header.append(this.toggle, this.title, this.add);
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu');
    this.renameItem.type = 'button';
    this.renameItem.dataset['room'] = 'rename';
    this.renameItem.setAttribute('role', 'menuitem');
    this.renameItem.addEventListener('click', () => {
      const id = this.menuId;
      this.hideMenu();
      if (id !== null) this.startRename(id);
    });
    this.deleteItem.type = 'button';
    this.deleteItem.dataset['room'] = 'delete';
    this.deleteItem.setAttribute('role', 'menuitem');
    this.deleteItem.addEventListener('click', () => {
      const id = this.menuId;
      this.hideMenu();
      if (id !== null) this.askDelete(id);
    });
    this.menu.append(this.renameItem, this.deleteItem);
    this.confirm.hidden = true;
    this.confirm.dataset['room'] = 'delete-confirm';
    this.confirm.setAttribute('role', 'alertdialog');
    this.confirmYes.type = 'button';
    this.confirmYes.dataset['room'] = 'delete-yes';
    this.confirmNo.type = 'button';
    this.confirmNo.dataset['room'] = 'delete-no';
    this.confirm.append(this.confirmText, this.confirmYes, this.confirmNo);
    this.confirmYes.addEventListener('click', () => {
      const id = this.pendingId;
      this.setPending(null);
      if (id !== null) this.handlers.onDelete(id);
    });
    this.confirmNo.addEventListener('click', () => this.cancelDelete());
    this.element.append(header, this.list, this.confirm, this.menu);
    document.addEventListener('click', () => this.hideMenu());
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (this.pendingId !== null) {
        this.cancelDelete();
      } else if (this.menuId !== null) {
        const id = this.menuId;
        this.hideMenu();
        this.focusItem(id);
      }
    });
    this.render();
  }

  setState(state: RoomTreeState): void {
    this.state = state;
    this.render();
  }

  setPaneOpen(open: boolean): void {
    if (open === this.paneOpen) return;
    this.paneOpen = open;
    this.render();
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.hideMenu();
    this.render();
  }

  private render(): void {
    this.toggle.setAttribute('aria-expanded', String(this.expanded));
    this.add.disabled = this.state.busy;
    this.list.hidden = !this.expanded;
    if (this.pendingId !== null && (this.state.busy || !this.state.rows.some((row) => row.id === this.pendingId))) this.setPending(null);
    if (!this.expanded) {
      this.editing = null;
      this.list.replaceChildren();
      return;
    }
    if (this.editing !== null && !this.state.rows.some((row) => row.id === this.editing?.id)) this.editing = null;
    if (this.state.rows.length === 0) {
      this.list.replaceChildren(el('li', 'rooms-empty', 'No saved rooms yet.'));
      return;
    }
    this.rebuilding = true;
    this.list.replaceChildren(...this.state.rows.map((row) => this.item(row)));
    this.rebuilding = false;
    if (this.editing !== null) this.focusInput(false);
  }

  private item(row: RoomTreeRow): HTMLLIElement {
    const item = el('li');
    if (this.editing?.id === row.id) {
      item.append(this.input(this.editing));
      return item;
    }
    const button = el('button', 'rooms-item');
    button.type = 'button';
    button.dataset['roomId'] = row.id;
    button.title = row.label;
    button.disabled = row.unreadable;
    button.append(el('span', 'rooms-item-label', row.label));
    const current = row.current && this.paneOpen;
    button.classList.toggle('selected', current);
    if (current) button.setAttribute('aria-current', 'true');
    if (this.state.busy) button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', () => {
      if (!this.state.busy) this.handlers.onOpen(row.id);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'F2' && !row.unreadable) {
        event.preventDefault();
        this.startRename(row.id);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !row.unreadable) {
        event.preventDefault();
        this.askDelete(row.id);
      }
    });
    if (!row.unreadable) {
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const box = button.getBoundingClientRect();
        const keyboard = event.clientX === 0 && event.clientY === 0;
        this.showMenu(row.id, keyboard ? box.left : event.clientX, keyboard ? box.bottom : event.clientY);
      });
    }
    item.append(button);
    return item;
  }

  private input(editing: Editing): HTMLInputElement {
    const input = el('input', 'rooms-rename');
    input.type = 'text';
    input.maxLength = MAX_TITLE_LENGTH;
    input.value = editing.draft;
    input.dataset['room'] = 'rename-input';
    input.setAttribute('aria-label', 'Room title');
    input.addEventListener('input', () => {
      editing.draft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.finishRename(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.finishRename(false);
      }
    });
    input.addEventListener('blur', () => {
      if (!this.rebuilding && this.editing === editing) this.finishRename(false);
    });
    return input;
  }

  private startRename(id: string): void {
    const row = this.state.rows.find((item) => item.id === id);
    if (row === undefined || row.unreadable) return;
    this.editing = { id, draft: row.label };
    this.render();
    this.focusInput(true);
  }

  private finishRename(commit: boolean): void {
    const editing = this.editing;
    if (editing === null) return;
    this.editing = null;
    const row = this.state.rows.find((item) => item.id === editing.id);
    const next = commit && row !== undefined ? renameTitle(row.label, editing.draft) : null;
    this.render();
    this.focusItem(editing.id);
    if (next !== null) this.handlers.onRename(editing.id, next);
  }

  private focusInput(selectAll: boolean): void {
    const input = this.list.querySelector<HTMLInputElement>('.rooms-rename');
    if (input === null || document.activeElement === input) return;
    input.focus();
    if (selectAll) input.select();
  }

  private focusItem(id: string): void {
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('.rooms-item')) {
      if (button.dataset['roomId'] === id) button.focus();
    }
  }

  private askDelete(id: string): void {
    const row = this.state.rows.find((item) => item.id === id);
    if (row === undefined || row.unreadable || this.state.busy) return;
    this.hideMenu();
    this.setPending(id);
    this.confirmNo.focus();
  }

  private cancelDelete(): void {
    const id = this.pendingId;
    this.setPending(null);
    if (id !== null) this.focusItem(id);
  }

  private setPending(id: string | null): void {
    this.pendingId = id;
    const row = this.state.rows.find((item) => item.id === id);
    this.confirm.hidden = row === undefined;
    this.confirmText.textContent = row === undefined ? '' : `Delete ${row.label}? It moves to the Trash.`;
  }

  private showMenu(id: string, x: number, y: number): void {
    this.menuId = id;
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;
    this.deleteItem.disabled = this.state.busy;
    this.menu.hidden = false;
    this.renameItem.focus();
  }

  private hideMenu(): void {
    this.menuId = null;
    this.menu.hidden = true;
  }
}
