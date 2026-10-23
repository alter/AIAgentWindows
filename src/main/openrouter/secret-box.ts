// secret-box.ts
export interface SecretBox {
  available(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  decrypt(cipher: Buffer): Promise<{ text: string; reEncrypt: boolean }>;
}

export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
  getSelectedStorageBackend(): string;
}

export function electronSecretBox(storage: SafeStorageLike, platform: string): SecretBox {
  return {
    available: async () => {
      if (platform === 'linux' && storage.getSelectedStorageBackend() === 'basic_text') return false;
      return storage.isAsyncEncryptionAvailable();
    },
    encrypt: (plain) => storage.encryptStringAsync(plain),
    decrypt: async (cipher) => {
      const { result, shouldReEncrypt } = await storage.decryptStringAsync(cipher);
      return { text: result, reEncrypt: shouldReEncrypt };
    },
  };
}
