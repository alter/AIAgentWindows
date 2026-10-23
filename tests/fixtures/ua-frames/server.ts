// server.ts
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const PARENT = readFileSync(path.join(__dirname, 'parent.html'), 'utf8');
const CHILD = readFileSync(path.join(__dirname, 'child.html'), 'utf8');

export interface UaFramesServer {
  server: Server;
  topUrl: string;
  childUrl: string;
  probes: Map<string, string[]>;
}

export function startUaFramesServer(): Promise<UaFramesServer> {
  const probes = new Map<string, string[]>();
  let childUrl = '';
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    const probe = /^\/probe\/(\w+)$/.exec(url)?.[1];
    if (probe !== undefined) {
      probes.set(probe, [...(probes.get(probe) ?? []), String(request.headers['user-agent'])]);
      response.end('ok');
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(url === '/child' ? CHILD : PARENT.replace('__CHILD_URL__', childUrl));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      childUrl = `http://127.0.0.1:${port}/child`;
      resolve({ server, topUrl: `http://localhost:${port}/`, childUrl, probes });
    });
  });
}
