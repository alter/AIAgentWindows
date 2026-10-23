// capture-auto.spec.ts
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const fixtures = path.join(root, 'tests', 'fixtures', 'auto');
const electronBinary = createRequire(__filename)('electron') as string;
const AGENTS = {
  chatgpt: '11111111-1111-4111-8111-111111111111',
  grok: '22222222-2222-4222-8222-222222222222',
  deepseek: '33333333-3333-4333-8333-333333333333',
};

interface Site {
  server: Server;
  url: string;
  requests: string[];
}

function page(name: string): string {
  return readFileSync(path.join(fixtures, name), 'utf8');
}

function serve(home: string, conversation: string): Promise<Site> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    requests.push(`${request.method} ${url}`);
    response.setHeader('content-type', 'text/html; charset=utf-8');
    const isConversation = /^\/(c|chat)\/[\w-]+$|^\/a\/chat\/s\/[\w-]+$/.test(url.split('?')[0] ?? '');
    response.end(isConversation ? page(conversation) : page(home));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, requests });
    });
  });
}

interface Outcome {
  code: number | null;
  output: string;
  out: string;
  agentsBefore: string;
  agentsAfter: string;
  userData: string;
}

async function runAuto(sites: Record<'chatgpt' | 'grok' | 'deepseek', Site>): Promise<Outcome> {
  const base = mkdtempSync(path.join(tmpdir(), 'aiaw-auto-'));
  const userData = path.join(base, 'profile');
  mkdirSync(userData);
  const agents = (Object.keys(AGENTS) as Array<keyof typeof AGENTS>).map((kind) => ({ id: AGENTS[kind], kind, title: kind, createdAt: 1 }));
  const agentsBefore = JSON.stringify({ version: 1, agents });
  writeFileSync(path.join(userData, 'agents.json'), agentsBefore);
  const out = path.join(base, 'sites');
  const child = spawn(electronBinary, [root], {
    cwd: root,
    env: {
      ...process.env,
      AIAW_USER_DATA: userData,
      AIAW_CAPTURE_AUTO: out,
      AIAW_CAPTURE_AUTO_FAST: '1',
      AIAW_SITE_URL_CHATGPT: sites.chatgpt.url,
      AIAW_SITE_URL_GROK: sites.grok.url,
      AIAW_SITE_URL_DEEPSEEK: sites.deepseek.url,
    },
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  return { code, output, out, agentsBefore, agentsAfter: readFileSync(path.join(userData, 'agents.json'), 'utf8'), userData };
}

test('unattended capture saves the first existing chat of each site and sends nothing', async () => {
  test.setTimeout(90_000);
  const sites = {
    chatgpt: await serve('chatgpt-home.html', 'conversation-late.html'),
    grok: await serve('grok-home.html', 'conversation.html'),
    deepseek: await serve('deepseek-home.html', 'conversation-styled.html'),
  };
  try {
    const result = await runAuto(sites);
    expect(result.output).toContain('chatgpt: saved');
    expect(result.output).toContain('grok: saved');
    expect(result.output).toContain('deepseek: saved');
    expect(result.code).toBe(0);
    expect(sites.chatgpt.requests).toEqual(['GET /', 'GET /c/first-chat-1']);
    expect(sites.grok.requests).toEqual(['GET /', 'GET /chat/grok-first-1']);
    expect(sites.deepseek.requests).toEqual(['GET /', 'GET /a/chat/s/ds-first-1']);
    const chatgpt = readFileSync(path.join(result.out, 'chatgpt.html'), 'utf8');
    expect(chatgpt).toContain('data-message-author-role="assistant"');
    for (const kind of ['chatgpt', 'grok', 'deepseek']) {
      expect(readFileSync(path.join(result.out, `${kind}.html`), 'utf8')).not.toContain('must not be saved');
    }
    expect(readFileSync(path.join(result.out, 'deepseek.html'), 'utf8')).toContain('ds-markdown-x');
    for (const kind of ['chatgpt', 'grok', 'deepseek']) {
      const diagnostic = JSON.parse(readFileSync(path.join(result.out, `${kind}.diagnostic.json`), 'utf8')) as { viewport: { width: number; height: number }; wait: { messageListSeen: boolean; timedOut: boolean } };
      expect(diagnostic.viewport.width, kind).toBeGreaterThanOrEqual(1280);
      expect(diagnostic.viewport.height, kind).toBeGreaterThanOrEqual(800);
      expect(diagnostic.wait, kind).toMatchObject({ messageListSeen: true, timedOut: false });
    }
    expect(result.agentsAfter).toBe(result.agentsBefore);
    const partitions = readdirSync(path.join(result.userData, 'Partitions')).sort();
    expect(partitions).toEqual(Object.values(AGENTS).sort());
  } finally {
    for (const site of Object.values(sites)) site.server.close();
  }
});

test('unattended capture reports a signed-out site and a site without a chat, saving nothing for them', async () => {
  test.setTimeout(90_000);
  const sites = {
    chatgpt: await serve('chatgpt-home.html', 'conversation.html'),
    grok: await serve('signed-out.html', 'conversation.html'),
    deepseek: await serve('empty-home.html', 'conversation.html'),
  };
  try {
    const result = await runAuto(sites);
    expect(result.output).toContain('chatgpt: saved');
    expect(result.output).toContain('grok: not signed in');
    expect(result.output).toContain('deepseek: no existing chat');
    expect(result.code).toBe(1);
    expect(existsSync(path.join(result.out, 'grok.html'))).toBe(false);
    expect(existsSync(path.join(result.out, 'deepseek.html'))).toBe(false);
    expect(sites.grok.requests).toEqual(['GET /']);
    expect(sites.deepseek.requests).toEqual(['GET /']);
  } finally {
    for (const site of Object.values(sites)) site.server.close();
  }
});
