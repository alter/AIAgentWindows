// project-tree.ts
import type { AgentKind } from '../shared/agents';
import type { AppApi } from '../shared/ipc';
import { pointAnchor } from '../shared/popup-place';
import { MAX_PROJECT_NAME_CHARS, MAX_FOLDER_NAME_BYTES, parseProjectName, type ProjectView } from '../shared/projects';
import type { TreeItem, TreeNode, TreeSection } from '../shared/sidebar-tree';
import { ADD_OPTIONS } from './agent-options';
import { el } from './dom';
import { kindIcon } from './icons';
import { hidePopup, showPopup } from './popup';

export type ProjectsApi = Pick<AppApi, 'projectsList' | 'projectsPickParent' | 'projectsCreate' | 'projectsAddExisting' | 'projectsRename' | 'projectsDelete'>;

export interface ProjectTreeHandlers {
  onList(projects: readonly ProjectView[]): void;
  onToggle(key: string): void;
  onAddAgent(kind: AgentKind, projectId: string): void;
  onSelectAgent(id: string): void;
  onCloseAgent(id: string): void;
}

interface Editing {
  id: string;
  draft: string;
}

interface NewFolder {
  token: string;
  parentName: string;
}

const SECTION_TITLES: Readonly<Record<string, string>> = { rooms: '# Rooms', agents: 'Agents' };

export class ProjectTree {
  readonly element = el('section', 'projects');
  private readonly addButton = el('button', 'projects-add', '+');
  private readonly addMenu = el('div', 'projects-add-menu');
  private readonly notice = el('p', 'projects-notice');
  private readonly form = el('div', 'projects-form');
  private readonly formLabel = el('label', 'projects-form-label');
  private readonly nameInput = el('input', 'projects-name-input');
  private readonly create = el('button', 'projects-form-button', 'Create');
  private readonly cancel = el('button', 'projects-form-button', 'Cancel');
  private readonly list = el('ul', 'projects-list');
  private readonly menu = el('div', 'projects-menu');
  private readonly agentMenu = el('div', 'projects-menu');
  private readonly agentConfirm = el('div', 'projects-confirm');
  private readonly agentConfirmText = el('span', 'projects-confirm-text');
  private readonly agentConfirmYes = el('button', 'projects-confirm-yes', 'Close agent');
  private readonly agentConfirmNo = el('button', 'projects-confirm-no', 'Cancel');
  private readonly confirm = el('div', 'projects-confirm');
  private readonly confirmText = el('span', 'projects-confirm-text');
  private readonly confirmYes = el('button', 'projects-confirm-yes', 'Delete');
  private readonly confirmNo = el('button', 'projects-confirm-no', 'Cancel');
  private nodes: readonly TreeNode[] = [];
  private newFolder: NewFolder | null = null;
  private menuId: string | null = null;
  private pendingId: string | null = null;
  private pendingAgentId: string | null = null;
  private agentMenuProject: string | null = null;
  private editing: Editing | null = null;
  private rebuilding = false;
  private addMenuOpen = false;

  constructor(
    private readonly api: ProjectsApi,
    private readonly handlers: ProjectTreeHandlers,
  ) {
    this.element.dataset['project'] = 'tree';
    const header = el('div', 'projects-header');
    header.append(el('span', 'projects-title', 'Projects'), this.addButton);
    this.setupAdd();
    this.setupForm();
    this.setupMenu();
    this.setupConfirm();
    this.setupAgentMenu();
    this.setupAgentConfirm();
    this.notice.hidden = true;
    this.notice.dataset['project'] = 'notice';
    this.notice.setAttribute('role', 'status');
    this.list.dataset['project'] = 'list';
    this.element.append(header, this.addMenu, this.notice, this.form, this.list, this.confirm, this.agentConfirm, this.menu, this.agentMenu);
    document.addEventListener('click', () => {
      this.setAddMenu(false);
      this.hideMenu();
      this.hideAgentMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.setAddMenu(false);
      this.hideMenu();
      this.hideAgentMenu();
      this.setPending(null);
      this.setPendingAgent(null);
      this.closeForm();
    });
  }

