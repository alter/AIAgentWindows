// registry.ts
import type { SiteKind } from '../../shared/agents';
import type { SiteAdapter } from './types';

const ADAPTERS: Readonly<Partial<Record<SiteKind, SiteAdapter>>> = {};

export function adapterFor(kind: SiteKind): SiteAdapter | null {
  return ADAPTERS[kind] ?? null;
}
