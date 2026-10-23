// key-store.ts
import type { SecretBox } from './secret-box';

export interface CipherSlot {
  read(): string | null;
  write(cipher: string | null): Promise<void>;
}

export type LoadResult = 'none' | 'loaded' | 'unavailable' | 'unreadable';

export class KeyStore {
  private key: string | null = null;

  constructor(
    private readonly box: SecretBox,
    private readonly slot: CipherSlot,
  ) {}

  async load(): Promise<LoadResult> {
    const stored = this.slot.read();
    if (stored === null) return 'none';
    if (!(await this.box.available())) return 'unavailable';
    try {
      const { text, reEncrypt } = await this.box.decrypt(Buffer.from(stored, 'base64'));
      if (text.length === 0) throw new Error('empty');
      if (reEncrypt) await this.slot.write((await this.box.encrypt(text)).toString('base64'));
      this.key = text;
      return 'loaded';
    } catch {
      await this.slot.write(null);
      return 'unreadable';
    }
  }

  canStore(): Promise<boolean> {
    return this.box.available();
  }

  async save(key: string): Promise<boolean> {
    let cipher: Buffer;
    try {
      if (!(await this.box.available())) return false;
      cipher = await this.box.encrypt(key);
    } catch {
      return false;
    }
    await this.slot.write(cipher.toString('base64'));
    this.key = key;
    return true;
  }

  async clear(): Promise<void> {
    this.key = null;
    await this.slot.write(null);
  }

  has(): boolean {
    return this.key !== null;
  }

  bearer(): string | null {
    return this.key;
  }
}
