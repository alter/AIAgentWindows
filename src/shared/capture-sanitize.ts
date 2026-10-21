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

export interface SanitizePolicy {
  controlLabels: readonly string[];
  textAttributes: readonly string[];
  idAttributes: readonly string[];
  idLists: readonly string[];
  tokenPattern: string;
  classPattern: string;
  opaquePattern: string;
}

export const SANITIZE_POLICY: SanitizePolicy = {
  controlLabels: CONTROL_LABELS,
  textAttributes: TEXT_ATTRIBUTES,
  idAttributes: ID_ATTRIBUTES,
  idLists: ID_LISTS,
  tokenPattern: '^[A-Za-z0-9_:.-]{1,40}$',
  classPattern: '^[A-Za-z0-9_:./%#()=,!*[\\]-]{1,80}$',
  opaquePattern: '\\d{6,}|[0-9a-f]{8}-[0-9a-f]{4}|[0-9a-f]{16}',
};

export function sanitizePage(source: Document, site: string, policy: SanitizePolicy): string {
  const TEXT = 'x';
  const MAX_NODES = 60000;
  const MAX_DEPTH = 400;
  const skip = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'base', 'head']);
  const hollow = new Set(['svg', 'math', 'canvas', 'iframe', 'object', 'embed', 'video', 'audio']);
  const dropped = new Set(['style', 'srcdoc', 'nonce', 'integrity']);
  const enumerated = new Set(['role', 'type', 'contenteditable', 'draggable', 'spellcheck', 'tabindex', 'dir', 'translate', 'autocomplete', 'enterkeyhint', 'inputmode', 'rows', 'cols', 'maxlength', 'disabled', 'hidden', 'checked', 'selected', 'readonly', 'required', 'multiple']);
  const structuralData = /(testid|test-id|role|author|state|status|type|kind|variant|slot|component|orientation|side|scope|panel|turn|streaming|generating|loading|focus|disabled|active|selected|mode|level|^data-is-|^data-has-)/;
  const tokenPattern = new RegExp(policy.tokenPattern);
  const classPattern = new RegExp(policy.classPattern);
  const opaquePattern = new RegExp(policy.opaquePattern, 'i');
  const namePattern = /^[a-z_][a-z0-9_.:-]{0,63}$/i;
  const labels = new Set(policy.controlLabels);
  const textAttributes = new Set(policy.textAttributes);
  const idAttributes = new Set(policy.idAttributes);
  const idLists = new Set(policy.idLists);
  const out = source.implementation.createHTMLDocument('');
  let nodes = 0;
  let truncated = false;

  const token = (value: string): string => (tokenPattern.test(value) && !opaquePattern.test(value) ? value : TEXT);

  const attributeValue = (name: string, value: string): string | null => {
    if (name.startsWith('on') || dropped.has(name)) return null;
    if (name === 'class') {
      const kept = value.split(/\s+/).filter((part) => classPattern.test(part) && !opaquePattern.test(part));
      return kept.length === 0 ? null : kept.join(' ');
    }
    if (textAttributes.has(name)) return labels.has(value.trim().toLowerCase()) ? value.trim() : TEXT;
    if (idAttributes.has(name)) {
      return idLists.has(name) ? value.trim().split(/\s+/).map(token).join(' ') : token(value.trim());
    }
    if (name.startsWith('data-')) return structuralData.test(name) ? token(value) : TEXT;
    if (name.startsWith('aria-') || enumerated.has(name)) return token(value);
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
  root.setAttribute('data-aiaw-site', token(site));
  const body = source.body === null ? null : copy(source.body, 0);
  root.replaceChildren(body ?? out.createElement('body'));
  if (truncated) root.setAttribute('data-aiaw-truncated', 'true');
  return '<!doctype html>\n' + root.outerHTML + '\n';
}

export function sanitizeScript(site: string): string {
  return `(() => {
  try {
    const html = (${sanitizePage.toString()})(document, ${JSON.stringify(site)}, ${JSON.stringify(SANITIZE_POLICY)});
    return JSON.stringify({ ok: true, html });
  } catch (error) {
    return JSON.stringify({ ok: false, error: 'page-error', detail: String(error && error.message || error) });
  }
})()`;
}

const TOKEN = new RegExp(SANITIZE_POLICY.tokenPattern);
const CLASS_TOKEN = new RegExp(SANITIZE_POLICY.classPattern);
const OPAQUE = new RegExp(SANITIZE_POLICY.opaquePattern, 'i');
const TAG = /<[a-zA-Z][^>]*>/g;
const ATTRIBUTE = /\s([^\s=<>"']+)(?:="([^"]*)")?/g;
const FORBIDDEN_TAG = /<\s*(script|style|noscript|template|link|meta|base|title)\b/i;
const FORBIDDEN_ATTRIBUTE = /^(on.*|style|srcdoc|nonce|integrity)$/i;

function attributeProblem(name: string, value: string): string | null {
  const lower = name.toLowerCase();
  if (FORBIDDEN_ATTRIBUTE.test(lower)) return `attribute ${lower}`;
  if (value === 'x') return null;
  if (lower === 'class') {
    const bad = value.split(/\s+/).some((part) => part !== '' && (!CLASS_TOKEN.test(part) || OPAQUE.test(part)));
    return bad ? 'attribute class value' : null;
  }
  if (TEXT_ATTRIBUTES.includes(lower)) return CONTROL_LABELS.includes(value.toLowerCase()) ? null : `attribute ${lower} value`;
  if (ID_ATTRIBUTES.includes(lower)) {
    const parts = ID_LISTS.includes(lower) ? value.split(/\s+/) : [value];
    const bad = parts.some((part) => !TOKEN.test(part) || OPAQUE.test(part));
    return bad ? `attribute ${lower} value` : null;
  }
  return TOKEN.test(value) && !OPAQUE.test(value) ? null : `attribute ${lower} value`;
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
