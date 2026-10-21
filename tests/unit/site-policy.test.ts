// site-policy.test.ts
import { describe, expect, it } from 'vitest';
import { SITE_URLS } from '../../src/shared/agents';
import { originOf, permissionAllowed, popupAllowed, userAgentFor } from '../../src/shared/site-policy';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) aiagentwindows/0.1.0 Chrome/150.0.0.0 Electron/44.6.0 Safari/537.36';

describe('userAgentFor', () => {
  it('removes the Electron token for DeepSeek and keeps the rest', () => {
    const ua = userAgentFor('deepseek', DEFAULT_UA);
    expect(ua).not.toContain('Electron/');
    expect(ua).toContain('Chrome/150.0.0.0');
    expect(ua).toContain('Safari/537.36');
    expect(ua).not.toContain('  ');
  });

  it('keeps the default user agent for ChatGPT and Grok', () => {
    expect(userAgentFor('chatgpt', DEFAULT_UA)).toBe(DEFAULT_UA);
    expect(userAgentFor('grok', DEFAULT_UA)).toBe(DEFAULT_UA);
  });

  it('leaves a user agent without the token unchanged for DeepSeek', () => {
    expect(userAgentFor('deepseek', 'Mozilla/5.0 Chrome/150.0.0.0')).toBe('Mozilla/5.0 Chrome/150.0.0.0');
  });
});

describe('originOf', () => {
  it('reduces a URL to its origin', () => {
    expect(originOf('https://chatgpt.com/c/abc?x=1')).toBe('https://chatgpt.com');
  });

  it('returns null for text that is not a URL', () => {
    expect(originOf('not a url')).toBeNull();
    expect(originOf('')).toBeNull();
  });

  it('returns null for an opaque origin', () => {
    expect(originOf('data:text/html,hi')).toBeNull();
  });
});

describe('permissionAllowed', () => {
  const chatgpt = originOf(SITE_URLS.chatgpt) as string;

  it('grants media and persistent-storage to the agent origin', () => {
    expect(permissionAllowed(chatgpt, 'media', 'https://chatgpt.com/c/abc')).toBe(true);
    expect(permissionAllowed(chatgpt, 'persistent-storage', 'https://chatgpt.com/')).toBe(true);
  });

  it('refuses every other permission even for the agent origin', () => {
    for (const permission of ['geolocation', 'notifications', 'clipboard-read', 'openExternal', 'midi', 'fullscreen', '']) {
      expect(permissionAllowed(chatgpt, permission, 'https://chatgpt.com/')).toBe(false);
    }
  });

  it('refuses another origin, a sibling subdomain, another scheme and another port', () => {
    expect(permissionAllowed(chatgpt, 'media', 'https://evil.example/')).toBe(false);
    expect(permissionAllowed(chatgpt, 'media', 'https://auth.chatgpt.com/')).toBe(false);
    expect(permissionAllowed(chatgpt, 'media', 'http://chatgpt.com/')).toBe(false);
    expect(permissionAllowed(chatgpt, 'media', 'https://chatgpt.com:8443/')).toBe(false);
    expect(permissionAllowed(chatgpt, 'media', 'https://chatgpt.com.evil.example/')).toBe(false);
  });

  it('refuses an unparsable requesting URL or agent origin', () => {
    expect(permissionAllowed(chatgpt, 'media', '')).toBe(false);
    expect(permissionAllowed(chatgpt, 'media', 'garbage')).toBe(false);
    expect(permissionAllowed('', 'media', 'https://chatgpt.com/')).toBe(false);
    expect(permissionAllowed('null', 'media', 'null')).toBe(false);
  });
});

describe('popupAllowed', () => {
  it('allows http and https pages and about:blank', () => {
    expect(popupAllowed('https://accounts.example/login')).toBe(true);
    expect(popupAllowed('http://example.com/')).toBe(true);
    expect(popupAllowed('about:blank')).toBe(true);
  });

  it('refuses other schemes and unparsable text', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://gpu', 'custom-app://x', '', 'garbage']) {
      expect(popupAllowed(url)).toBe(false);
    }
  });
});
