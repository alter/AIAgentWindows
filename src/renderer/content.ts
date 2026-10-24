// content.ts
import { OPENROUTER_KIND, isCliKind, isSiteKind } from '../shared/agents';
import type { AgentsSnapshot, PtyDataEvent, SiteStateEvent } from '../shared/ipc';
import type { RoomEvent } from '../shared/room-model';
import type { RoomSnapshot } from '../shared/room-view';
import { el } from './dom';
import { NavBar } from './nav-bar';
import { OpenRouterPane } from './openrouter-pane';
import { RoomPane } from './room-pane';
import type { RoomTreeState } from './room-tree';
import { TerminalPane, agentIo } from './terminal-pane';

export class Content {
  readonly element = el('main', 'content');
  private readonly panes = new Map<string, TerminalPane>();
  private readonly chats = new Map<string, OpenRouterPane>();
  private readonly navBar = new NavBar();
  private readonly room = new RoomPane();
  private readonly sitePlaceholder = el('div', 'site-area');
  private readonly empty = el('div', 'content-empty', 'Select an agent or add one with +.');
  private readonly observer: ResizeObserver;
  private selectedId: string | null = null;

  constructor() {
    this.element.append(this.empty, this.navBar.element, this.sitePlaceholder, this.room.element);
    this.sitePlaceholder.hidden = true;
    this.observer = new ResizeObserver(() => this.panes.get(this.selectedId ?? '')?.refit());
    this.observer.observe(this.element);
  }

  render(snapshot: AgentsSnapshot): void {
    const wanted = new Set(snapshot.agents.filter((agent) => isCliKind(agent.kind)).map((agent) => agent.id));
    for (const [id, pane] of this.panes) {
      if (wanted.has(id)) continue;
      this.observer.unobserve(pane.element);
      pane.dispose();
      this.panes.delete(id);
    }
    for (const id of wanted) {
      if (this.panes.has(id)) continue;
      const pane = new TerminalPane(agentIo(id));
      this.panes.set(id, pane);
      this.element.append(pane.element);
      this.observer.observe(pane.element);
    }
    this.renderChats(snapshot);
    this.selectedId = snapshot.roomOpen ? null : snapshot.selectedId;
    this.room.setAgents(snapshot.agents);
    if (snapshot.roomOpen) this.room.show();
    else this.room.hide();
    const selected = snapshot.roomOpen ? undefined : snapshot.agents.find((agent) => agent.id === snapshot.selectedId);
    this.empty.hidden = selected !== undefined || snapshot.roomOpen;
    const site = selected !== undefined && isSiteKind(selected.kind);
    this.sitePlaceholder.hidden = !site;
    this.navBar.setAgent(site ? selected.id : null);
    for (const [id, pane] of this.panes) if (id !== this.selectedId) pane.hide();
    this.panes.get(this.selectedId ?? '')?.show();
    for (const [id, chat] of this.chats) {
      if (id === this.selectedId) chat.show();
      else chat.hide();
    }
  }

  private renderChats(snapshot: AgentsSnapshot): void {
    const wanted = snapshot.agents.filter((agent) => agent.kind === OPENROUTER_KIND);
    for (const [id, chat] of this.chats) {
      if (wanted.some((agent) => agent.id === id)) continue;
      chat.dispose();
      this.chats.delete(id);
    }
    for (const agent of wanted) {
      if (this.chats.has(agent.id)) continue;
      const chat = new OpenRouterPane(agent);
      this.chats.set(agent.id, chat);
      this.element.append(chat.element);
    }
  }

  watchRooms(listener: (state: RoomTreeState) => void): void {
    this.room.watchRooms(listener);
  }

  roomOpen(id: string): void {
    void this.room.openFromTree(id);
  }

  roomNew(projectId: string | null): void {
    void this.room.newFromTree(projectId);
  }

  roomRename(id: string, title: string): void {
    void this.room.renameFromTree(id, title);
  }

  roomDelete(id: string): void {
    void this.room.deleteFromTree(id);
  }

  roomLoad(snapshot: RoomSnapshot): void {
    this.room.load(snapshot);
  }

  roomEvent(event: RoomEvent): void {
    this.room.apply(event);
  }

  roomTerminalData(event: PtyDataEvent): void {
    this.room.terminalData(event);
  }

  ptyData(event: PtyDataEvent): void {
    this.panes.get(event.id)?.push(event);
  }

  siteState(event: SiteStateEvent): void {
    this.navBar.update(event);
  }

  ptyExit(id: string, exitCode: number): void {
    this.panes.get(id)?.exited(exitCode);
  }
}
