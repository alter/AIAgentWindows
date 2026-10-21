// capture-sanitize.ts
export const CONTROL_LABELS: readonly string[] = [
  'send',
  'send message',
  'submit',
  'stop',
  'stop generating',
  'stop streaming',
  'stop response',
  'attach',
  'attach file',
  'attach files',
  'upload file',
  'upload files',
  'copy',
  'regenerate',
  'retry',
  'new chat',
  'message',
  'prompt',
];

export const TEXT_ATTRIBUTES: readonly string[] = [
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'aria-braillelabel',
  'placeholder',
  'alt',
  'title',
  'label',
];

export const ID_ATTRIBUTES: readonly string[] = [
  'id',
  'for',
  'name',
  'headers',
  'aria-labelledby',
  'aria-controls',
  'aria-describedby',
  'aria-owns',
  'aria-activedescendant',
];

export const ID_LISTS: readonly string[] = ['headers', 'aria-labelledby', 'aria-controls', 'aria-describedby', 'aria-owns'];

export const CLOSED_WORDS: readonly string[] = [
  ...['true', 'false', 'mixed', 'undefined', 'page', 'step', 'location', 'date', 'time', 'off', 'on', 'polite', 'assertive', 'auto', 'none', 'all', 'any', 'additions', 'removals', 'text'],
  ...['open', 'closed', 'checked', 'unchecked', 'active', 'inactive', 'selected', 'disabled', 'enabled', 'hidden', 'visible', 'loading', 'loaded', 'streaming', 'generating', 'idle', 'done', 'complete', 'completed', 'pending', 'error', 'ready', 'busy', 'focus', 'focused', 'hover', 'expanded', 'collapsed', 'starting', 'ended', 'running', 'stopped', 'success', 'failed'],
  ...['user', 'assistant', 'system', 'tool', 'model', 'bot', 'human', 'ai', 'agent', 'author', 'role'],
  ...['textbox', 'searchbox', 'combobox', 'listbox', 'option', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'dialog', 'alertdialog', 'alert', 'status', 'log', 'marquee', 'timer', 'tooltip', 'presentation', 'generic', 'list', 'listitem', 'article', 'main', 'navigation', 'region', 'group', 'img', 'image', 'search', 'tab', 'tablist', 'tabpanel', 'checkbox', 'radio', 'radiogroup', 'switch', 'slider', 'spinbutton', 'form', 'banner', 'complementary', 'contentinfo', 'heading', 'separator', 'toolbar', 'tree', 'treeitem', 'grid', 'gridcell', 'row', 'rowgroup', 'cell', 'columnheader', 'rowheader', 'table', 'progressbar', 'scrollbar', 'application', 'document', 'feed', 'figure', 'paragraph', 'link', 'button', 'note', 'math', 'meter', 'term', 'definition', 'directory', 'toggle'],
  ...['submit', 'reset', 'file', 'password', 'email', 'number', 'url', 'tel', 'range', 'color', 'week', 'month', 'plaintext', 'only', 'ltr', 'rtl', 'yes', 'no', 'stop', 'start', 'enter', 'send', 'go', 'done', 'next', 'previous', 'prev', 'numeric', 'decimal', 'vertical', 'horizontal', 'top', 'bottom', 'left', 'right', 'center', 'start', 'end', 'inline', 'block', 'sm', 'md', 'lg', 'xl', 'xs', 'small', 'medium', 'large', 'default', 'primary', 'secondary', 'tertiary', 'ghost', 'outline', 'solid', 'icon', 'light', 'dark', 'theme', 'plain', 'rich', 'new', 'old'],
  ...['message', 'messages', 'msg', 'prompt', 'input', 'output', 'composer', 'chat', 'conversation', 'thread', 'turn', 'response', 'reply', 'answer', 'question', 'content', 'markdown', 'prose', 'code', 'block', 'pre', 'body', 'header', 'footer', 'sidebar', 'nav', 'item', 'items', 'container', 'wrapper', 'panel', 'row', 'column', 'field', 'form', 'label', 'title', 'text', 'editor', 'textarea', 'attach', 'attachment', 'attachments', 'upload', 'copy', 'regenerate', 'retry', 'like', 'dislike', 'share', 'edit', 'delete', 'new', 'history', 'search', 'btn', 'frame', 'thinking', 'reasoning', 'tools', 'actions', 'action', 'footer', 'avatar', 'name', 'view', 'scroll', 'scroller', 'list', 'cursor', 'bubble', 'stream', 'result', 'results', 'sources', 'source', 'voice', 'model', 'picker', 'selector', 'mode', 'level', 'variant', 'kind', 'type', 'slot', 'component', 'orientation', 'side', 'scope', 'state', 'testid', 'test', 'id'],
];

