// icons.ts
import type { AgentKind } from '../shared/agents';

export const ICON_DIR = 'assets/icons';

export const AGENT_ICON_FILES: Readonly<Record<AgentKind, string>> = {
  claude: 'claudecode-color.svg',
  codex: 'codex-color.svg',
  chatgpt: 'openai.svg',
  grok: 'grok.svg',
  deepseek: 'deepseek-color.svg',
  openrouter: 'openrouter.svg',
};

export const MONO_ICON_FILES: readonly string[] = ['openai.svg', 'grok.svg', 'openrouter.svg'];

export function kindIcon(kind: AgentKind): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'kind-icon';
  tile.dataset['kind'] = kind;
  tile.setAttribute('aria-hidden', 'true');
  const file = AGENT_ICON_FILES[kind];
  const image = document.createElement('img');
  image.className = MONO_ICON_FILES.includes(file) ? 'kind-logo kind-logo-mono' : 'kind-logo';
  image.alt = '';
  image.draggable = false;
  image.src = `${ICON_DIR}/${file}`;
  tile.append(image);
  return tile;
}
