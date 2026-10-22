// registry.ts
import { SITE_KINDS_WITH_ADAPTER, type SiteKind } from '../../shared/agents';
import { DEFAULT_GENERIC_OPTIONS, createGenericAdapter, type GenericOptions } from './generic-adapter';
import type { SiteAdapter } from './types';

export function adapterFor(kind: SiteKind, options: Partial<GenericOptions> = {}): SiteAdapter | null {
  return SITE_KINDS_WITH_ADAPTER.includes(kind) ? createGenericAdapter(kind, { ...DEFAULT_GENERIC_OPTIONS, ...options }) : null;
}
