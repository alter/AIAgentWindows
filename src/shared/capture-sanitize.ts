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

export const ENUMERATED_ATTRIBUTES: readonly string[] = ['role', 'type', 'contenteditable', 'draggable', 'spellcheck', 'tabindex', 'dir', 'translate', 'autocomplete', 'enterkeyhint', 'inputmode', 'rows', 'cols', 'maxlength', 'disabled', 'hidden', 'checked', 'selected', 'readonly', 'required', 'multiple'];

export const OTHER_ATTRIBUTES: readonly string[] = ['class', 'accept', 'href', 'src', 'srcset', 'action', 'method', 'value', 'lang', 'target', 'rel', 'form', 'autofocus', 'min', 'max', 'step', 'pattern', 'size', 'wrap', 'width', 'height', 'loading', 'open', 'download', 'colspan', 'rowspan'];

export const ARIA_ATTRIBUTES: readonly string[] = [
  ...['atomic', 'autocomplete', 'busy', 'checked', 'colcount', 'colindex', 'colspan', 'current', 'details', 'disabled', 'dropeffect', 'errormessage', 'expanded', 'flowto', 'grabbed', 'haspopup', 'hidden', 'invalid', 'keyshortcuts', 'level', 'live', 'modal', 'multiline', 'multiselectable', 'orientation', 'pressed', 'readonly', 'relevant', 'required', 'rowcount', 'rowindex', 'rowspan', 'selected', 'setsize', 'posinset', 'sort', 'valuemax', 'valuemin', 'valuenow', 'brailleroledescription'].map((name) => 'aria-' + name),
  ...['aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext', 'aria-braillelabel', 'aria-labelledby', 'aria-controls', 'aria-describedby', 'aria-owns', 'aria-activedescendant'],
];

export const HTML_TAGS: readonly string[] = [
  ...['body', 'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'main', 'mark', 'math', 'menu', 'meter', 'nav', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'search', 'section', 'select', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'svg', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr'],
];

export interface SanitizePolicy {
  controlLabels: readonly string[];
  textAttributes: readonly string[];
  idAttributes: readonly string[];
  idLists: readonly string[];
  enumerated: readonly string[];
  attributeNames: readonly string[];
  tags: readonly string[];
  words: readonly string[];
  sitePattern: string;
  maxNodes: number;
}

export const SANITIZE_POLICY: SanitizePolicy = {
  controlLabels: CONTROL_LABELS,
  textAttributes: TEXT_ATTRIBUTES,
  idAttributes: ID_ATTRIBUTES,
  idLists: ID_LISTS,
  enumerated: ENUMERATED_ATTRIBUTES,
  attributeNames: [...OTHER_ATTRIBUTES, ...ENUMERATED_ATTRIBUTES, ...ARIA_ATTRIBUTES],
  tags: HTML_TAGS,
  words: CLOSED_WORDS,
  sitePattern: '^[a-z]{1,20}$',
  maxNodes: 60000,
};

export const ID_PLACEHOLDER = /^id-\d{1,6}$/;

export function isClosedValue(value: string, words: ReadonlySet<string>): boolean {
  if (!/^[A-Za-z0-9_:. -]{1,60}$/.test(value)) return false;
  const parts = value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part !== '');
  const numbers = parts.filter((part) => /^\d{1,4}$/.test(part));
  return parts.length > 0 && numbers.length <= 1 && parts.every((part) => words.has(part) || /^\d{1,4}$/.test(part));
}

export function numberCount(value: string): number {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => /^\d{1,4}$/.test(part)).length;
}

export function hasWord(value: string, words: ReadonlySet<string>): boolean {
  return value.toLowerCase().split(/[^a-z0-9]+/).some((part) => words.has(part));
}

export interface NameSets {
  fixed: ReadonlySet<string>;
  words: ReadonlySet<string>;
}

export function buildNameSets(policy: SanitizePolicy): NameSets {
  return {
    fixed: new Set([...policy.attributeNames, ...policy.textAttributes, ...policy.idAttributes]),
    words: new Set(policy.words),
  };
}

