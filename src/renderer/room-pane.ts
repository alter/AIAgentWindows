// room-pane.ts
import { AGENT_LABELS, isCliKind, isSiteKind, type Agent, type AgentKind } from '../shared/agents';
import { emptyRoomModels, type RoomModels } from '../shared/cli-models';
import type { PtyDataEvent } from '../shared/ipc';
import { MAX_ROUNDS, MIN_ROUNDS, ROOM_PARTICIPANTS, type RoomEvent, type RoomListItem, type RoomMode } from '../shared/room-model';
import {
  addRow,
  applyRoomEvent,
  defaultRows,
  effortChoices,
  emptyRoomSnapshot,
  finalizerChoices,
  formToConfig,
  modelSuggestions,
  participantAvailability,
  removeRow,
  resolveFinalizer,
  roomListOption,
  roomProgress,
  type CarryWhat,
  type FormRow,
  type RoomFormValues,
  type RoomSnapshot,
} from '../shared/room-view';
import { api } from './api';
import { el } from './dom';
import { RoomFeed } from './room-feed';
import { TerminalPane, roomSessionIo } from './terminal-pane';

const DEFAULT_TIMEOUT_MINUTES = '10';
const CLI_KINDS: readonly AgentKind[] = ['claude', 'codex'];

interface RowView {
  id: string;
  kind: AgentKind;
  root: HTMLElement;
  box: HTMLInputElement;
  model: HTMLInputElement;
  effort: HTMLSelectElement;
  remove: HTMLButtonElement;
}

function labeled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = el('label');
  label.append(control, el('span', undefined, text));
  return label;
}

function field(text: string, control: HTMLElement): HTMLLabelElement {
  const label = el('label');
  label.append(el('span', undefined, text), control);
  return label;
}

export class RoomPane {
  readonly element = el('section', 'room-pane');
  private readonly feed = new RoomFeed(() => void this.onCopyFinal());
  private readonly prompt = el('textarea', 'room-prompt');
  private readonly boxes = new Map<string, HTMLInputElement>();
  private readonly people = el('div', 'room-row room-people');
  private readonly datalists = new Map<AgentKind, HTMLDataListElement>();
  private rows: RowView[] = [];
  private models: RoomModels = emptyRoomModels();
  private readonly mode = el('select');
  private readonly rounds = el('input');
  private readonly timeout = el('input');
  private readonly finalizer = el('select');
  private readonly debugSites = el('input');
  private readonly rooms = el('select', 'room-list');
  private readonly newRoom = el('button', 'room-button', 'New room');
  private readonly start = el('button', 'room-button', 'Start');
  private readonly stop = el('button', 'room-button stop', 'Stop');
  private readonly progress = el('div', 'room-progress');
  private readonly headline = el('div', 'room-headline');
  private readonly remaining = el('div', 'room-remaining');
  private readonly chips = el('div', 'room-chips');
  private readonly banner = el('div', 'room-banner');
  private readonly status = el('div', 'room-status');
  private readonly message = el('div', 'room-message');
  private readonly target = el('select');
  private readonly carryFinal = el('button', 'room-button', 'Carry final reply');
  private readonly carryHistory = el('button', 'room-button', 'Carry history');
  private readonly pause = el('div', 'room-pause');
  private readonly pauseNotes = el('div', 'room-pause-notes');
  private readonly terminals = el('div', 'room-terminals');
  private readonly resume = el('button', 'room-button', 'Resume');
  private readonly sessions = new Map<string, TerminalPane>();
  private readonly observer = new ResizeObserver(() => {
    for (const pane of this.sessions.values()) pane.refit();
  });
  private readonly sites: HTMLElement[] = [];
  private snapshot: RoomSnapshot = emptyRoomSnapshot();
  private debugDir: string | null = null;
  private openedId: string | null = null;
  private listed: readonly RoomListItem[] = [];

