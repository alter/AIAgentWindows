// room-feed.ts
import type { RoomEntry } from '../shared/room-model';
import { COPY_REST_MS, entryState, feedSections, type FeedSection, type RoomSnapshot } from '../shared/room-view';
import { el } from './dom';
import { contextSentNode } from './room-context-sent';

function entryNode(entry: RoomEntry, copyButton: () => HTMLButtonElement, saveButton: (() => HTMLButtonElement) | null): HTMLDetailsElement {
  const node = el('details', `room-entry kind-${entry.kind}`);
  node.dataset['author'] = entry.authorId;
  node.dataset['kind'] = entry.kind;
  node.open = entry.kind === 'final';
  const state = entryState(entry);
  const summary = el('summary', 'room-entry-head');
  const stateNode = el('span', 'room-entry-kind', state);
  stateNode.dataset['state'] = state;
  summary.append(
    el('span', 'room-entry-author', entry.label),
    stateNode,
    el('span', 'room-entry-length', `${entry.text.length} chars`),
    el('span', 'room-entry-time', new Date(entry.time).toLocaleTimeString()),
  );
  const text = el('pre', 'room-entry-text', entry.text);
  const context = entry.digest === undefined ? [] : [contextSentNode(entry.digest)];
  if (entry.kind === 'final') node.append(summary, copyButton(), ...(saveButton === null ? [] : [saveButton()]), text, ...context, copyButton());
  else node.append(summary, text, ...context);
  return node;
}

function sectionNode(section: FeedSection): HTMLElement {
  const node = el('section', 'room-section');
  node.dataset['section'] = section.key;
  if (section.title !== null) node.append(el('h3', 'room-section-title', section.title));
  return node;
}

export class RoomFeed {
  readonly element = el('div', 'room-feed');
  private readonly sections = new Map<string, HTMLElement>();
  private readonly copyButtons = new Set<HTMLButtonElement>();
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private shown = 0;

  constructor(private readonly onCopy: () => Promise<boolean>, private readonly onSavePlan: () => void) {
    this.element.setAttribute('role', 'log');
    this.element.dataset['room'] = 'feed';
  }

  render(snapshot: RoomSnapshot): void {
    const { entries } = snapshot;
    if (entries.length < this.shown) this.reset();
    if (entries.length === 0) {
      if (this.element.childElementCount === 0) this.element.append(el('div', 'room-feed-empty', 'No messages yet.'));
      return;
    }
    if (this.shown === 0) this.element.replaceChildren();
    const savable = snapshot.projectId !== null && snapshot.roomId !== null;
    feedSections(entries, snapshot.plan).forEach((section, position) => {
      let node = this.sections.get(section.key);
      if (node === undefined) {
        node = sectionNode(section);
        this.sections.set(section.key, node);
        this.element.insertBefore(node, this.element.children[position] ?? null);
      }
      for (const item of section.entries) {
        if (item.index >= this.shown) node.append(entryNode(item.entry, () => this.copyButton(), savable ? () => this.saveButton() : null));
      }
    });
    this.shown = entries.length;
    this.element.scrollTop = this.element.scrollHeight;
  }

  reset(): void {
    this.stopRest();
    this.copyButtons.clear();
    this.element.replaceChildren();
    this.sections.clear();
    this.shown = 0;
  }

  reload(snapshot: RoomSnapshot): void {
    this.reset();
    this.render(snapshot);
  }

  private copyButton(): HTMLButtonElement {
    const button = el('button', 'room-button room-copy', 'Copy');
    button.type = 'button';
    button.dataset['room'] = 'copy-final';
    button.addEventListener('click', () => void this.copy(button));
    this.copyButtons.add(button);
    return button;
  }

  private saveButton(): HTMLButtonElement {
    const button = el('button', 'room-button room-copy', 'Save plan');
    button.type = 'button';
    button.dataset['room'] = 'save-plan';
    button.addEventListener('click', () => this.onSavePlan());
    return button;
  }

  private async copy(button: HTMLButtonElement): Promise<void> {
    if (button.getAttribute('aria-disabled') === 'true') return;
    if (await this.onCopy()) this.rest();
  }

  private rest(): void {
    this.stopRest();
    for (const button of this.copyButtons) this.setCopied(button, true);
    this.restTimer = setTimeout(() => {
      this.restTimer = null;
      for (const button of this.copyButtons) this.setCopied(button, false);
    }, COPY_REST_MS);
  }

  private stopRest(): void {
    if (this.restTimer === null) return;
    clearTimeout(this.restTimer);
    this.restTimer = null;
  }

  private setCopied(button: HTMLButtonElement, copied: boolean): void {
    button.textContent = copied ? 'Copied' : 'Copy';
    if (copied) {
      button.setAttribute('aria-disabled', 'true');
      button.dataset['copied'] = '';
    } else {
      button.removeAttribute('aria-disabled');
      delete button.dataset['copied'];
    }
  }
}
