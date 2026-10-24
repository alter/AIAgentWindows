// room-recipients.ts
import { recipientsLine, type RecipientRow } from '../shared/context-sent';
import { el } from './dom';

export class RoomRecipients {
  readonly element = el('div', 'room-recipients');

  constructor() {
    this.element.dataset['room'] = 'recipients';
    this.element.hidden = true;
  }

  update(rows: readonly RecipientRow[], projectId: string | null): void {
    const line = recipientsLine(rows, projectId);
    this.element.hidden = line === null;
    this.element.textContent = line ?? '';
  }
}