  constructor() {
    this.element.hidden = true;
    this.element.dataset['room'] = 'pane';
    this.prompt.placeholder = 'Prompt for the room';
    this.prompt.dataset['room'] = 'prompt';
    this.status.dataset['room'] = 'status';
    this.progress.dataset['room'] = 'progress';
    this.headline.dataset['room'] = 'round';
    this.remaining.dataset['room'] = 'remaining';
    this.chips.dataset['room'] = 'chips';
    this.banner.dataset['room'] = 'banner';
    this.progress.hidden = true;
    const counters = el('div', 'room-progress-row');
    counters.append(this.headline, this.remaining);
    this.progress.append(this.banner, counters, this.chips);
    this.message.dataset['room'] = 'message';
    this.pause.hidden = true;
    this.pause.dataset['room'] = 'pause';
    this.pauseNotes.dataset['room'] = 'pause-note';
    this.terminals.dataset['room'] = 'terminals';
    this.resume.type = 'button';
    this.resume.dataset['room'] = 'resume';
    this.resume.addEventListener('click', () => void api.roomResume());
    this.pause.append(this.pauseNotes, this.terminals, this.resume);
    this.element.append(el('h2', 'room-title', 'Room'), this.archive(), this.progress, this.feed.element, this.pause, this.controls());
    this.renderFeed();
    this.renderState();
    void this.loadModels();
  }

  show(): void {
    this.element.hidden = false;
    void this.refreshList();
  }

  hide(): void {
    this.element.hidden = true;
  }

  load(snapshot: RoomSnapshot): void {
    this.snapshot = snapshot;
    this.feed.reload(snapshot);
    this.renderState();
    void this.refreshList();
    if (snapshot.roomId !== null && snapshot.phase !== 'running' && this.openedId === null) void this.openRoom(snapshot.roomId);
  }

  apply(event: RoomEvent): void {
    this.snapshot = applyRoomEvent(this.snapshot, event);
    if (this.snapshot.roomId !== null) this.openedId = this.snapshot.roomId;
    this.renderFeed();
    this.renderState();
    if (event.type === 'finished') void this.refreshList();
  }

  terminalData(event: PtyDataEvent): void {
    this.sessions.get(event.id)?.push(event);
  }

  setAgents(agents: readonly Agent[]): void {
    const previous = this.target.value;
    this.target.replaceChildren();
    for (const agent of agents.filter((item) => isCliKind(item.kind))) {
      const option = el('option', undefined, agent.title);
      option.value = agent.id;
      this.target.append(option);
    }
    if (previous.length > 0) this.target.value = previous;
    this.renderState();
  }

  private archive(): HTMLElement {
    const row = el('div', 'room-row room-archive');
    this.rooms.dataset['room'] = 'rooms';
    this.newRoom.type = 'button';
    this.newRoom.dataset['room'] = 'new';
    this.rooms.addEventListener('change', () => {
      if (this.rooms.value !== '') void this.openRoom(this.rooms.value);
    });
    this.newRoom.addEventListener('click', () => void this.onNewRoom());
    row.append(field('Rooms', this.rooms), this.newRoom);
    return row;
  }

  private async refreshList(): Promise<void> {
    this.listed = await api.roomList().catch(() => []);
    this.renderList();
  }

  private renderList(): void {
    const placeholder = el('option', undefined, this.listed.length === 0 ? 'No saved rooms' : `Saved rooms (${this.listed.length})`);
    placeholder.value = '';
    this.rooms.replaceChildren(placeholder);
    for (const item of this.listed.map(roomListOption)) {
      const option = el('option', undefined, item.label);
      option.value = item.id;
      option.disabled = item.disabled;
      this.rooms.append(option);
    }
    this.rooms.value = this.openedId !== null && this.listed.some((item) => item.id === this.openedId) ? this.openedId : '';
  }

  private async openRoom(id: string): Promise<void> {
    this.message.textContent = '';
    const opened = await api.roomOpen(id);
    if (!opened.ok) {
      this.message.textContent = opened.error;
      this.renderList();
      return;
    }
    this.openedId = id;
    this.debugDir = null;
    this.snapshot = opened.snapshot;
    this.applyForm(opened.form);
    this.feed.reload(opened.snapshot);
    this.renderState();
    this.renderList();
  }

  private async onNewRoom(): Promise<void> {
    if (!(await api.roomNew())) {
      this.message.textContent = 'A run is in progress: stop it first.';
      return;
    }
    this.openedId = null;
    this.debugDir = null;
    this.message.textContent = '';
    this.prompt.value = '';
    this.snapshot = emptyRoomSnapshot();
    this.feed.reload(this.snapshot);
    this.renderState();
    this.renderList();
  }