export function isKeptAttributeName(name: string, sets: NameSets): boolean {
  if (sets.fixed.has(name)) return true;
  if (!/^data(-[a-z]+)+$/.test(name)) return false;
  return name.split('-').slice(1).every((part) => sets.words.has(part));
}

export interface SanitizeStats {
  elements: { before: Record<string, number>; after: Record<string, number> };
  classes: { seen: number; closed: number; stylesheet: number; dropped: number };
  stylesheets: { total: number; readable: number; unreadable: number; classNames: number };
}

export interface SanitizeResult {
  html: string;
  classes: string[];
  stats: SanitizeStats;
}

export const STYLESHEET_CLASS_SHAPE = /^[A-Za-z_-][A-Za-z0-9_\-:./%[\]#]{0,63}$/;

export function sanitizePageDetailed(source: Document, site: string, policy: SanitizePolicy): SanitizeResult {
  const TEXT = 'x';
  const SHEET_SHAPE = /^[A-Za-z_-][A-Za-z0-9_\-:./%[\]#]{0,63}$/;
  const MAX_SHEET_CLASSES = 50000;
  const sheetClasses = new Set<string>();
  const sheetStats = { total: 0, readable: 0, unreadable: 0 };
  const classStats = { seen: 0, closed: 0, stylesheet: 0, dropped: 0 };
  const usedSheetClasses = new Set<string>();
  const MAX_NODES = policy.maxNodes;
  const MAX_DEPTH = 400;
  const skip = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'base', 'head']);
  const hollow = new Set(['svg', 'math', 'canvas', 'iframe', 'object', 'embed', 'video', 'audio']);
  const dropped = new Set(['style', 'srcdoc', 'nonce', 'integrity']);
  const enumerated = new Set(policy.enumerated);
  const tags = new Set(policy.tags);
  const nameSets = buildNameSets(policy);
  const structuralData = /(testid|test-id|role|author|state|status|type|kind|variant|slot|component|orientation|side|scope|panel|turn|streaming|generating|loading|focus|disabled|active|selected|mode|level|^data-is-|^data-has-)/;
  const identifierData = /(^|-)ids?$/;
  const sitePattern = new RegExp(policy.sitePattern);
  const words = new Set(policy.words);
  const placeholders = new Map<string, string>();
  const labels = new Set(policy.controlLabels);
  const textAttributes = new Set(policy.textAttributes);
  const idAttributes = new Set(policy.idAttributes);
  const idLists = new Set(policy.idLists);
  const out = source.implementation.createHTMLDocument('');
  let nodes = 0;
  let truncated = false;

  const collectSelector = (selector: string): void => {
    const bare = selector.replace(/(?<!\\)\[(?:[^\]\\]|\\.)*\]/g, '');
    for (const match of bare.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) {
      const name = String(match[1]).replace(/\\(.)/g, '$1');
      if (SHEET_SHAPE.test(name) && sheetClasses.size < MAX_SHEET_CLASSES) sheetClasses.add(name);
    }
  };

  const collectRules = (rules: CSSRuleList, depth: number): void => {
    for (const rule of Array.from(rules)) {
      const selector = (rule as CSSStyleRule).selectorText;
      if (typeof selector === 'string') collectSelector(selector);
      const inner = (rule as CSSGroupingRule).cssRules;
      if (inner !== undefined && depth < 8) collectRules(inner, depth + 1);
    }
  };

  for (const sheet of Array.from(source.styleSheets)) {
    sheetStats.total += 1;
    try {
      collectRules(sheet.cssRules, 0);
      sheetStats.readable += 1;
    } catch {
      sheetStats.unreadable += 1;
    }
  }

  const counted = new Set([...policy.tags, ...skip, 'html']);
  const tally = (elements: Iterable<Element>): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const element of elements) {
      const name = element.localName.toLowerCase();
      const key = counted.has(name) ? name : 'other';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };

  const closed = (value: string, budget: { left: number }): string => {
    if (!isClosedValue(value, words)) return TEXT;
    const count = numberCount(value);
    if (count > budget.left) return TEXT;
    budget.left -= count;
    return value;
  };

  const placeholder = (value: string): string => {
    if (value === '') return TEXT;
    let found = placeholders.get(value);
    if (found === undefined) {
      found = 'id-' + String(placeholders.size + 1);
      placeholders.set(value, found);
    }
    return found;
  };

  const attributeValue = (name: string, value: string, budget: { left: number }): string | null => {
    if (name.startsWith('on') || dropped.has(name)) return null;
    if (name === 'class') {
      const kept: string[] = [];
      for (const part of value.split(/\s+/)) {
        if (part === '') continue;
        classStats.seen += 1;
        if (isClosedValue(part, words) && hasWord(part, words)) {
          const count = numberCount(part);
          if (count <= budget.left) {
            budget.left -= count;
            kept.push(part);
            classStats.closed += 1;
            continue;
          }
        }
        if (sheetClasses.has(part)) {
          usedSheetClasses.add(part);
          kept.push(part);
          classStats.stylesheet += 1;
          continue;
        }
        classStats.dropped += 1;
      }
      return kept.length === 0 ? null : kept.join(' ');
    }
    if (textAttributes.has(name)) return labels.has(value.trim().toLowerCase()) ? value.trim() : TEXT;
    if (idAttributes.has(name)) {
      return idLists.has(name) ? value.trim().split(/\s+/).map(placeholder).join(' ') : placeholder(value.trim());
    }
    if (name.startsWith('data-')) {
      if (identifierData.test(name) && !/test-?id/.test(name)) return placeholder(value.trim());
      return structuralData.test(name) ? closed(value, budget) : TEXT;
    }
    if (name.startsWith('aria-') || enumerated.has(name)) return closed(value, budget);
    return TEXT;
  };

  const copy = (from: Element, depth: number): Element | null => {
    if (nodes >= MAX_NODES || depth > MAX_DEPTH) {
      truncated = true;
      return null;
    }
    if (skip.has(from.localName.toLowerCase()) && depth > 0) return null;
    const known = tags.has(from.localName.toLowerCase());
    const made = known ? out.createElementNS(from.namespaceURI, from.localName.toLowerCase()) : out.createElement('div');
    nodes += 1;
    const budget = { left: 1 };
    for (const attribute of Array.from(from.attributes)) {
      const name = attribute.name.toLowerCase();
      if (!isKeptAttributeName(name, nameSets)) continue;
      const value = attributeValue(name, attribute.value, budget);
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
  return {
    html: '<!doctype html>\n' + root.outerHTML + '\n',
    classes: [...usedSheetClasses].sort(),
    stats: {
      elements: {
        before: tally(source.body === null ? [] : [source.body, ...Array.from(source.body.querySelectorAll('*'))]),
        after: tally(root.querySelectorAll('*')),
      },
      classes: classStats,
      stylesheets: { ...sheetStats, classNames: sheetClasses.size },
    },
  };
}

export function sanitizePage(source: Document, site: string, policy: SanitizePolicy): string {
  return sanitizePageDetailed(source, site, policy).html;
}

export function sanitizeScript(site: string): string {
  return `(() => {
  try {
    const isClosedValue = ${isClosedValue.toString()};
    const numberCount = ${numberCount.toString()};
    const hasWord = ${hasWord.toString()};
    const buildNameSets = ${buildNameSets.toString()};
    const isKeptAttributeName = ${isKeptAttributeName.toString()};
    const result = (${sanitizePageDetailed.toString()})(document, ${JSON.stringify(site)}, ${JSON.stringify(SANITIZE_POLICY)});
    return JSON.stringify({ ok: true, html: result.html, classes: result.classes, stats: result.stats });
  } catch (error) {
    return JSON.stringify({ ok: false, error: 'page-error', detail: String(error && error.message || error) });
  }
})()`;
}

const WORDS = new Set(SANITIZE_POLICY.words);
const NAME_SETS = buildNameSets(SANITIZE_POLICY);
const TAG_NAMES = new Set(SANITIZE_POLICY.tags);
const OWN_ATTRIBUTES = new Set(['data-aiaw-site', 'data-aiaw-truncated']);
const SITE = new RegExp(SANITIZE_POLICY.sitePattern);
const TAG = /<[a-zA-Z][^>]*>/g;
const ATTRIBUTE = /\s([^\s=<>"']+)(?:="([^"]*)")?/g;
const FORBIDDEN_TAG = /<\s*(script|style|noscript|template|link|meta|base|title)\b/i;
const FORBIDDEN_ATTRIBUTE = /^(on.*|style|srcdoc|nonce|integrity)$/i;

function attributeProblem(name: string, value: string, tally: { numbers: number }, sheetClasses: ReadonlySet<string>): string | null {
  const lower = name.toLowerCase();
  if (FORBIDDEN_ATTRIBUTE.test(lower)) return `attribute ${lower}`;
  if (!OWN_ATTRIBUTES.has(lower) && !isKeptAttributeName(lower, NAME_SETS)) return 'attribute name';
  if (value === 'x') return null;
  if (lower === 'data-aiaw-site') return SITE.test(value) ? null : `attribute ${lower} value`;
  if (lower === 'class') {
    const parts = value.split(/\s+/).filter((part) => part !== '');
    const closedParts = parts.filter((part) => isClosedValue(part, WORDS) && hasWord(part, WORDS));
    const others = parts.filter((part) => !closedParts.includes(part));
    if (others.some((part) => !sheetClasses.has(part) || !STYLESHEET_CLASS_SHAPE.test(part))) return 'attribute class value';
    tally.numbers += closedParts.reduce((sum, part) => sum + numberCount(part), 0);
    return null;
  }
  if (TEXT_ATTRIBUTES.includes(lower)) return CONTROL_LABELS.includes(value.toLowerCase()) ? null : `attribute ${lower} value`;
  if (ID_ATTRIBUTES.includes(lower) || (lower.startsWith('data-') && /(^|-)ids?$/.test(lower) && !/test-?id/.test(lower))) {
    const bad = value.split(/\s+/).some((part) => !ID_PLACEHOLDER.test(part));
    return bad ? `attribute ${lower} value` : null;
  }
  if (!isClosedValue(value, WORDS)) return `attribute ${lower} value`;
  tally.numbers += numberCount(value);
  return null;
}

export function findLeaks(html: string, stylesheetClasses: readonly string[] = []): string[] {
  const sheetClasses = new Set(stylesheetClasses);
  const problems = new Set<string>();
  if (FORBIDDEN_TAG.test(html)) problems.add('forbidden element');
  if (/<!--/.test(html.replace(/<!doctype[^>]*>/i, ''))) problems.add('comment');
  const body = html.replace(/<!doctype[^>]*>/i, '');
  for (const [tag] of body.matchAll(TAG)) {
    const tagName = (/^<([^\s>/]+)/.exec(tag)?.[1] ?? '').toLowerCase();
    if (!TAG_NAMES.has(tagName) && tagName !== 'html') problems.add('element name');
    const attributes = tag.replace(/^<[^\s>/]+/, '').replace(/\/?>$/, '');
    const tally = { numbers: 0 };
    for (const match of attributes.matchAll(ATTRIBUTE)) {
      const [, name = '', value = ''] = match;
      const problem = attributeProblem(name, value, tally, sheetClasses);
      if (problem !== null) problems.add(problem);
    }
    if (tally.numbers > 1) problems.add('digit groups');
  }
  const text = body.replace(TAG, ' ').replace(/<\/[^>]*>/g, ' ');
  if (text.split(/\s+/).some((word) => word !== '' && word !== 'x')) problems.add('text outside placeholders');
  return [...problems].sort();
}
