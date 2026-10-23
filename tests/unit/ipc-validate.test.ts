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

  it('validates close and restart ids', () => {
    for (const channel of [INVOKE_CHANNELS.closeAgent, INVOKE_CHANNELS.restartAgent]) {
      expect(validateRequest(channel, { id: ID })).toEqual({ ok: true, value: { id: ID } });
      expect(validateRequest(channel, { id: '' }).ok).toBe(false);
      expect(validateRequest(channel, {}).ok).toBe(false);
      expect(validateRequest(channel, undefined).ok).toBe(false);
    }
  });

  it('agent rename accepts a valid id and a clean title only', () => {
    expect(INVOKE_CHANNELS.renameAgent).toBe('agent:rename');
    expect(validateRequest(INVOKE_CHANNELS.renameAgent, { id: ID, title: ' Reviewer ' })).toEqual({ ok: true, value: { id: ID, title: 'Reviewer' } });
    for (const id of ['', 5, undefined, 'x'.repeat(201)]) {
      expect(validateRequest(INVOKE_CHANNELS.renameAgent, { id, title: 'ok' }).ok).toBe(false);
    }
    for (const title of ['', '   ', 'x'.repeat(81), 'a\nb', 'a\u0000b', 7, null, undefined]) {
      expect(validateRequest(INVOKE_CHANNELS.renameAgent, { id: ID, title }).ok).toBe(false);
    }
    expect(validateRequest(INVOKE_CHANNELS.renameAgent, null).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.renameAgent, ID).ok).toBe(false);
  });
});

describe('room channels', () => {
  const config = {
    prompt: 'hello',
    mode: 'relay',
    rounds: 2,
    participants: [{ id: 'claude', kind: 'claude', label: 'Claude Code' }],
    finalizerId: 'claude',
    turnTimeoutMs: 600000,
    debugSites: false,
  };

  it('accepts a valid room start and rejects an invalid one', () => {
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config })).toEqual({ ok: true, value: { config } });
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config, continueId: 'room-1_a' })).toEqual({ ok: true, value: { config, continueId: 'room-1_a' } });
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config: { ...config, rounds: 51 } }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config: { ...config, prompt: '' } }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config: { ...config, finalizerId: 'codex' } }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomStart, config).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomStart, null).ok).toBe(false);
    for (const continueId of ['../x', 'a/b', '', 7, null, 'x'.repeat(65)]) {
      expect(validateRequest(INVOKE_CHANNELS.roomStart, { config, continueId }).ok).toBe(false);
    }
  });

  it('room start accepts resume only as a boolean with a continue id', () => {
    const continueId = 'room-1_a';
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config, continueId, resume: true })).toEqual({ ok: true, value: { config, continueId, resume: true } });
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config, continueId, resume: false })).toEqual({ ok: true, value: { config, continueId, resume: false } });
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config, resume: true }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomStart, { config, resume: false }).ok).toBe(false);
    for (const resume of ['true', 1, 0, null, {}, []]) {
      expect(validateRequest(INVOKE_CHANNELS.roomStart, { config, continueId, resume }).ok).toBe(false);
    }
  });

  it('opens a room by a valid id only', () => {
    expect(validateRequest(INVOKE_CHANNELS.roomOpen, { id: 'room-1_a' })).toEqual({ ok: true, value: { id: 'room-1_a' } });
    for (const id of ['../x', 'a/b', 'a.b', '', 7, undefined]) {
      expect(validateRequest(INVOKE_CHANNELS.roomOpen, { id }).ok).toBe(false);
    }
    expect(validateRequest(INVOKE_CHANNELS.roomOpen, null).ok).toBe(false);
  });

  it('room rename rejects a malformed id or title', () => {
    expect(INVOKE_CHANNELS.roomRename).toBe('room:rename');
    expect(validateRequest(INVOKE_CHANNELS.roomRename, { id: 'room-1_a', title: ' New name ' })).toEqual({ ok: true, value: { id: 'room-1_a', title: 'New name' } });
    for (const id of ['../x', 'a/b', '', 7, undefined]) {
      expect(validateRequest(INVOKE_CHANNELS.roomRename, { id, title: 'ok' }).ok).toBe(false);
    }
    for (const title of ['', '   ', 'x'.repeat(81), 'a\nb', 'a\u0000b', 7, null, undefined]) {
      expect(validateRequest(INVOKE_CHANNELS.roomRename, { id: 'room-1_a', title }).ok).toBe(false);
    }
    expect(validateRequest(INVOKE_CHANNELS.roomRename, null).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomRename, 'room-1_a').ok).toBe(false);
  });

  it('takes no payload for state, select and stop', () => {
    for (const channel of [INVOKE_CHANNELS.roomState, INVOKE_CHANNELS.roomList, INVOKE_CHANNELS.roomNew, INVOKE_CHANNELS.roomSelect, INVOKE_CHANNELS.roomStop, INVOKE_CHANNELS.roomResume, INVOKE_CHANNELS.roomCopyFinal]) {
      expect(validateRequest(channel, undefined).ok).toBe(true);
      expect(validateRequest(channel, { x: 1 }).ok).toBe(false);
    }
  });

  it('validates carry as an agent id and a known kind of text', () => {
    expect(validateRequest(INVOKE_CHANNELS.roomCarry, { id: ID, what: 'final' })).toEqual({ ok: true, value: { id: ID, what: 'final' } });
    expect(validateRequest(INVOKE_CHANNELS.roomCarry, { id: ID, what: 'history' }).ok).toBe(true);
    expect(validateRequest(INVOKE_CHANNELS.roomCarry, { id: ID, what: 'text' }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomCarry, { id: '', what: 'final' }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomCarry, { what: 'final' }).ok).toBe(false);
  });

  it('validates the paused-terminal channels like the pty ones: an id, bounded data, positive sizes', () => {
    expect(validateRequest(INVOKE_CHANNELS.roomTerminalBacklog, { id: ID })).toEqual({ ok: true, value: { id: ID } });
    expect(validateRequest(INVOKE_CHANNELS.roomTerminalBacklog, {}).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomTerminalWrite, { id: ID, data: 'a' })).toEqual({ ok: true, value: { id: ID, data: 'a' } });
    expect(validateRequest(INVOKE_CHANNELS.roomTerminalWrite, { id: ID, data: 5 }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomTerminalWrite, { id: ID, data: 'x'.repeat(MAX_PTY_WRITE_BYTES + 1) }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomTerminalResize, { id: ID, cols: 80, rows: 24 }).ok).toBe(true);
    expect(validateRequest(INVOKE_CHANNELS.roomTerminalResize, { id: ID, cols: 0, rows: 24 }).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomTerminalResize, { id: ID, cols: 80 }).ok).toBe(false);
  });

  it('room:models takes no payload', () => {
    expect(INVOKE_CHANNELS.roomModels).toBe('room:models');
    expect(validateRequest(INVOKE_CHANNELS.roomModels, undefined)).toEqual({ ok: true, value: undefined });
    expect(validateRequest(INVOKE_CHANNELS.roomModels, {}).ok).toBe(false);
    expect(validateRequest(INVOKE_CHANNELS.roomModels, null).ok).toBe(false);
  });

  it('the room event channels are events, not invokes', () => {
    expect(isEventChannel(EVENT_CHANNELS.roomTerminalData)).toBe(true);
    expect(isEventChannel(EVENT_CHANNELS.roomEvent)).toBe(true);
  });
});