  private applyForm(form: RoomFormValues): void {
    this.renderRows(form.rows ?? defaultRows(), form.checked);
    for (const [id, input] of this.boxes) input.checked = form.checked.includes(id) && !input.disabled;
    this.prompt.value = form.prompt;
    this.mode.value = form.mode;
    this.rounds.value = form.rounds;
    this.timeout.value = form.timeoutMinutes;
    this.debugSites.checked = form.debugSites ?? false;
    this.renderFinalizer();
    this.finalizer.value = resolveFinalizer(this.checkedIds(), form.finalizerId ?? '', this.currentRows());
  }

  private controls(): HTMLElement {
    const box = el('div', 'room-controls');
    this.people.dataset['room'] = 'participants';
    for (const kind of CLI_KINDS) {
      const list = el('datalist');
      list.id = `room-models-${kind}`;
      this.datalists.set(kind, list);
      box.append(list);
    }
    for (const participant of ROOM_PARTICIPANTS.filter((item) => isSiteKind(item.kind))) {
      const input = el('input');
      input.type = 'checkbox';
      input.dataset['participant'] = participant.id;
      input.addEventListener('change', () => this.renderFinalizer());
      this.boxes.set(participant.id, input);
      const availability = participantAvailability(participant);
      input.disabled = !availability.available;
      const item = labeled(participant.label, input);
      if (!availability.available) {
        item.title = availability.note;
        item.classList.add('unavailable');
        item.append(el('span', 'room-unavailable', 'no adapter'));
      }
      this.sites.push(item);
    }
    this.renderRows(defaultRows(), []);
    this.mode.dataset['room'] = 'mode';
    for (const [value, text] of [['broadcast', 'To all'], ['relay', 'Relay']] as const) {
      const option = el('option', undefined, text);
      option.value = value;
      this.mode.append(option);
    }
    this.rounds.type = 'number';
    this.rounds.min = String(MIN_ROUNDS);
    this.rounds.max = String(MAX_ROUNDS);
    this.rounds.value = '2';
    this.rounds.dataset['room'] = 'rounds';
    this.timeout.type = 'number';
    this.timeout.min = '0.1';
    this.timeout.step = 'any';
    this.timeout.value = DEFAULT_TIMEOUT_MINUTES;
    this.timeout.dataset['room'] = 'timeout';
    this.finalizer.dataset['room'] = 'finalizer';
    this.debugSites.type = 'checkbox';
    this.debugSites.dataset['room'] = 'debug-sites';
    this.start.type = 'button';
    this.start.dataset['room'] = 'start';
    this.stop.type = 'button';
    this.stop.dataset['room'] = 'stop';
    const settings = el('div', 'room-row');
    settings.append(field('Mode', this.mode), field('Rounds', this.rounds), field('Turn timeout (min)', this.timeout), field('Finalizer', this.finalizer), labeled('Record site debug', this.debugSites), this.start, this.stop);
    const carry = el('div', 'room-row');
    this.target.dataset['room'] = 'carry-target';
    this.carryFinal.type = 'button';
    this.carryFinal.dataset['room'] = 'carry-final';
    this.carryHistory.type = 'button';
    this.carryHistory.dataset['room'] = 'carry-history';
    carry.append(field('Working session', this.target), this.carryFinal, this.carryHistory);
    box.append(this.prompt, this.people, settings, this.status, this.message, carry);
    this.start.addEventListener('click', () => void this.onStart());
    this.stop.addEventListener('click', () => void api.roomStop());
    this.mode.addEventListener('change', () => this.renderState());
    this.carryFinal.addEventListener('click', () => void this.onCarry('final'));
    this.carryHistory.addEventListener('click', () => void this.onCarry('history'));
    return box;
  }

  private checkedIds(): string[] {
    const ticked = [...this.boxes].filter(([, input]) => input.checked).map(([id]) => id);
    return [...this.rows.filter((view) => view.box.checked).map((view) => view.id), ...ticked];
  }

