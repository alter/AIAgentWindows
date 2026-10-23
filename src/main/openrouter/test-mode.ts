// test-mode.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SecretBox } from './secret-box';

const OPEN_TIMEOUT_MS = 15_000;
const TEST_SECRET = createHash('sha256').update('aiaw-openrouter-test-box').digest();
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function fetchOpener(): (url: string) => Promise<void> {
  return async (url) => {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(OPEN_TIMEOUT_MS) });
    await response.arrayBuffer();
    if (!response.ok) throw new Error('the page was not opened');
  };
}

export function testSecretBox(): SecretBox {
  return {
    available: () => Promise.resolve(true),
    encrypt: (plain) => {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', TEST_SECRET, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), body]));
    },
    decrypt: (cipher) => {
      const decipher = createDecipheriv('aes-256-gcm', TEST_SECRET, cipher.subarray(0, IV_BYTES));
      decipher.setAuthTag(cipher.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      const text = Buffer.concat([decipher.update(cipher.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
      return Promise.resolve({ text, reEncrypt: false });
    },
  };
}
