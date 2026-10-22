// site-network-tap.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, capBody, isBodyMime, originOf, watchNetwork, type NetDebugger } from '../../src/main/site-adapters/network-tap';
import { createIsolatedRunner } from '../../src/main/site-adapters/isolated-runner';
import type { NetSink } from '../../src/main/site-adapters/types';

type Listener = (event: unknown, method: string, params: unknown) => void;

class FakeDebugger implements NetDebugger {
  attached = false;
  listeners = new Set<Listener>();
  commands: Array<{ method: string; params?: Record<string, unknown> }> = [];
  bodies = new Map<string, { body: string; base64Encoded: boolean } | Error>();
  enableError: Error | null = null;

  isAttached(): boolean {
    return this.attached;
  }
  attach(): void {
    this.attached = true;
  }
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.commands.push({ method, params });
    if (method === 'Network.enable' && this.enableError !== null) return Promise.reject(this.enableError);
    if (method === 'Network.getResponseBody') {
      const found = this.bodies.get(String(params?.['requestId']));
      if (found instanceof Error) return Promise.reject(found);
      return Promise.resolve(found ?? { body: '', base64Encoded: false });
    }
    return Promise.resolve({});
  }
  on(_event: 'message', listener: Listener): this {
    this.listeners.add(listener);
    return this;
  }
  removeListener(_event: 'message', listener: Listener): this {
    this.listeners.delete(listener);
    return this;
  }
  emit(method: string, params: unknown): void {
    for (const listener of [...this.listeners]) listener({}, method, params);
  }
}

class Sink implements NetSink {
  events: Array<{ name: string; fields: Record<string, unknown> }> = [];
  saved: string[] = [];
  event(name: string, fields: Readonly<Record<string, string | number | boolean>> = {}): void {
    this.events.push({ name, fields: { ...fields } });
  }
  saveBody(text: string): Promise<string | null> {
    this.saved.push(text);
    return Promise.resolve(`net/${String(this.saved.length).padStart(4, '0')}.txt`);
  }
  phases(): string[] {
    return this.events.filter((item) => item.name === 'net').map((item) => String(item.fields['phase']));
  }
}

const PAGE = 'https://chat.example.com/c/abc?token=secret';

function request(cdp: FakeDebugger, id: string, url: string, timestamp = 10): void {
  cdp.emit('Network.requestWillBeSent', { requestId: id, request: { url, method: 'POST' }, timestamp });
}