describe('layout channels', () => {
  it('layout sidebar accepts only an integer width in range', () => {
    for (const width of [180, 260, 599, 600]) {
      expect(validateRequest(INVOKE_CHANNELS.layoutSidebar, { width })).toEqual({ ok: true, value: { width } });
    }
    for (const width of [179, 601, 0, -260, 260.5, Number.NaN, Infinity, '260', null, undefined, [260], {}]) {
      expect(validateRequest(INVOKE_CHANNELS.layoutSidebar, { width }).ok).toBe(false);
    }
    for (const payload of [undefined, null, 260, '260', [260], {}]) {
      expect(validateRequest(INVOKE_CHANNELS.layoutSidebar, payload).ok).toBe(false);
    }
  });

  it('layout get takes no payload', () => {
    expect(validateRequest(INVOKE_CHANNELS.layoutGet, undefined).ok).toBe(true);
    expect(validateRequest(INVOKE_CHANNELS.layoutGet, { x: 1 }).ok).toBe(false);
  });
});

describe('theme channels', () => {
  it('theme set accepts only system, light or dark', () => {
    for (const choice of ['system', 'light', 'dark']) {
      expect(validateRequest(INVOKE_CHANNELS.themeSet, { choice })).toEqual({ ok: true, value: { choice } });
    }
    for (const choice of ['', 'Dark', 'auto', 'neon', 1, null, undefined, ['dark'], {}]) {
      expect(validateRequest(INVOKE_CHANNELS.themeSet, { choice }).ok).toBe(false);
    }
    for (const payload of [undefined, null, 'dark', ['dark'], {}]) {
      expect(validateRequest(INVOKE_CHANNELS.themeSet, payload).ok).toBe(false);
    }
  });

  it('theme get takes no payload', () => {
    expect(validateRequest(INVOKE_CHANNELS.themeGet, undefined).ok).toBe(true);
    expect(validateRequest(INVOKE_CHANNELS.themeGet, { x: 1 }).ok).toBe(false);
  });
});
