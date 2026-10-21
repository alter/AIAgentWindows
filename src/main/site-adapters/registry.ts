// registry.ts
import { SITE_KINDS_WITH_ADAPTER, type SiteKind } from '../../shared/agents';
import { createGenericAdapter } from './generic-adapter';
import type { SiteAdapter } from './types';

export function adapterFor(kind: SiteKind): SiteAdapter | null {
  return SITE_KINDS_WITH_ADAPTER.includes(kind) ? createGenericAdapter(kind) : null;
}
