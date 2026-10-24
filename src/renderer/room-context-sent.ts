// room-context-sent.ts
import type { ContextDigest } from '../shared/context-digest';
import { contextSentView } from '../shared/context-sent';
import { el } from './dom';

export function contextSentNode(digest: ContextDigest): HTMLDetailsElement {
  const view = contextSentView(digest);
  const node = el('details', 'room-context');
  node.dataset['room'] = 'context-sent';
  node.dataset['collection'] = view.collectionAllowed ? 'allowed' : 'denied';
  node.append(el('summary', 'room-context-title', view.title));
  const list = el('ul', 'room-context-lines');
  for (const line of view.lines) list.append(el('li', 'room-context-line', line));
  node.append(list);
  return node;
}
