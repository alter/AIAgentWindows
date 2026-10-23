// theme-switch.ts
import { THEME_CHOICES, type ThemeChoice } from '../shared/theme';
import { el } from './dom';

const LABELS: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export class ThemeSwitch {
  readonly element = el('div', 'theme-switch');
  private readonly inputs = new Map<ThemeChoice, HTMLInputElement>();

  constructor(onChange: (choice: ThemeChoice) => void) {
    const label = el('span', 'theme-switch-label', 'Theme');
    label.id = 'theme-switch-label';
    const group = el('div', 'theme-switch-options');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', label.id);
    for (const choice of THEME_CHOICES) {
      const option = el('label', 'theme-switch-option');
      const input = el('input');
      input.type = 'radio';
      input.name = 'theme-choice';
      input.value = choice;
      input.addEventListener('change', () => {
        if (input.checked) onChange(choice);
      });
      this.inputs.set(choice, input);
      option.append(input, el('span', undefined, LABELS[choice]));
      group.append(option);
    }
    this.element.append(label, group);
  }

  setChoice(choice: ThemeChoice): void {
    for (const [value, input] of this.inputs) input.checked = value === choice;
  }
}