export interface SanitizePolicy {
  controlLabels: readonly string[];
  textAttributes: readonly string[];
  idAttributes: readonly string[];
  idLists: readonly string[];
  words: readonly string[];
  sitePattern: string;
  maxNodes: number;
}

export const SANITIZE_POLICY: SanitizePolicy = {
  controlLabels: CONTROL_LABELS,
  textAttributes: TEXT_ATTRIBUTES,
  idAttributes: ID_ATTRIBUTES,
  idLists: ID_LISTS,
  words: CLOSED_WORDS,
  sitePattern: '^[a-z]{1,20}$',
  maxNodes: 60000,
};

export const ID_PLACEHOLDER = /^id-\d{1,6}$/;

export function isClosedValue(value: string, words: ReadonlySet<string>): boolean {
  if (!/^[A-Za-z0-9_:. -]{1,60}$/.test(value)) return false;
  const parts = value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part !== '');
  return parts.length > 0 && parts.every((part) => words.has(part) || /^\d{1,4}$/.test(part));
}

export function sanitizePage(source: Document, site: string, policy: SanitizePolicy): string {
  const TEXT = 'x';
  const MAX_NODES = policy.maxNodes;
  const MAX_DEPTH = 400;
  const skip = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'base', 'head']);
  const hollow = new Set(['svg', 'math', 'canvas', 'iframe', 'object', 'embed', 'video', 'audio']);
  const dropped = new Set(['style', 'srcdoc', 'nonce', 'integrity']);
  const enumerated = new Set(['role', 'type', 'contenteditable', 'draggable', 'spellcheck', 'tabindex', 'dir', 'translate', 'autocomplete', 'enterkeyhint', 'inputmode', 'rows', 'cols', 'maxlength', 'disabled', 'hidden', 'checked', 'selected', 'readonly', 'required', 'multiple']);
  const structuralData = /(testid|test-id|role|author|state|status|type|kind|variant|slot|component|orientation|side|scope|panel|turn|streaming|generating|loading|focus|disabled|active|selected|mode|level|^data-is-|^data-has-)/;
  const identifierData = /(^|-)ids?$/;
  const sitePattern = new RegExp(policy.sitePattern);
  const words = new Set(policy.words);
  const placeholders = new Map<string, string>();
  const namePattern = /^[a-z_][a-z0-9_.:-]{0,63}$/i;
  const labels = new Set(policy.controlLabels);
  const textAttributes = new Set(policy.textAttributes);
  const idAttributes = new Set(policy.idAttributes);
  const idLists = new Set(policy.idLists);
  const out = source.implementation.createHTMLDocument('');
  let nodes = 0;
  let truncated = false;

  const closed = (value: string): string => (isClosedValue(value, words) ? value : TEXT);

  const placeholder = (value: string): string => {
    if (value === '') return TEXT;
    let found = placeholders.get(value);
    if (found === undefined) {
      found = 'id-' + String(placeholders.size + 1);
      placeholders.set(value, found);
    }
    return found;
  };

  const attributeValue = (name: string, value: string): string | null => {
    if (name.startsWith('on') || dropped.has(name)) return null;
    if (name === 'class') {
      const kept = value.split(/\s+/).filter((part) => isClosedValue(part, words));
      return kept.length === 0 ? null : kept.join(' ');
    }
    if (textAttributes.has(name)) return labels.has(value.trim().toLowerCase()) ? value.trim() : TEXT;
    if (idAttributes.has(name)) {
      return idLists.has(name) ? value.trim().split(/\s+/).map(placeholder).join(' ') : placeholder(value.trim());
    }
    if (name.startsWith('data-')) {
      if (identifierData.test(name) && !/test-?id/.test(name)) return placeholder(value.trim());
      return structuralData.test(name) ? closed(value) : TEXT;
    }
    if (name.startsWith('aria-') || enumerated.has(name)) return closed(value);
    return TEXT;
  };

  const copy = (from: Element, depth: number): Element | null => {
    if (nodes >= MAX_NODES || depth > MAX_DEPTH) {
      truncated = true;
      return null;
    }
    if (skip.has(from.localName.toLowerCase()) && depth > 0) return null;
    let made: Element;
    try {
      made = out.createElementNS(from.namespaceURI, from.localName);
    } catch {
      return null;
    }
    nodes += 1;
    for (const attribute of Array.from(from.attributes)) {
      const name = attribute.name.toLowerCase();
      if (!namePattern.test(name)) continue;
      const value = attributeValue(name, attribute.value);
      if (value === null) continue;
      made.setAttribute(name, value);
    }
    if (hollow.has(from.localName.toLowerCase())) return made;
    for (const child of Array.from(from.childNodes)) {
      if (child.nodeType === 3) {
        if (/\S/.test(String(child.nodeValue))) made.appendChild(out.createTextNode(TEXT));
      } else if (child.nodeType === 1) {
        const kept = copy(child as Element, depth + 1);
        if (kept !== null) made.appendChild(kept);
      }
    }
    return made;
  };

  const root = out.documentElement;
  root.setAttribute('data-aiaw-site', sitePattern.test(site) ? site : TEXT);
  const body = source.body === null ? null : copy(source.body, 0);
  root.replaceChildren(body ?? out.createElement('body'));
  if (truncated) root.setAttribute('data-aiaw-truncated', 'true');
  return '<!doctype html>\n' + root.outerHTML + '\n';
}

