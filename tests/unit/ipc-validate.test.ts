// ipc-validate.test.ts
import { describe, expect, it } from 'vitest';
import { AGENT_KINDS } from '../../src/shared/agents';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  MAX_PTY_WRITE_BYTES,
  isEventChannel,
  validateRequest,
} from '../../src/shared/ipc';

const ID = 'a1b2c3';

describe('validateRequest', () => {
  it('rejects unknown channel and bad payload', () => {
    expect(validateRequest('app:eval', { code: '1' }).ok).toBe(false);
    expect(validateRequest('', {}).ok).toBe(false);
    expect(validateRequest('constructor', {}).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.addAgent, { kind: 'bash' }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.addAgent, null).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.addAgent, 'claude').ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.addAgent, ['claude']).ok).toBe(false);
  });

  it('accepts every agent kind for add', () => {
    for (const kind of AGENT_KINDS) {
      expect(validateRequest(INVOKE_CHANNELS.addAgent, { kind })).toEqual({ ok: true, value: { kind } });
    }
  });

  it('accepts list with no payload only', () => {
    expect(validateRequest(INVOKE_CHANNELS.listAgents, undefined).ok).toBe(true);
    expect(validateRequest(INVOKE_CHANNELS.listAgents, { x: 1 }).ok).toBe(false);
  });

  it('validates select ids', () => {
    expect(validateRequest(INVOKE_CHANNELS.selectAgent, { id: ID })).toEqual({ ok: true, value: { id: ID } });
    expect(validateRequest(INVOKE_CHANNELS.selectAgent, { id: '' }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.selectAgent, { id: 5 }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.selectAgent, { id: 'x'.repeat(201) }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.selectAgent, {}).ok).toBe(false);
  });

  it('drops unknown fields from accepted payloads', () => {
    const result = validateRequest(INVOKE_CHANNELS.selectAgent, { id: ID, extra: 'x' });
    expect(result).toEqual({ ok: true, value: { id: ID } });
  });

  it('validates pty writes including the size limit', () => {
    expect(validateRequest(INVOKE_CHANNELS.ptyWrite, { id: ID, data: 'ls\r' }).ok).toBe(true);
    expect(validateRequest(INVOKE_CHANNELS.ptyWrite, { id: ID, data: '' }).ok).toBe(true);
    expect(validateRequest(INVOKE_CHANNELS.ptyWrite, { id: ID, data: 5 }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.ptyWrite, { data: 'x' }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.ptyWrite, { id: ID, data: 'x'.repeat(MAX_PTY_WRITE_BYTES) }).ok).toBe(true);
    expect(validateRequest(INVOKE_CHANNELS.ptyWrite, { id: ID, data: 'x'.repeat(MAX_PTY_WRITE_BYTES + 1) }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.ptyWrite, { id: ID, data: 'é'.repeat(MAX_PTY_WRITE_BYTES) }).ok).toBe(false);
  });

  it('validates pty resize dimensions', () => {
    expect(validateRequest(INVOKE_CHANNELS.ptyResize, { id: ID, cols: 80, rows: 24 }).ok).toBe(true);
    for (const [cols, rows] of [[0, 24], [80, 0], [-1, 24], [80.5, 24], [80, 10000], [100000, 24], [NaN, 24]]) {
      expect(validateRequest(INVOKE_CHANNELS.ptyResize, { id: ID, cols, rows }).ok).toBe(false);
    }
    expect(validateRequest(INVOKE_CHANNELS.ptyResize, { id: ID, cols: '80', rows: 24 }).ok).toBe(false);
  });

  it('validates backlog requests', () => {
    expect(validateRequest(INVOKE_CHANNELS.ptyBacklog, { id: ID })).toEqual({ ok: true, value: { id: ID } });
    expect(validateRequest(INVOKE_CHANNELS.ptyBacklog, {}).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.ptyBacklog, { id: 3 }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.ptyBacklog, null).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.ptyBacklog, ID).ok).toBe(false);
  });

  it('validates site navigation actions', () => {
    for (const action of ['back', 'forward', 'home', 'reload']) {
      expect(validateRequest(INVOKE_CHANNELS.siteNav, { id: ID, action }).ok).toBe(true);
    }
    expect(validateRequest(INVOKE_CHANNELS.siteNav, { id: ID, action: 'goto' }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.siteNav, { id: ID }).ok).toBe(false);
  });

  it('reports which channel failed', () => {
    const result = validateRequest(INVOKE_CHANNELS.selectAgent, { id: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(INVOKE_CHANNELS.selectAgent);
  });
});

describe('channel tables', () => {
  it('keeps invoke and event channel names disjoint and event names recognised', () => {
    const invoke = Object.values(INVOKE_CHANNELS);
    const events = Object.values(EVENT_CHANNELS);
    expect(new Set([...invoke, ...events]).size).toBe(invoke.length + events.length);
    for (const name of events) expect(isEventChannel(name)).toBe(true);
    for (const name of invoke) expect(isEventChannel(name)).toBe(false);
    expect(isEventChannel('nope')).toBe(false);
  });
});