describe('network tap', () => {
  it('enables the Network domain on the attached debugger and disables it on stop, without detaching', async () => {
    const cdp = new FakeDebugger();
    cdp.attached = true;
    const watch = await watchNetwork(cdp, PAGE, new Sink());
    expect(cdp.commands.map((item) => item.method)).toEqual(['Network.enable']);
    expect(cdp.listeners.size).toBe(1);
    await watch.stop();
    expect(cdp.commands.map((item) => item.method)).toEqual(['Network.enable', 'Network.disable']);
    expect(cdp.listeners.size).toBe(0);
  });

  it('attaches when nothing attached the debugger yet', async () => {
    const cdp = new FakeDebugger();
    await watchNetwork(cdp, PAGE, new Sink());
    expect(cdp.attached).toBe(true);
  });

  it('records the request lifecycle of the own origin with the URL path only', async () => {
    const cdp = new FakeDebugger();
    const sink = new Sink();
    await watchNetwork(cdp, PAGE, sink);
    request(cdp, '1', 'https://chat.example.com/api/chat?conversation=secret#frag');
    cdp.emit('Network.responseReceived', { requestId: '1', response: { mimeType: 'application/json', status: 200 }, timestamp: 10.2 });
    cdp.emit('Network.loadingFinished', { requestId: '1', encodedDataLength: 321, timestamp: 10.5 });
    request(cdp, '2', 'https://chat.example.com/api/other', 11);
    cdp.emit('Network.loadingFailed', { requestId: '2', errorText: 'net::ERR_ABORTED', timestamp: 11.1 });
    expect(sink.phases()).toEqual(['request', 'response', 'finished', 'request', 'failed']);
    expect(sink.events[0]?.fields).toMatchObject({ id: '1', path: '/api/chat', method: 'POST' });
    expect(sink.events[1]?.fields).toMatchObject({ mime: 'application/json', status: 200 });
    expect(sink.events[2]?.fields).toMatchObject({ length: 321, durationMs: 500 });
    expect(sink.events[4]?.fields).toMatchObject({ error: 'net::ERR_ABORTED' });
    expect(JSON.stringify(sink.events)).not.toContain('secret');
    expect(JSON.stringify(sink.events)).not.toContain('frag');
  });

  it('ignores other origins, unknown request ids and malformed messages', async () => {
    const cdp = new FakeDebugger();
    const sink = new Sink();
    await watchNetwork(cdp, PAGE, sink);
    request(cdp, '1', 'https://cdn.example.net/x.js');
    request(cdp, '2', 'http://chat.example.com/insecure');
    request(cdp, '3', 'not a url');
    cdp.emit('Network.responseReceived', { requestId: '1', response: { mimeType: 'text/plain', status: 200 } });
    cdp.emit('Network.loadingFinished', { requestId: 'nope', timestamp: 1 });
    cdp.emit('Network.requestWillBeSent', null);
    cdp.emit('Network.requestWillBeSent', { requestId: '9' });
    cdp.emit('Network.dataReceived', { requestId: '9' });
    expect(sink.events).toEqual([]);
  });

  it('saves the body of a stream or json response longer than one second, decoding base64', async () => {
    const cdp = new FakeDebugger();
    const sink = new Sink();
    const watch = await watchNetwork(cdp, PAGE, sink);
    cdp.bodies.set('1', { body: 'data: hello\n\n', base64Encoded: false });
    cdp.bodies.set('2', { body: Buffer.from('{"a":1}').toString('base64'), base64Encoded: true });
    for (const [id, mime] of [['1', 'text/event-stream; charset=utf-8'], ['2', 'application/json']] as const) {
      request(cdp, id, `https://chat.example.com/api/${id}`, 100);
      cdp.emit('Network.responseReceived', { requestId: id, response: { mimeType: mime, status: 200 }, timestamp: 100.1 });
      cdp.emit('Network.loadingFinished', { requestId: id, encodedDataLength: 5, timestamp: 102 });
    }
    await watch.stop();
    expect(sink.saved).toEqual(['data: hello\n\n', '{"a":1}']);
    expect(sink.events.filter((item) => item.fields['phase'] === 'body').map((item) => item.fields['file'])).toEqual(['net/0001.txt', 'net/0002.txt']);
  });

  it('does not fetch the body of a short response, of another mime type, or one that was never answered', async () => {
    const cdp = new FakeDebugger();
    const sink = new Sink();
    const watch = await watchNetwork(cdp, PAGE, sink);
    request(cdp, '1', 'https://chat.example.com/a', 100);
    cdp.emit('Network.responseReceived', { requestId: '1', response: { mimeType: 'text/event-stream', status: 200 }, timestamp: 100.1 });
    cdp.emit('Network.loadingFinished', { requestId: '1', timestamp: 100.9 });
    request(cdp, '2', 'https://chat.example.com/b', 100);
    cdp.emit('Network.responseReceived', { requestId: '2', response: { mimeType: 'text/html', status: 200 }, timestamp: 100.1 });
    cdp.emit('Network.loadingFinished', { requestId: '2', timestamp: 110 });
    request(cdp, '3', 'https://chat.example.com/c', 100);
    cdp.emit('Network.loadingFinished', { requestId: '3', timestamp: 110 });
    await watch.stop();
    expect(cdp.commands.some((item) => item.method === 'Network.getResponseBody')).toBe(false);
    expect(sink.saved).toEqual([]);
  });

  it('records a body that cannot be read as an error and does not throw', async () => {
    const cdp = new FakeDebugger();
    const sink = new Sink();
    cdp.bodies.set('1', new Error('No data found for resource with given identifier'));
    const watch = await watchNetwork(cdp, PAGE, sink);
    request(cdp, '1', 'https://chat.example.com/stream', 100);
    cdp.emit('Network.responseReceived', { requestId: '1', response: { mimeType: 'text/event-stream', status: 200 }, timestamp: 100.1 });
    cdp.emit('Network.loadingFinished', { requestId: '1', timestamp: 105 });
    await watch.stop();
    const failed = sink.events.find((item) => item.fields['phase'] === 'body-failed');
    expect(failed?.fields).toMatchObject({ id: '1', path: '/stream', error: 'No data found for resource with given identifier' });
    expect(sink.saved).toEqual([]);
  });

  it('records the file as not saved when the sink could not keep the body', async () => {
    const cdp = new FakeDebugger();
    const sink = new Sink();
    sink.saveBody = () => Promise.resolve(null);
    cdp.bodies.set('1', { body: 'x', base64Encoded: false });
    const watch = await watchNetwork(cdp, PAGE, sink);
    request(cdp, '1', 'https://chat.example.com/stream', 100);
    cdp.emit('Network.responseReceived', { requestId: '1', response: { mimeType: 'application/x-ndjson', status: 200 }, timestamp: 100.1 });
    cdp.emit('Network.loadingFinished', { requestId: '1', timestamp: 105 });
    await watch.stop();
    expect(sink.events.find((item) => item.fields['phase'] === 'body')?.fields).toMatchObject({ file: 'not-saved' });
  });

  it('records nothing and asks the debugger for nothing when the page has no usable origin', async () => {
    for (const url of [null, 'about:blank', 'file:///x.html', 'nonsense']) {
      const cdp = new FakeDebugger();
      const sink = new Sink();
      const watch = await watchNetwork(cdp, url, sink);
      await watch.stop();
      expect(cdp.commands).toEqual([]);
      expect(cdp.listeners.size).toBe(0);
      expect(sink.events).toEqual([{ name: 'net-skipped', fields: { reason: 'no-origin' } }]);
    }
  });

  it('removes its listener and rethrows when the domain cannot be enabled', async () => {
    const cdp = new FakeDebugger();
    cdp.enableError = new Error('Target closed');
    await expect(watchNetwork(cdp, PAGE, new Sink())).rejects.toThrow('Target closed');
    expect(cdp.listeners.size).toBe(0);
  });

  it('survives a debugger that is gone when the watch stops', async () => {
    const cdp = new FakeDebugger();
    const watch = await watchNetwork(cdp, PAGE, new Sink());
    cdp.sendCommand = () => Promise.reject(new Error('detached'));
    await expect(watch.stop()).resolves.toBeUndefined();
  });
});

