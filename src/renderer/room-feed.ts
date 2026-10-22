// room-feed.ts
import type { RoomEntry } from '../shared/room-model';
import { entryState, feedSections, type FeedSection, type RoomSnapshot } from '../shared/room-view';
import { el } from './dom';

function copyButton(onCopy: () => void): HTMLButtonElement {
  const button = el('button', 'room-button room-copy', 'Copy');
  button.type = 'button';
  button.dataset['room'] = 'copy-final';
  button.addEventListener('click', onCopy);
  return button;
}

function entryNode(entry: RoomEntry, onCopy: () => void): HTMLDetailsElement {
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
  if (entry.kind === 'final') node.append(summary, copyButton(onCopy), text, copyButton(onCopy));
  else node.append(summary, text);
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
  private shown = 0;

  constructor(private readonly onCopy: () => void) {
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
    feedSections(entries, snapshot.plan).forEach((section, position) => {
      let node = this.sections.get(section.key);
      if (node === undefined) {
        node = sectionNode(section);
        this.sections.set(section.key, node);
        this.element.insertBefore(node, this.element.children[position] ?? null);
      }
      for (const item of section.entries) {
        if (item.index >= this.shown) node.append(entryNode(item.entry, this.onCopy));
      }
    });
    this.shown = entries.length;
    this.element.scrollTop = this.element.scrollHeight;
  }

  reset(): void {
    this.element.replaceChildren();
    this.sections.clear();
    this.shown = 0;
  }

  reload(snapshot: RoomSnapshot): void {
    this.reset();
    this.render(snapshot);
  }
}
