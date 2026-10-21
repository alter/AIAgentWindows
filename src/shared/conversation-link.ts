// conversation-link.ts
import type { SiteKind } from './agents';

const ID = '[A-Za-z0-9_-]{4,}';
const CONVERSATION_PATHS: Readonly<Record<SiteKind, readonly RegExp[]>> = {
  chatgpt: [new RegExp(`^/c/${ID}/?$`)],
  grok: [new RegExp(`^/c/${ID}/?$`), new RegExp(`^/chat/${ID}/?$`)],
  deepseek: [new RegExp(`^/a/chat/s/${ID}/?$`)],
};

export const REPLY_SELECTOR = [
  '[data-message-author-role="assistant"]',
  '[data-author="assistant"]',
  '[data-role="assistant"]',
  '[data-testid*="assistant"]',
  '.ds-markdown',
  '.message-bubble',
  '[class*="assistant"]',
  '[class*="markdown"]',
  '[class*="response"]',
].join(', ');

const MAX_LINKS = 500;
export const MIN_MESSAGES = 2;
const MAX_SCANNED = 20000;

export interface Discovery {
  origin: string;
  url: string;
  hrefs: string[];
  login: boolean;
}

export interface Probe {
  url: string;
  nodes: number;
  textChars: number;
  reply: boolean;
  messageList: boolean;
  mainRegion: boolean;
  width: number;
  height: number;
}

export function conversationPathOf(kind: SiteKind, pathname: string): boolean {
  return CONVERSATION_PATHS[kind].some((pattern) => pattern.test(pathname));
}

export function pickConversationLink(kind: SiteKind, origin: string, hrefs: readonly string[]): string | null {
  for (const href of hrefs) {
    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.origin === 'null' || parsed.origin !== origin) continue;
    if (conversationPathOf(kind, parsed.pathname)) return `${parsed.origin}${parsed.pathname}`;
  }
  return null;
}

export function discoverScript(): string {
  return `(() => {
  try {
    const hrefs = [];
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (hrefs.length >= ${MAX_LINKS}) break;
      hrefs.push(anchor.href);
    }
    const loginPath = /(^|\\/)(log-?in|sign-?in|sign_in|sign-?up|auth|oauth|authorize)(\\/|$)/i.test(location.pathname);
    const loginControl = document.querySelector('input[type="password"], a[href*="login" i], a[href*="signin" i], a[href*="sign-in" i], a[href*="sign_in" i], [data-testid*="login" i]') !== null;
    return JSON.stringify({ origin: location.origin, url: location.href, hrefs, login: loginPath || loginControl });
  } catch (error) {
    return 'null';
  }
})()`;
}

export function probeScript(): string {
  return `(() => {
  try {
    const main = document.querySelector('main, [role="main"]');
    const root = main || document.body;
    const outside = 'nav, aside, [role="navigation"]';
    const plain = (child) => !/^(button|a|svg|option|label|input|textarea|select)$/i.test(child.localName) && (child.textContent || '').trim() !== '';
    let messageList = false;
    if (root) {
      const scanned = [root].concat(Array.from(root.querySelectorAll('*')).slice(0, ${MAX_SCANNED}));
      for (const element of scanned) {
        if (element.closest(outside)) continue;
        if (Array.from(element.children).filter(plain).length >= ${MIN_MESSAGES}) {
          messageList = true;
          break;
        }
      }
    }
    return JSON.stringify({
      url: location.href,
      nodes: document.getElementsByTagName('*').length,
      textChars: document.body ? (document.body.textContent || '').length : 0,
      reply: document.querySelector(${JSON.stringify(REPLY_SELECTOR)}) !== null,
      messageList,
      mainRegion: main !== null,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  } catch (error) {
    return 'null';
  }
})()`;
}

function parseObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseDiscovery(raw: unknown): Discovery | null {
  const value = parseObject(raw);
  if (value === null) return null;
  const { origin, url, hrefs, login } = value;
  if (typeof origin !== 'string' || typeof url !== 'string' || typeof login !== 'boolean') return null;
  if (!Array.isArray(hrefs) || !hrefs.every((href) => typeof href === 'string')) return null;
  return { origin, url, hrefs: hrefs as string[], login };
}

export function parseProbe(raw: unknown): Probe | null {
  const value = parseObject(raw);
  if (value === null) return null;
  const { url, nodes, textChars, reply, messageList, mainRegion, width, height } = value;
  if (typeof url !== 'string' || typeof reply !== 'boolean' || typeof messageList !== 'boolean' || typeof mainRegion !== 'boolean') return null;
  if (typeof nodes !== 'number' || typeof textChars !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null;
  return { url, nodes, textChars, reply, messageList, mainRegion, width, height };
}