describe('network tap helpers', () => {
  it('knows the origin of a page and nothing for opaque ones', () => {
    expect(originOf('https://chat.example.com:8443/a?b#c')).toBe('https://chat.example.com:8443');
    expect(originOf('data:text/html,x')).toBeNull();
    expect(originOf(null)).toBeNull();
  });

  it('knows which mime types are worth a body', () => {
    for (const mime of ['text/event-stream', 'application/x-ndjson', 'application/json', 'Application/JSON; charset=utf-8']) expect(isBodyMime(mime)).toBe(true);
    for (const mime of ['text/html', 'image/png', '']) expect(isBodyMime(mime)).toBe(false);
  });

  it('caps a body at 2 MB of bytes and leaves a smaller one alone', () => {
    expect(capBody('short')).toBe('short');
    const long = 'x'.repeat(MAX_BODY_BYTES + 10);
    expect(Buffer.byteLength(capBody(long))).toBe(MAX_BODY_BYTES);
  });
});

describe('isolated runner network watch', () => {
  it('offers a watch when the contents have a debugger that emits messages, with the page URL', async () => {
    const cdp = new FakeDebugger();
    const sink = new Sink();
    const runner = createIsolatedRunner({
      executeJavaScriptInIsolatedWorld: () => Promise.resolve(''),
      isDestroyed: () => false,
      getURL: () => PAGE,
      debugger: cdp,
    });
    const watch = await runner.watchNetwork?.(sink);
    request(cdp, '1', 'https://chat.example.com/x');
    expect(sink.phases()).toEqual(['request']);
    await watch?.stop();
  });

  it('offers no watch for a debugger that cannot deliver messages, nor without a debugger', () => {
    const bare = { isAttached: () => true, attach: () => undefined, sendCommand: () => Promise.resolve({}) };
    const base = { executeJavaScriptInIsolatedWorld: () => Promise.resolve(''), isDestroyed: () => false };
    expect(createIsolatedRunner({ ...base, debugger: bare }).watchNetwork).toBeUndefined();
    expect(createIsolatedRunner(base).watchNetwork).toBeUndefined();
  });

  it('passes no origin when the contents cannot tell their URL', async () => {
    const cdp = new FakeDebugger();
    const sink = new Sink();
    const runner = createIsolatedRunner({ executeJavaScriptInIsolatedWorld: () => Promise.resolve(''), isDestroyed: () => false, debugger: cdp });
    await runner.watchNetwork?.(sink);
    expect(sink.events[0]?.name).toBe('net-skipped');
  });
});
