// site-seats.ts
import { isSiteKind, type Agent, type SiteKind } from '../shared/agents';
import type { RoomParticipant } from '../shared/room-model';
import { missingAdapterNote } from '../shared/room-view';
import type { SiteSeat } from './room-drivers';
import { createIsolatedRunner, type IsolatedContents } from './site-adapters/isolated-runner';
import type { SiteAdapter } from './site-adapters/types';

export interface SiteSeatDeps {
  agents(): readonly Agent[];
  page(agent: Agent & { kind: SiteKind }): IsolatedContents;
  prepare(agent: Agent & { kind: SiteKind }, timeoutMs: number, signal: AbortSignal): Promise<void>;
  newChat(agent: Agent & { kind: SiteKind }, timeoutMs: number, signal: AbortSignal): Promise<void>;
  adapterFor(kind: SiteKind): SiteAdapter | null;
}

export function createSiteSeats(deps: SiteSeatDeps): (participant: RoomParticipant) => SiteSeat | null {
  return (participant) => {
    const kind = participant.kind;
    if (!isSiteKind(kind)) return null;
    const adapter = deps.adapterFor(kind);
    if (adapter === null) throw new Error(missingAdapterNote(participant.label));
    const agent = deps.agents().find((item) => item.kind === kind);
    if (agent === undefined) return null;
    const site = { ...agent, kind };
    return {
      adapter,
      runner: createIsolatedRunner(deps.page(site)),
      prepare: (timeoutMs, signal) => deps.prepare(site, timeoutMs, signal),
      newChat: (timeoutMs, signal) => deps.newChat(site, timeoutMs, signal),
    };
  };
}
