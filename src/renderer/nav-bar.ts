// nav-bar.ts
import type { SiteAction, SiteStateEvent } from '../shared/ipc';
import { api } from './api';
import { el } from './dom';

const BUTTONS: readonly { action: SiteAction; label: string; title: string }[] = [
  { action: 'back', label: '‹', title: 'Back' },
  { action: 'forward', label: '›', title: 'Forward' },
  { action: 'home', label: '⌂', title: 'Home' },
  { action: 'reload', label: '↻', title: 'Reload' },
];

export class NavBar {
  readonly element = el('div', 'nav-bar');
  private readonly buttons = new Map<SiteAction, HTMLButtonElement>();
  private readonly address = el('span', 'nav-address');
  private agentId: string | null = null;

  constructor() {
    this.element.hidden = true;
    for (const spec of BUTTONS) {
      const button = el('button', 'nav-button', spec.label);
      button.type = 'button';
      button.title = spec.title;
      button.dataset['action'] = spec.action;
      button.addEventListener('click', () => {
        if (this.agentId !== null) void api.siteNav(this.agentId, spec.action);
      });
      this.buttons.set(spec.action, button);
      this.element.append(button);
    }
    this.element.append(this.address);
  }

  setAgent(id: string | null): void {
    if (id !== this.agentId) this.address.textContent = '';
    this.agentId = id;
    this.element.hidden = id === null;
  }

  update(event: SiteStateEvent): void {
    if (event.id !== this.agentId) return;
    this.address.textContent = event.url;
    this.buttons.get('back')?.toggleAttribute('disabled', !event.canGoBack);
    this.buttons.get('forward')?.toggleAttribute('disabled', !event.canGoForward);
  }
}