  private currentRows(): FormRow[] {
    return this.rows.map((view) => ({ id: view.id, kind: view.kind, model: view.model.value, effort: view.effort.value }));
  }

  private async loadModels(): Promise<void> {
    this.models = await api.roomModels().catch(() => emptyRoomModels());
    for (const [kind, list] of this.datalists) {
      list.replaceChildren(
        ...modelSuggestions(kind, this.models).map((name) => {
          const option = el('option');
          option.value = name;
          return option;
        }),
      );
    }
    for (const view of this.rows) this.refreshEfforts(view);
  }

  private refreshEfforts(view: RowView): void {
    const current = view.effort.value;
    const none = el('option', undefined, 'CLI default');
    none.value = '';
    view.effort.replaceChildren(none);
    for (const level of effortChoices(view.kind, view.model.value, current, this.models)) {
      const option = el('option', undefined, level);
      option.value = level;
      view.effort.append(option);
    }
    view.effort.value = current;
  }

  private buildRow(row: FormRow, checked: boolean): RowView {
    const root = el('div', 'room-participant');
    root.dataset['row'] = row.id;
    const box = el('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.dataset['participant'] = row.id;
    const model = el('input');
    model.type = 'text';
    model.value = row.model ?? '';
    model.placeholder = 'model';
    model.setAttribute('list', `room-models-${row.kind}`);
    model.dataset['rowField'] = 'model';
    model.spellcheck = false;
    const effort = el('select');
    effort.dataset['rowField'] = 'effort';
    const remove = el('button', 'room-row-remove', '\u00d7');
    remove.type = 'button';
    remove.title = 'Remove';
    remove.dataset['rowField'] = 'remove';
    const view: RowView = { id: row.id, kind: row.kind, root, box, model, effort, remove };
    root.append(labeled(AGENT_LABELS[row.kind], box), model, effort, remove);
    const none = el('option', undefined, 'CLI default');
    none.value = '';
    effort.append(none);
    if (row.effort !== undefined && row.effort !== '') {
      effort.append(Object.assign(el('option', undefined, row.effort), { value: row.effort }));
      effort.value = row.effort;
    }
    box.addEventListener('change', () => this.renderFinalizer());
    model.addEventListener('input', () => {
      this.refreshEfforts(view);
      this.renderFinalizer();
    });
    effort.addEventListener('change', () => this.renderFinalizer());
    remove.addEventListener('click', () => this.renderRows(removeRow(this.currentRows(), row.id), this.checkedIds()));
    return view;
  }

  private renderRows(rows: readonly FormRow[], checked: readonly string[]): void {
    this.rows = rows.map((row) => this.buildRow(row, checked.includes(row.id)));
    for (const view of this.rows) this.refreshEfforts(view);
    const adders = CLI_KINDS.map((kind) => {
      const button = el('button', 'room-button room-add', `Add ${AGENT_LABELS[kind]}`);
      button.type = 'button';
      button.dataset['room'] = `add-${kind}`;
      button.addEventListener('click', () => this.renderRows(addRow(this.currentRows(), kind), this.checkedIds()));
      return button;
    });
    this.people.replaceChildren(...this.rows.map((view) => view.root), ...this.sites, ...adders);
    this.renderFinalizer();
    this.renderState();
  }

  private renderFinalizer(): void {
    const checked = this.checkedIds();
    const rows = this.currentRows();
    const chosen = resolveFinalizer(checked, this.finalizer.value, rows);
    this.finalizer.replaceChildren();
    for (const participant of finalizerChoices(checked, rows)) {
      const option = el('option', undefined, participant.label);
      option.value = participant.id;
      this.finalizer.append(option);
    }
    this.finalizer.value = chosen;
  }

  private async onStart(): Promise<void> {
    this.message.textContent = '';
    const result = formToConfig({
      prompt: this.prompt.value,
      mode: this.mode.value as RoomMode,
      rounds: this.rounds.value,
      timeoutMinutes: this.timeout.value,
      checked: this.checkedIds(),
      rows: this.currentRows(),
      finalizerId: this.finalizer.value,
      debugSites: this.debugSites.checked,
    });
    if (!result.ok) {
      this.message.textContent = result.error;
      return;
    }
    this.debugDir = null;
    const started = await api.roomStart(result.config, this.openedId ?? undefined);
    if (!started.ok) this.message.textContent = started.error;
    else this.debugDir = started.debugDir;
    this.renderState();
  }

  private async onCarry(what: CarryWhat): Promise<void> {
    this.message.textContent = '';
    const id = this.target.value;
    const pasted = id.length > 0 && (await api.roomCarry(id, what));
    this.message.textContent = pasted ? 'Pasted into the session, not submitted.' : 'Nothing was pasted: pick a running CLI session once the run has finished.';
  }

  private renderFeed(): void {
    this.feed.render(this.snapshot);
  }

  private async onCopyFinal(): Promise<void> {
    const copied = await api.roomCopyFinal();
    this.message.textContent = copied ? 'Final result copied.' : 'There is no final result to copy.';
  }

  private renderPause(): void {
    const { paused } = this.snapshot;
    this.pause.hidden = paused.length === 0;
    this.pauseNotes.replaceChildren(...paused.map((item) => el('div', 'room-pause-note', item.note)));
    for (const [id, pane] of this.sessions) {
      if (paused.some((item) => item.sessionId === id)) continue;
      this.observer.unobserve(pane.element);
      pane.dispose();
      this.sessions.delete(id);
    }
    for (const item of paused) {
      if (this.sessions.has(item.sessionId)) continue;
      const pane = new TerminalPane(roomSessionIo(item.sessionId));
      this.sessions.set(item.sessionId, pane);
      this.terminals.append(pane.element);
      this.observer.observe(pane.element);
      pane.show();
    }
  }

  private renderProgress(): void {
    const view = roomProgress(this.snapshot);
    this.progress.hidden = view === null;
    if (view === null) return;
    this.headline.textContent = view.headline;
    this.remaining.textContent = view.remainingText;
    this.banner.hidden = view.banner === null;
    this.banner.dataset['tone'] = view.banner?.tone ?? '';
    this.banner.textContent = view.banner?.text ?? '';
    this.chips.replaceChildren(
      ...view.chips.map((chip) => {
        const node = el('span', `room-chip state-${chip.state}`, `${chip.label}: ${chip.state === 'timeout' ? 'timed out' : chip.state}`);
        node.dataset['participant'] = chip.id;
        node.dataset['state'] = chip.state;
        return node;
      }),
    );
  }

  private renderState(): void {
    this.renderPause();
    this.renderProgress();
    const { phase, completed, total, running, historyPath, paused } = this.snapshot;
    const busy = phase === 'running';
    this.start.disabled = busy;
    this.start.textContent = this.openedId === null ? 'Start' : 'Continue';
    this.rooms.disabled = busy;
    this.newRoom.disabled = busy;
    this.stop.disabled = !busy;
    this.prompt.disabled = busy;
    this.mode.disabled = busy;
    this.timeout.disabled = busy;
    this.rounds.disabled = busy;
    this.finalizer.disabled = busy;
    this.debugSites.disabled = busy;
    for (const participant of ROOM_PARTICIPANTS) {
      const input = this.boxes.get(participant.id);
      if (input !== undefined) input.disabled = busy || !participantAvailability(participant).available;
    }
    for (const view of this.rows) for (const control of [view.box, view.model, view.effort, view.remove]) control.disabled = busy;
    for (const button of this.people.querySelectorAll<HTMLButtonElement>('.room-add')) button.disabled = busy;
    const canCarry = !busy && this.snapshot.roomId !== null && this.target.value.length > 0;
    this.carryFinal.disabled = !canCarry;
    this.carryHistory.disabled = !canCarry;
    const labels = new Map(this.snapshot.plan?.participants.map((item) => [item.id, item.label]) ?? []);
    const names = running.map((id) => labels.get(id) ?? id);
    const where = (historyPath === null ? '' : ` History: ${historyPath}`) + (this.debugDir === null ? '' : ` Debug: ${this.debugDir}`);
    this.status.textContent =
      phase === 'idle' ? 'Idle.' : `${busy ? (paused.length > 0 ? 'Waiting for you' : `Running ${names.join(', ')}`) : phase} (${completed}/${total}).${where}`;
  }
}
