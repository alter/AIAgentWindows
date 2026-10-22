// site-policy.ts
import { SITE_URLS, type SiteKind } from './agents';

export const OWNER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const GREASE_BRAND = { brand: 'Not?A_Brand', version: '24', fullVersion: '24.0.0.0' };
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

export interface EngineInfo {
  chromeVersion: string;
  platformVersion: string;
  arch: string;
}

export interface BrandVersion {
  brand: string;
  version: string;
}

export interface UserAgentMetadata {
  brands: BrandVersion[];
  fullVersionList: BrandVersion[];
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
}

export interface UserAgentOverride {
  userAgent: string;
  userAgentMetadata: UserAgentMetadata;
}

export function userAgentOverride(engine: EngineInfo): UserAgentOverride {
  const major = /Chrome\/(\d+)/.exec(OWNER_USER_AGENT)?.[1] ?? '';
  const named = ['Chromium', 'Google Chrome'];
  return {
    userAgent: OWNER_USER_AGENT,
    userAgentMetadata: {
      brands: [
        { brand: GREASE_BRAND.brand, version: GREASE_BRAND.version },
        ...named.map((brand) => ({ brand, version: major })),
      ],
      fullVersionList: [
        { brand: GREASE_BRAND.brand, version: GREASE_BRAND.fullVersion },
        ...named.map((brand) => ({ brand, version: engine.chromeVersion })),
      ],
      platform: 'macOS',
      platformVersion: engine.platformVersion,
      architecture: engine.arch === 'arm64' ? 'arm' : 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  };
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
