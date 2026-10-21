// icons.ts
import type { AgentKind } from '../shared/agents';

const TERMINAL_GLYPH = '<path d="M5 7l5 5-5 5M12 17h7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const GLOBE_GLYPH =
  '<g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/></g>';

const GLYPHS: Readonly<Record<AgentKind, string>> = {
  claude: TERMINAL_GLYPH,
  codex: TERMINAL_GLYPH,
  chatgpt: GLOBE_GLYPH,
  grok: GLOBE_GLYPH,
  deepseek: GLOBE_GLYPH,
};

export function kindIcon(kind: AgentKind): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `kind-icon kind-${kind}`;
  badge.setAttribute('aria-hidden', 'true');
  badge.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18">${GLYPHS[kind]}</svg>`;
  return badge;
}
