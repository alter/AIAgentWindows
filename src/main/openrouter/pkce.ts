// pkce.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

const RANDOM_BYTES = 32;

export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createPkce(): Pkce {
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  return { verifier, challenge: challengeOf(verifier), state: randomBytes(RANDOM_BYTES).toString('base64url') };
}

export function statesMatch(expected: string, received: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(received, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
