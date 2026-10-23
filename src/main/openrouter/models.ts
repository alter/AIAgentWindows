// models.ts
import type { OpenRouterModels } from '../../shared/ipc';
import type { ModelItem } from '../../shared/openrouter';

export class ModelCache {
  private cached: ModelItem[] | null = null;
  private inflight: Promise<OpenRouterModels> | null = null;

  constructor(private readonly fetchModels: () => Promise<ModelItem[]>) {}

  get(refresh: boolean): Promise<OpenRouterModels> {
    if (!refresh && this.cached !== null) return Promise.resolve({ ok: true, models: this.cached });
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<OpenRouterModels> {
    try {
      this.cached = await this.fetchModels();
      return { ok: true, models: this.cached };
    } catch {
      return { ok: false, models: this.cached ?? [] };
    }
  }
}
