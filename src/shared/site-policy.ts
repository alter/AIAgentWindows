// site-policy.ts
import { SITE_URLS, type SiteKind } from './agents';

const ELECTRON_TOKEN = /\s*Electron\/\S+/;
const GRANTED_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'persistent-storage']);
export const SENSITIVE_PERMISSIONS: ReadonlySet<string> = new Set([
  'media',
  'geolocation',
  'notifications',
  'clipboard-read',
  'display-capture',
  'midi',
  'hid',
  'serial',
  'usb',
  'idle-detection',
]);

export function userAgentFor(kind: SiteKind, defaultUserAgent: string): string {
  return kind === 'deepseek' ? defaultUserAgent.replace(ELECTRON_TOKEN, '') : defaultUserAgent;
}

export function originOf(url: string): string | null {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

export function permissionAllowed(agentOrigin: string, permission: string, requestingUrl: string): boolean {
  if (!GRANTED_PERMISSIONS.has(permission)) return false;
  const agent = originOf(agentOrigin);
  const requester = originOf(requestingUrl);
  return agent !== null && agent === requester;
}

export function permissionCheckAllowed(agentOrigin: string, permission: string, requestingOrigin: string): boolean {
  return SENSITIVE_PERMISSIONS.has(permission) ? permissionAllowed(agentOrigin, permission, requestingOrigin) : true;
}

export function popupAllowed(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function siteStartUrl(kind: SiteKind, env: Readonly<Record<string, string | undefined>>): string {
  const override = env[`AIAW_SITE_URL_${kind.toUpperCase()}`];
  return override !== undefined && popupAllowed(override) && override !== 'about:blank' ? override : SITE_URLS[kind];
}
