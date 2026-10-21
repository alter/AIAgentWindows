// api.ts
import type { AppApi } from '../shared/ipc';

export const api: AppApi = (window as unknown as { aiaw: AppApi }).aiaw;
