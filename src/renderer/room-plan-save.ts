// room-plan-save.ts
import { api } from './api';
import { el } from './dom';

type Tone = 'done' | 'failed';

export class PlanSaver {
  readonly element = el('div', 'room-plan');
  private readonly note = el('div', 'room-plan-note');
  private readonly confirm = el('div', 'room-plan-confirm');
  private readonly question = el('span', 'room-plan-question');
  private readonly replace = el('button', 'room-button', 'Replace');
  private readonly cancel = el('button', 'room-button', 'Cancel');
  private roomId: string | null = null;

  constructor() {
    this.element.dataset['room'] = 'plan';
    this.note.dataset['room'] = 'plan-note';
    this.confirm.dataset['room'] = 'plan-confirm';
    this.replace.type = 'button';
    this.replace.dataset['room'] = 'plan-replace';
    this.cancel.type = 'button';
    this.cancel.dataset['room'] = 'plan-cancel';
    this.confirm.append(this.question, this.replace, this.cancel);
    this.element.append(this.note, this.confirm);
    this.replace.addEventListener('click', () => void this.run(true));
    this.cancel.addEventListener('click', () => this.clear());
    this.clear();
  }

  clear(): void {
    this.roomId = null;
    this.confirm.hidden = true;
    this.say('', 'done');
  }

  async save(roomId: string | null): Promise<void> {
    this.clear();
    if (roomId === null) return this.say('There is no room to save.', 'failed');
    this.roomId = roomId;
    await this.run(false);
  }

  private async run(replace: boolean): Promise<void> {
    const id = this.roomId;
    if (id === null) return;
    this.confirm.hidden = true;
    const result = await api.roomSavePlan(id, replace);
    if (result.ok) {
      this.roomId = null;
      return this.say(`Saved to ${result.file}`, 'done');
    }
    if ('exists' in result) {
      this.say('', 'done');
      this.question.textContent = `${result.file} already exists. Replace it? The old file goes to the Trash.`;
      this.confirm.hidden = false;
      return;
    }
    this.roomId = null;
    this.say(result.error, 'failed');
  }

  private say(text: string, tone: Tone): void {
    this.note.textContent = text;
    this.note.dataset['tone'] = tone;
  }
}
