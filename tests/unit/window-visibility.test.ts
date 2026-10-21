// window-visibility.test.ts
import { describe, expect, it } from 'vitest';
import { windowsVisible } from '../../src/shared/window-visibility';

describe('windowsVisible', () => {
  it('shows windows in production, where no test userData is set', () => {
    expect(windowsVisible({})).toBe(true);
    expect(windowsVisible({ AIAW_USER_DATA: '' })).toBe(true);
  });

  it('hides windows in test mode', () => {
    expect(windowsVisible({ AIAW_USER_DATA: '/tmp/ud' })).toBe(false);
  });

  it('shows windows in test mode only when AIAW_SHOW_WINDOWS is 1', () => {
    expect(windowsVisible({ AIAW_USER_DATA: '/tmp/ud', AIAW_SHOW_WINDOWS: '1' })).toBe(true);
    expect(windowsVisible({ AIAW_USER_DATA: '/tmp/ud', AIAW_SHOW_WINDOWS: '0' })).toBe(false);
    expect(windowsVisible({ AIAW_USER_DATA: '/tmp/ud', AIAW_SHOW_WINDOWS: 'true' })).toBe(false);
  });
});