  refresh(): void {
    void this.api
      .projectsList()
      .then((projects) => this.handlers.onList(projects))
      .catch(() => this.showNotice('The project list could not be read.'));
  }

  setNodes(nodes: readonly TreeNode[]): void {
    this.nodes = nodes.filter((node) => node.projectId !== null);
    const ids = new Set(this.nodes.map((node) => node.projectId));
    if (this.pendingId !== null && !ids.has(this.pendingId)) this.setPending(null);
    if (this.agentMenuProject !== null && !ids.has(this.agentMenuProject)) this.hideAgentMenu();
    if (this.pendingAgentId !== null && this.agentLabel(this.pendingAgentId) === null) this.setPendingAgent(null);
    if (this.editing !== null && !ids.has(this.editing.id)) this.editing = null;
    this.render();
  }

  notify(text: string): void {
    this.showNotice(text);
  }

  private showNotice(text: string): void {
    this.notice.textContent = text;
    this.notice.hidden = text === '';
  }

  private setupAdd(): void {
    this.addButton.type = 'button';
    this.addButton.dataset['project'] = 'add';
    this.addButton.title = 'Add project';
    this.addButton.setAttribute('aria-label', 'Add project');
    this.addButton.setAttribute('aria-haspopup', 'menu');
    this.addButton.setAttribute('aria-expanded', 'false');
    this.addButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.hideMenu();
      this.setAddMenu(!this.addMenuOpen);
    });
    this.addMenu.hidden = true;
    this.addMenu.setAttribute('role', 'menu');
    const existing = this.menuButton('Existing folder…', 'add-existing', () => void this.addExisting());
    const fresh = this.menuButton('New folder…', 'add-new', () => void this.pickParent());
    this.addMenu.append(existing, fresh);
  }

  private menuButton(label: string, name: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'projects-menu-item', label);
    button.type = 'button';
    button.dataset['project'] = name;
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => {
      this.setAddMenu(false);
      this.hideMenu();
      onClick();
    });
    return button;
  }

  private setAddMenu(open: boolean): void {
    this.addMenuOpen = open;
    this.addMenu.hidden = !open;
    this.addButton.setAttribute('aria-expanded', String(open));
  }

  private setupForm(): void {
    this.form.hidden = true;
    this.form.dataset['project'] = 'new-form';
    this.nameInput.type = 'text';
    this.nameInput.maxLength = Math.min(MAX_PROJECT_NAME_CHARS, MAX_FOLDER_NAME_BYTES);
    this.nameInput.dataset['project'] = 'name-input';
    this.nameInput.setAttribute('aria-label', 'Name of the new folder');
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.submitNew();
      }
    });
    this.create.type = 'button';
    this.create.dataset['project'] = 'create';
    this.create.addEventListener('click', () => void this.submitNew());
    this.cancel.type = 'button';
    this.cancel.dataset['project'] = 'create-cancel';
    this.cancel.addEventListener('click', () => this.closeForm());
    this.form.append(this.formLabel, this.nameInput, this.create, this.cancel);
  }

  private closeForm(): void {
    this.newFolder = null;
    this.form.hidden = true;
    this.nameInput.value = '';
  }

  private async addExisting(): Promise<void> {
    try {
      const result = await this.api.projectsAddExisting();
      if (result.ok) this.showNotice('');
      else if (result.cancelled !== true) this.showNotice(result.error);
      this.refresh();
    } catch {
      this.showNotice('The project could not be added.');
    }
  }

  private async pickParent(): Promise<void> {
    try {
      const result = await this.api.projectsPickParent();
      if (!result.ok) return;
      this.newFolder = { token: result.token, parentName: result.parentName };
      this.formLabel.textContent = `New folder in ${result.parentName}`;
      this.nameInput.value = '';
      this.form.hidden = false;
      this.showNotice('');
      this.nameInput.focus();
    } catch {
      this.showNotice('The parent folder could not be chosen.');
    }
  }

  private async submitNew(): Promise<void> {
    const target = this.newFolder;
    if (target === null) return;
    try {
      const result = await this.api.projectsCreate(target.token, this.nameInput.value);
      if (result.ok) {
        this.closeForm();
        this.showNotice('');
        this.refresh();
      } else {
        this.showNotice(result.error);
      }
    } catch {
      this.showNotice('The project could not be created.');
    }
  }

  private setupMenu(): void {
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu');
    const rename = el('button', 'projects-menu-item', 'Rename');
    rename.type = 'button';
    rename.dataset['project'] = 'rename';
    rename.setAttribute('role', 'menuitem');
    rename.addEventListener('click', () => {
      const id = this.menuId;
      this.hideMenu();
      if (id !== null) this.startRename(id);
    });
    const remove = el('button', 'projects-menu-item', 'Delete');
    remove.type = 'button';
    remove.dataset['project'] = 'delete';
    remove.setAttribute('role', 'menuitem');
    remove.addEventListener('click', () => {
      const id = this.menuId;
      this.hideMenu();
      if (id !== null) this.setPending(id);
    });
    this.menu.append(rename, remove);
  }

  private setupConfirm(): void {
    this.confirm.hidden = true;
    this.confirm.dataset['project'] = 'delete-confirm';
    this.confirm.setAttribute('role', 'alertdialog');
    this.confirmYes.type = 'button';
    this.confirmYes.dataset['project'] = 'delete-yes';
    this.confirmNo.type = 'button';
    this.confirmNo.dataset['project'] = 'delete-no';
    this.confirm.append(this.confirmText, this.confirmYes, this.confirmNo);
    this.confirmYes.addEventListener('click', () => {
      const id = this.pendingId;
      this.setPending(null);
      if (id !== null) void this.remove(id);
    });
    this.confirmNo.addEventListener('click', () => this.setPending(null));
  }

  private setPending(id: string | null): void {
    this.pendingId = id;
    const node = this.nodes.find((item) => item.projectId === id);
    this.confirm.hidden = node === undefined;
    this.confirmText.textContent = node === undefined ? '' : `Delete project ${node.label}? Its folder on disk stays as it is.`;
    if (node !== undefined) this.confirmNo.focus();
  }

  private async remove(id: string): Promise<void> {
    try {
      const result = await this.api.projectsDelete(id);
      this.showNotice(result.ok ? (result.warning ?? '') : result.error);
      this.refresh();
    } catch {
      this.showNotice('The project could not be deleted.');
    }
  }

  private startRename(id: string): void {
    const node = this.nodes.find((item) => item.projectId === id);
    if (node === undefined) return;
    this.editing = { id, draft: node.label };
    this.render();
    this.focusInput();
  }

  private async finishRename(commit: boolean): Promise<void> {
    const editing = this.editing;
    if (editing === null) return;
    this.editing = null;
    const node = this.nodes.find((item) => item.projectId === editing.id);
    const next = commit ? parseProjectName(editing.draft) : null;
    this.render();
    if (next === null || node === undefined || next === node.label) {
      if (commit && next === null) this.showNotice(`The name must be 1 to ${MAX_PROJECT_NAME_CHARS} characters without control characters.`);
      return;
    }
    try {
      const result = await this.api.projectsRename(editing.id, next);
      this.showNotice(result.ok ? '' : result.error);
      this.refresh();
    } catch {
      this.showNotice('The project could not be renamed.');
    }
  }

  private focusInput(): void {
    const input = this.list.querySelector<HTMLInputElement>('.projects-rename');
    if (input === null || document.activeElement === input) return;
    input.focus();
    input.select();
  }

  private hideMenu(): void {
    this.menuId = null;
    hidePopup(this.menu);
  }

  private showMenu(id: string, x: number, y: number): void {
    this.setAddMenu(false);
    this.hideAgentMenu();
    this.menuId = id;
    showPopup(this.menu, () => pointAnchor(x, y));
    this.menu.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private render(): void {
    this.rebuilding = true;
    this.list.replaceChildren(...this.nodes.map((node) => this.item(node)));
    this.rebuilding = false;
    if (this.editing !== null) this.focusInput();
  }

  private item(node: TreeNode): HTMLLIElement {
    const id = node.projectId ?? '';
    const item = el('li', 'project-node');
    item.dataset['projectId'] = id;
    item.dataset['projectMissing'] = String(node.missing);
    const row = el('div', 'project-row');
    const toggle = el('button', 'project-toggle');
    toggle.type = 'button';
    toggle.dataset['project'] = 'toggle';
    toggle.setAttribute('aria-label', `Collapse ${node.label}`);
    toggle.setAttribute('aria-expanded', String(node.expanded));
    toggle.addEventListener('click', () => this.handlers.onToggle(node.key));
    row.append(toggle, this.editing?.id === id ? this.input(this.editing) : this.nameButton(node));
    if (this.editing?.id !== id) row.append(this.actionsButton(node));
    item.append(row);
    if (node.missing) {
      const note = el('p', 'project-missing-note', `Folder missing: ${node.folder ?? ''}`);
      note.dataset['project'] = 'missing';
      item.append(note);
    } else if (node.expanded) {
      for (const section of node.sections) item.append(this.section(node, section));
    }
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showMenu(id, event.clientX, event.clientY);
    });
    return item;
  }

  private nameButton(node: TreeNode): HTMLButtonElement {
    const id = node.projectId ?? '';
    const button = el('button', 'project-name');
    button.type = 'button';
    button.dataset['project'] = 'node';
    button.title = node.folder ?? node.label;
    button.append(el('span', 'project-name-label', node.label));
    if (node.missing) button.append(el('span', 'project-name-flag', ' (missing)'));
    button.addEventListener('click', () => this.handlers.onToggle(node.key));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        this.startRename(id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.setPending(id);
      }
    });
    return button;
  }

  private actionsButton(node: TreeNode): HTMLButtonElement {
    const id = node.projectId ?? '';
    const button = el('button', 'project-actions', '⋯');
    button.type = 'button';
    button.dataset['project'] = 'menu';
    button.title = 'Project actions';
    button.setAttribute('aria-label', `Actions for ${node.label}`);
    button.setAttribute('aria-haspopup', 'menu');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const box = button.getBoundingClientRect();
      this.showMenu(id, box.left, box.bottom);
    });
    return button;
  }

  private section(node: TreeNode, section: TreeSection): HTMLElement {
    const name = section.key.split(':')[2] ?? '';
    const box = el('div', 'project-section');
    box.dataset['projectSection'] = name;
    const toggle = el('button', 'project-section-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', SECTION_TITLES[name] ?? name);
    toggle.setAttribute('aria-expanded', String(section.expanded));
    toggle.addEventListener('click', () => this.handlers.onToggle(section.key));
    const head = el('div', 'project-section-head');
    head.append(toggle, el('span', 'project-section-title', SECTION_TITLES[name] ?? name));
    if (name === 'agents') head.append(this.agentAddButton(node));
    box.append(head);
    if (section.expanded) {
      const items = el('ul', 'project-section-list');
      for (const item of section.items) items.append(this.agentItem(item));
      if (section.items.length === 0) items.append(el('li', 'project-section-empty', name === 'agents' ? 'No agents yet. Use + to add one.' : 'Nothing here yet.'));
      box.append(items);
    }
    return box;
  }

  private agentAddButton(node: TreeNode): HTMLButtonElement {
    const id = node.projectId ?? '';
    const button = el('button', 'project-agent-add', '+');
    button.type = 'button';
    button.dataset['project'] = 'add-agent';
    button.title = 'Add agent';
    button.setAttribute('aria-label', `Add agent to ${node.label}`);
    button.setAttribute('aria-haspopup', 'menu');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const box = button.getBoundingClientRect();
      this.showAgentMenu(id, box.left, box.bottom);
    });
    return button;
  }

  private agentItem(item: TreeItem): HTMLLIElement {
    const row = el('li', 'project-agent');
    const kind = item.kind;
    if (kind === null) return row;
    const select = el('button', 'agent-item');
    select.type = 'button';
    select.dataset['agentId'] = item.id;
    select.title = item.label;
    if (item.selected) select.classList.add('selected');
    select.append(kindIcon(kind), el('span', 'agent-title', item.label));
    select.addEventListener('click', () => this.handlers.onSelectAgent(item.id));
    const close = el('button', 'agent-close', '×');
    close.type = 'button';
    close.dataset['project'] = 'close-agent';
    close.title = 'Close agent';
    close.setAttribute('aria-label', `Close ${item.label}`);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setPendingAgent(item.id);
    });
    row.append(select, close);
    return row;
  }

  private agentLabel(id: string): string | null {
    for (const node of this.nodes) {
      for (const section of node.sections) {
        const found = section.items.find((item) => item.id === id);
        if (found !== undefined) return found.label;
      }
    }
    return null;
  }

  private setupAgentMenu(): void {
    this.agentMenu.hidden = true;
    this.agentMenu.setAttribute('role', 'menu');
    this.agentMenu.dataset['project'] = 'agent-menu';
    for (const option of ADD_OPTIONS) {
      const button = el('button', 'projects-menu-item');
      button.type = 'button';
      button.dataset['kind'] = option.kind;
      button.setAttribute('role', 'menuitem');
      button.append(kindIcon(option.kind), el('span', undefined, option.label));
      button.addEventListener('click', () => {
        const id = this.agentMenuProject;
        this.hideAgentMenu();
        if (id !== null) this.handlers.onAddAgent(option.kind, id);
      });
      this.agentMenu.append(button);
    }
  }

  private showAgentMenu(id: string, x: number, y: number): void {
    this.setAddMenu(false);
    this.hideMenu();
    this.agentMenuProject = id;
    showPopup(this.agentMenu, () => pointAnchor(x, y));
    this.agentMenu.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private hideAgentMenu(): void {
    this.agentMenuProject = null;
    hidePopup(this.agentMenu);
  }

  private setupAgentConfirm(): void {
    this.agentConfirm.hidden = true;
    this.agentConfirm.dataset['project'] = 'agent-close-confirm';
    this.agentConfirm.setAttribute('role', 'alertdialog');
    this.agentConfirmYes.type = 'button';
    this.agentConfirmYes.dataset['project'] = 'agent-close-yes';
    this.agentConfirmNo.type = 'button';
    this.agentConfirmNo.dataset['project'] = 'agent-close-no';
    this.agentConfirm.append(this.agentConfirmText, this.agentConfirmYes, this.agentConfirmNo);
    this.agentConfirmYes.addEventListener('click', () => {
      const id = this.pendingAgentId;
      this.setPendingAgent(null);
      if (id !== null) this.handlers.onCloseAgent(id);
    });
    this.agentConfirmNo.addEventListener('click', () => this.setPendingAgent(null));
  }

  private setPendingAgent(id: string | null): void {
    const label = id === null ? null : this.agentLabel(id);
    this.pendingAgentId = label === null ? null : id;
    this.agentConfirm.hidden = label === null;
    this.agentConfirmText.textContent = label === null ? '' : `Close ${label}? Its session files stay on disk.`;
    if (label !== null) this.agentConfirmNo.focus();
  }

  private input(editing: Editing): HTMLInputElement {
    const input = el('input', 'projects-rename');
    input.type = 'text';
    input.maxLength = MAX_PROJECT_NAME_CHARS;
    input.value = editing.draft;
    input.dataset['project'] = 'rename-input';
    input.setAttribute('aria-label', 'Project name');
    input.addEventListener('input', () => {
      editing.draft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.finishRename(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        void this.finishRename(false);
      }
    });
    input.addEventListener('blur', () => {
      if (!this.rebuilding && this.editing === editing) void this.finishRename(false);
    });
    return input;
  }
}
