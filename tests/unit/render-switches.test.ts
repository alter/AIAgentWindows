// render-switches.test.ts
import { describe, expect, it } from 'vitest';
import { applyRenderSwitches, RENDER_SWITCHES } from '../../src/shared/render-switches';

describe('render switches', () => {
  it('appends both switches that keep hidden and covered views rendering, each once', () => {
    const appended: string[] = [];
    applyRenderSwitches({ appendSwitch: (name) => appended.push(name) });
    expect(appended.sort()).toEqual(['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding']);
    expect([...RENDER_SWITCHES].sort()).toEqual(appended);
  });
});