export function sanitizeScript(site: string): string {
  return `(() => {
  try {
    const isClosedValue = ${isClosedValue.toString()};
    const html = (${sanitizePage.toString()})(document, ${JSON.stringify(site)}, ${JSON.stringify(SANITIZE_POLICY)});
    return JSON.stringify({ ok: true, html });
  } catch (error) {
    return JSON.stringify({ ok: false, error: 'page-error', detail: String(error && error.message || error) });
  }
})()`;
}

const WORDS = new Set(SANITIZE_POLICY.words);
const SITE = new RegExp(SANITIZE_POLICY.sitePattern);
const TAG = /<[a-zA-Z][^>]*>/g;
const ATTRIBUTE = /\s([^\s=<>"']+)(?:="([^"]*)")?/g;
const FORBIDDEN_TAG = /<\s*(script|style|noscript|template|link|meta|base|title)\b/i;
const FORBIDDEN_ATTRIBUTE = /^(on.*|style|srcdoc|nonce|integrity)$/i;

function attributeProblem(name: string, value: string): string | null {
  const lower = name.toLowerCase();
  if (FORBIDDEN_ATTRIBUTE.test(lower)) return `attribute ${lower}`;
  if (value === 'x') return null;
  if (lower === 'data-aiaw-site') return SITE.test(value) ? null : `attribute ${lower} value`;
  if (lower === 'class') {
    const bad = value.split(/\s+/).some((part) => part !== '' && !isClosedValue(part, WORDS));
    return bad ? 'attribute class value' : null;
  }
  if (TEXT_ATTRIBUTES.includes(lower)) return CONTROL_LABELS.includes(value.toLowerCase()) ? null : `attribute ${lower} value`;
  if (ID_ATTRIBUTES.includes(lower) || (lower.startsWith('data-') && /(^|-)ids?$/.test(lower) && !/test-?id/.test(lower))) {
    const bad = value.split(/\s+/).some((part) => !ID_PLACEHOLDER.test(part));
    return bad ? `attribute ${lower} value` : null;
  }
  return isClosedValue(value, WORDS) ? null : `attribute ${lower} value`;
}

export function findLeaks(html: string): string[] {
  const problems = new Set<string>();
  if (FORBIDDEN_TAG.test(html)) problems.add('forbidden element');
  if (/<!--/.test(html.replace(/<!doctype[^>]*>/i, ''))) problems.add('comment');
  const body = html.replace(/<!doctype[^>]*>/i, '');
  for (const [tag] of body.matchAll(TAG)) {
    const attributes = tag.replace(/^<[^\s>/]+/, '').replace(/\/?>$/, '');
    for (const match of attributes.matchAll(ATTRIBUTE)) {
      const [, name = '', value = ''] = match;
      const problem = attributeProblem(name, value);
      if (problem !== null) problems.add(problem);
    }
  }
  const text = body.replace(TAG, ' ').replace(/<\/[^>]*>/g, ' ');
  if (text.split(/\s+/).some((word) => word !== '' && word !== 'x')) problems.add('text outside placeholders');
  return [...problems].sort();
}
