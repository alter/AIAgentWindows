import { _electron as electron } from '@playwright/test';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const out = {};
for (const colorScheme of ['dark', 'light', null, undefined]) {
  const opts = { args: [path.join(here, 'main.cjs')] };
  if (colorScheme !== undefined) opts.colorScheme = colorScheme;
  const app = await electron.launch(opts);
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.term);
  const q = () => page.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, bodyBg: getComputedStyle(document.body).backgroundColor }));
  const first = await q();
  await page.emulateMedia({ colorScheme: colorScheme === 'dark' ? 'light' : 'dark' });
  out['launch colorScheme=' + String(colorScheme)] = { atLaunch: first, afterEmulateMediaOpposite: await q() };
  await app.close();
}
console.log(JSON.stringify(out, null, 1));
