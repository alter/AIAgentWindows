// room-pane.ts
import { isCliKind, type Agent } from '../shared/agents';
import { emptyRoomModels } from '../shared/cli-models';
import type { PtyDataEvent } from '../shared/ipc';
import { MAX_ROUNDS, MIN_ROUNDS, type RoomEvent, type RoomListItem, type RoomMode } from '../shared/room-model';
import {
  applyRoomEvent,
  defaultRows,
  emptyRoomSnapshot,
  formToConfig,
  nextRoomAfterDelete,
  projectSiteKinds,
  roomProgress,
  roomTreeRows,
  setupDigest,
  setupOpenAfterStart,
  setupOpenOnRoom,
  startAction,
  startLabel,
  type CarryWhat,
  type RoomFormValues,
  type RoomSnapshot,
} from '../shared/room-view';
import { api } from './api';
import { el } from './dom';
import { RoomFeed } from './room-feed';
import { RoomTable } from './room-table';
import type { RoomTreeState } from './room-tree';
import { TerminalPane, roomSessionIo } from './terminal-pane';

const DEFAULT_TIMEOUT_MINUTES = '10';
const ROOM_HEADING = 'Room';

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
  private readonly feed = new RoomFeed(() => this.onCopyFinal());
  private readonly prompt = el('textarea', 'room-prompt');
  private readonly table = new RoomTable();
  private readonly setup = el('details', 'room-setup');
  private readonly digest = el('span', 'room-setup-digest');
  private readonly mode = el('select');
  private readonly rounds = el('input');
  private readonly timeout = el('input');
  private readonly debugSites = el('input');
  private readonly heading = el('h2', 'room-title', ROOM_HEADING);
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
  private snapshot: RoomSnapshot = emptyRoomSnapshot();
  private agents: readonly Agent[] = [];
  private debugDir: string | null = null;
  private openedId: string | null = null;
  private listed: readonly RoomListItem[] = [];
  private roomsListener: ((state: RoomTreeState) => void) | null = null;

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
    this.heading.dataset['room'] = 'title';
    this.element.append(this.heading, this.progress, this.feed.element, this.pause, this.controls());
    this.renderFeed();
    this.renderState();
    void this.loadModels();
    void this.refreshList();
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
    if (event.type === 'started') this.feed.reload(this.snapshot);
    else this.renderFeed();
    this.renderState();
    if (event.type === 'finished') void this.refreshList();
  }

  terminalData(event: PtyDataEvent): void {
    this.sessions.get(event.id)?.push(event);
  }

  setAgents(agents: readonly Agent[]): void {
    this.agents = agents;
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

  watchRooms(listener: (state: RoomTreeState) => void): void {
    this.roomsListener = listener;
    this.publishRooms();
  }

  async openFromTree(id: string): Promise<void> {
    await api.roomSelect();
    await this.openRoom(id);
  }

  async newFromTree(projectId: string | null): Promise<void> {
    await api.roomSelect();
    await this.onNewRoom(projectId);
  }

  async renameFromTree(id: string, title: string): Promise<void> {
    const renamed = await api.roomRename(id, title).catch(() => false);
    if (!renamed) this.message.textContent = 'The room could not be renamed.';
    await this.refreshList();
  }

  async deleteFromTree(id: string): Promise<void> {
    const next = nextRoomAfterDelete(this.listed, id);
    const projectId = this.listed.find((item) => item.id === id)?.projectId ?? null;
    const wasOpen = this.openedId === id;
    const deleted = await api.roomDelete(id).catch(() => false);
    if (!deleted) {
      this.message.textContent = 'The room could not be deleted.';
      await this.refreshList();
      return;
    }
    if (wasOpen) this.openedId = null;
    await this.refreshList();
    if (!wasOpen) return;
    if (next === null) await this.onNewRoom(projectId);
    else await this.openRoom(next);
  }

  private async refreshList(): Promise<void> {
    this.listed = await api.roomList().catch(() => []);
    this.publishRooms();
  }

  private publishRooms(): void {
    const opened = this.listed.find((item) => item.id === this.openedId);
    this.heading.textContent = opened !== undefined && !opened.unreadable ? opened.title : ROOM_HEADING;
    this.roomsListener?.({ rows: roomTreeRows(this.listed, this.openedId), busy: this.snapshot.phase === 'running' });
  }

  private async openRoom(id: string): Promise<void> {
    this.message.textContent = '';
    const opened = await api.roomOpen(id);
    if (!opened.ok) {
      this.message.textContent = opened.error;
      this.publishRooms();
      return;
    }
    this.openedId = id;
    this.debugDir = null;
    this.snapshot = opened.snapshot;
    this.applyForm(opened.form);
    this.setup.open = setupOpenOnRoom(opened.snapshot.entries.length);
    this.feed.reload(opened.snapshot);
    this.renderState();
    this.publishRooms();
  }

  private async onNewRoom(projectId: string | null): Promise<void> {
    if (!(await api.roomNew(projectId))) {
      this.message.textContent = 'A run is in progress: stop it first.';
      return;
    }
    this.openedId = null;
    this.debugDir = null;
    this.message.textContent = '';
    this.prompt.value = '';
    this.snapshot = emptyRoomSnapshot(projectId);
    this.setup.open = setupOpenOnRoom(0);
    this.feed.reload(this.snapshot);
    this.renderState();
    this.publishRooms();
  }

  private applyForm(form: RoomFormValues): void {
    this.table.setRows(form.rows ?? defaultRows(), form.finalizerId ?? '');
    this.prompt.value = form.prompt;
    this.mode.value = form.mode;
    this.rounds.value = form.rounds;
    this.timeout.value = form.timeoutMinutes;
    this.debugSites.checked = form.debugSites ?? false;
    this.refreshDigest();
  }

  private refreshDigest(): void {
    this.digest.textContent = setupDigest(this.table.ids().length, this.mode.value as RoomMode, this.rounds.value);
  }

  private controls(): HTMLElement {
    const box = el('div', 'room-controls');
    this.table.setRows(defaultRows(), '');
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
    this.debugSites.type = 'checkbox';
    this.debugSites.dataset['room'] = 'debug-sites';
    this.start.type = 'button';
    this.start.dataset['room'] = 'start';
    this.stop.type = 'button';
    this.stop.dataset['room'] = 'stop';
    const settings = el('div', 'room-row');
    settings.append(field('Mode', this.mode), field('Rounds', this.rounds), field('Turn timeout (min)', this.timeout), labeled('Record site debug', this.debugSites));
    const summary = el('summary', 'room-setup-head');
    summary.append(el('span', 'room-setup-title', 'Participants and settings'), this.digest);
    this.setup.dataset['room'] = 'setup';
    this.setup.open = setupOpenOnRoom(0);
    this.setup.append(summary, this.table.element, settings);
    const actions = el('div', 'room-row');
    actions.append(this.start, this.stop);
    const carry = el('div', 'room-row');
    this.target.dataset['room'] = 'carry-target';
    this.carryFinal.type = 'button';
    this.carryFinal.dataset['room'] = 'carry-final';
    this.carryHistory.type = 'button';
    this.carryHistory.dataset['room'] = 'carry-history';
    carry.append(field('Working session', this.target), this.carryFinal, this.carryHistory);
    box.append(this.prompt, this.setup, actions, this.status, this.message, carry);
    this.start.addEventListener('click', () => void this.onStart());
    this.stop.addEventListener('click', () => void api.roomStop());
    this.mode.addEventListener('change', () => {
      this.refreshDigest();
      this.renderState();
    });
    this.rounds.addEventListener('input', () => {
      this.refreshDigest();
      this.renderStart();
    });
    this.prompt.addEventListener('input', () => this.renderStart());
    this.table.onChange(() => {
      this.refreshDigest();
      this.renderStart();
    });
    this.refreshDigest();
    this.carryFinal.addEventListener('click', () => void this.onCarry('final'));
    this.carryHistory.addEventListener('click', () => void this.onCarry('history'));
    return box;
  }

  private async loadModels(): Promise<void> {
    this.table.setModels(await api.roomModels().catch(() => emptyRoomModels()));
  }

  private formConfig(): ReturnType<typeof formToConfig> {
    return formToConfig({
      prompt: this.prompt.value,
      mode: this.mode.value as RoomMode,
      rounds: this.rounds.value,
      timeoutMinutes: this.timeout.value,
      checked: this.table.ids(),
      rows: this.table.rows(),
      finalizerId: this.table.finalizerId(),
      debugSites: this.debugSites.checked,
    });
  }

  private renderStart(): void {
    const action = startAction(this.openedId !== null, this.snapshot, this.formConfig());
    this.start.textContent = startLabel(action);
    this.start.dataset['roomAction'] = action;
  }

  private async onStart(): Promise<void> {
    this.message.textContent = '';
    const result = this.formConfig();
    if (!result.ok) {
      this.message.textContent = result.error;
      return;
    }
    this.debugDir = null;
    const started = await api.roomStart(result.config, this.openedId ?? undefined, startAction(this.openedId !== null, this.snapshot, result) === 'resume');
    this.setup.open = setupOpenAfterStart(this.setup.open, started.ok);
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

  private async onCopyFinal(): Promise<boolean> {
    const copied = await api.roomCopyFinal();
    this.message.textContent = copied ? '' : 'There is no final result to copy.';
    return copied;
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
    this.table.setSiteKinds(projectSiteKinds(this.agents, this.snapshot.projectId));
    this.renderPause();
    this.renderProgress();
    const { phase, completed, total, running, historyPath, paused } = this.snapshot;
    const busy = phase === 'running';
    this.publishRooms();
    this.start.disabled = busy;
    this.renderStart();
    this.stop.disabled = !busy;
    this.prompt.disabled = busy;
    this.mode.disabled = busy;
    this.timeout.disabled = busy;
    this.rounds.disabled = busy;
    this.debugSites.disabled = busy;
    this.table.setBusy(busy);
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
