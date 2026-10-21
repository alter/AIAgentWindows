// app-info.test.ts
import { describe, expect, it } from 'vitest';
import { APP_NAME, windowTitle } from '../../src/shared/app-info';

describe('windowTitle', () => {
  it('returns the app name alone without an agent', () => {
    expect(windowTitle()).toBe(APP_NAME);
  });

  it('puts the agent title in front of the app name', () => {
    expect(windowTitle('Claude Code')).toBe(`Claude Code - ${APP_NAME}`);
  });
});
