// room-pane.ts
import { isCliKind, type Agent } from '../shared/agents';
import type { PtyDataEvent } from '../shared/ipc';
import { MAX_ROUNDS, MIN_ROUNDS, ROOM_PARTICIPANTS, type RoomEntry, type RoomEvent, type RoomMode } from '../shared/room-model';
import { applyRoomEvent, emptyRoomSnapshot, formToConfig, participantAvailability, type CarryWhat, type RoomSnapshot } from '../shared/room-view';
import { api } from './api';
import { el } from './dom';
import { TerminalPane, roomSessionIo } from './terminal-pane';

const DEFAULT_TIMEOUT_MINUTES = '10';

function entryNode(entry: RoomEntry): HTMLElement {
  const node = el('div', `room-entry kind-${entry.kind}`);
  node.dataset['author'] = entry.authorId;
  node.dataset['kind'] = entry.kind;
  const head = el('div', 'room-entry-head');
  head.append(el('span', 'room-entry-author', entry.label), el('span', 'room-entry-kind', entry.kind), el('span', 'room-entry-time', new Date(entry.time).toLocaleTimeString()));
  node.append(head, el('pre', 'room-entry-text', entry.text));
  return node;
}

function labeled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = el('label');
  label.append(control, el('span', undefined, text));
  return label;
}

export class RoomPane {
  readonly element = el('section', 'room-pane');
  private readonly feed = el('div', 'room-feed');
  private readonly prompt = el('textarea', 'room-prompt');
  private readonly boxes = new Map<string, HTMLInputElement>();
  private readonly mode = el('select');
  private readonly rounds = el('input');
  private readonly timeout = el('input');
  private readonly start = el('button', 'room-button', 'Start');
  private readonly stop = el('button', 'room-button stop', 'Stop');
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
  private shown = 0;

  constructor() {
    this.element.hidden = true;
    this.element.dataset['room'] = 'pane';
    this.feed.setAttribute('role', 'log');
    this.feed.dataset['room'] = 'feed';
    this.prompt.placeholder = 'Prompt for the room';
    this.prompt.dataset['room'] = 'prompt';
    this.status.dataset['room'] = 'status';
    this.message.dataset['room'] = 'message';
    this.pause.hidden = true;
    this.pause.dataset['room'] = 'pause';
    this.pauseNotes.dataset['room'] = 'pause-note';
    this.terminals.dataset['room'] = 'terminals';
    this.resume.type = 'button';
    this.resume.dataset['room'] = 'resume';
    this.resume.addEventListener('click', () => void api.roomResume());
    this.pause.append(this.pauseNotes, this.terminals, this.resume);
    this.element.append(el('h2', 'room-title', 'Room'), this.feed, this.pause, this.controls());
    this.renderFeed();
    this.renderState();
  }

  show(): void {
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  load(snapshot: RoomSnapshot): void {
    this.snapshot = snapshot;
    this.renderFeed();
    this.renderState();
  }

  apply(event: RoomEvent): void {
    this.snapshot = applyRoomEvent(this.snapshot, event);
    this.renderFeed();
    this.renderState();
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

  private controls(): HTMLElement {
    const box = el('div', 'room-controls');
    const people = el('div', 'room-row');
    for (const participant of ROOM_PARTICIPANTS) {
      const input = el('input');
      input.type = 'checkbox';
      input.dataset['participant'] = participant.id;
      this.boxes.set(participant.id, input);
      const availability = participantAvailability(participant);
      input.disabled = !availability.available;
      const item = labeled(participant.label, input);
      if (!availability.available) {
        item.title = availability.note;
        item.classList.add('unavailable');
        item.append(el('span', 'room-unavailable', 'needs `npm run capture-sites`'));
      }
      people.append(item);
    }
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
    this.start.type = 'button';
    this.start.dataset['room'] = 'start';
    this.stop.type = 'button';
    this.stop.dataset['room'] = 'stop';
    const settings = el('div', 'room-row');
    settings.append(labeled('Mode', this.mode), labeled('Rounds', this.rounds), labeled('Turn timeout, minutes', this.timeout), this.start, this.stop);
    const carry = el('div', 'room-row');
    this.target.dataset['room'] = 'carry-target';
    this.carryFinal.type = 'button';
    this.carryFinal.dataset['room'] = 'carry-final';
    this.carryHistory.type = 'button';
    this.carryHistory.dataset['room'] = 'carry-history';
    carry.append(labeled('Working session', this.target), this.carryFinal, this.carryHistory);
    box.append(this.prompt, people, settings, this.status, this.message, carry);
    this.start.addEventListener('click', () => void this.onStart());
    this.stop.addEventListener('click', () => void api.roomStop());
    this.mode.addEventListener('change', () => this.renderState());
    this.carryFinal.addEventListener('click', () => void this.onCarry('final'));
    this.carryHistory.addEventListener('click', () => void this.onCarry('history'));
    return box;
  }

  private async onStart(): Promise<void> {
    this.message.textContent = '';
    const result = formToConfig({
      prompt: this.prompt.value,
      mode: this.mode.value as RoomMode,
      rounds: this.rounds.value,
      timeoutMinutes: this.timeout.value,
      checked: [...this.boxes].filter(([, input]) => input.checked).map(([id]) => id),
    });
    if (!result.ok) {
      this.message.textContent = result.error;
      return;
    }
    const started = await api.roomStart(result.config);
    if (!started.ok) this.message.textContent = started.error;
  }

  private async onCarry(what: CarryWhat): Promise<void> {
    this.message.textContent = '';
    const id = this.target.value;
    const pasted = id.length > 0 && (await api.roomCarry(id, what));
    this.message.textContent = pasted ? 'Pasted into the session, not submitted.' : 'Nothing was pasted: pick a running CLI session once the run has finished.';
  }

  private renderFeed(): void {
    const { entries } = this.snapshot;
    if (entries.length < this.shown) {
      this.feed.replaceChildren();
      this.shown = 0;
    }
    if (entries.length === 0) {
      if (this.feed.childElementCount === 0) this.feed.append(el('div', 'room-feed-empty', 'No messages yet.'));
      return;
    }
    if (this.shown === 0) this.feed.replaceChildren();
    for (const entry of entries.slice(this.shown)) this.feed.append(entryNode(entry));
    this.shown = entries.length;
    this.feed.scrollTop = this.feed.scrollHeight;
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

  private renderState(): void {
    this.renderPause();
    const { phase, completed, total, running, historyPath, paused } = this.snapshot;
    const busy = phase === 'running';
    this.start.disabled = busy;
    this.stop.disabled = !busy;
    this.prompt.disabled = busy;
    this.mode.disabled = busy;
    this.timeout.disabled = busy;
    this.rounds.disabled = busy;
    for (const participant of ROOM_PARTICIPANTS) {
      const input = this.boxes.get(participant.id);
      if (input !== undefined) input.disabled = busy || !participantAvailability(participant).available;
    }
    const canCarry = !busy && this.snapshot.roomId !== null && this.target.value.length > 0;
    this.carryFinal.disabled = !canCarry;
    this.carryHistory.disabled = !canCarry;
    const names = ROOM_PARTICIPANTS.filter((item) => running.includes(item.id)).map((item) => item.label);
    const where = historyPath === null ? '' : ` History: ${historyPath}`;
    this.status.textContent =
      phase === 'idle' ? 'Idle.' : `${busy ? (paused.length > 0 ? 'Waiting for you' : `Running ${names.join(', ')}`) : phase} (${completed}/${total}).${where}`;
  }
}
