// content.ts
import { isCliKind } from '../shared/agents';
import type { AgentsSnapshot, PtyDataEvent, SiteStateEvent } from '../shared/ipc';
import { el } from './dom';
import { NavBar } from './nav-bar';
import { TerminalPane } from './terminal-pane';

export class Content {
  readonly element = el('main', 'content');
  private readonly panes = new Map<string, TerminalPane>();
  private readonly navBar = new NavBar();
  private readonly sitePlaceholder = el('div', 'site-area');
  private readonly empty = el('div', 'content-empty', 'Select an agent or add one with +.');
  private readonly observer: ResizeObserver;
  private selectedId: string | null = null;

  constructor() {
    this.element.append(this.empty, this.navBar.element, this.sitePlaceholder);
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
      const pane = new TerminalPane(id);
      this.panes.set(id, pane);
      this.element.append(pane.element);
      this.observer.observe(pane.element);
    }
    this.selectedId = snapshot.selectedId;
    const selected = snapshot.agents.find((agent) => agent.id === snapshot.selectedId);
    this.empty.hidden = selected !== undefined;
    const site = selected !== undefined && !isCliKind(selected.kind);
    this.sitePlaceholder.hidden = !site;
    this.navBar.setAgent(site ? selected.id : null);
    for (const [id, pane] of this.panes) if (id !== snapshot.selectedId) pane.hide();
    this.panes.get(snapshot.selectedId ?? '')?.show();
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
