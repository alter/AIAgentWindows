import { _electron as electron } from '@playwright/test';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const app = await electron.launch({ args: [path.join(here, 'main.cjs')] });
const page = await app.firstWindow();
await page.waitForFunction(() => !!window.term);
const out = {};
const state = async (label) => {
  const s = await page.evaluate(() => ({
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    light: matchMedia('(prefers-color-scheme: light)').matches,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  const n = await app.evaluate(({ nativeTheme }) => ({ themeSource: nativeTheme.themeSource, shouldUseDarkColors: nativeTheme.shouldUseDarkColors }));
  out[label] = { ...s, ...n };
};
await state('A default (system)');
await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
await state('B themeSource=light');
await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
await state('C themeSource=dark');
await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
await state('D themeSource=system');
// change event
await page.evaluate(() => { window.__changes = []; matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => window.__changes.push(e.matches)); });
await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
await page.waitForTimeout(300);
out['E change events (light query) after light then dark'] = await page.evaluate(() => window.__changes);
await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
// emulateMedia route
await state('F before emulateMedia');
let emu = {};
for (const scheme of ['light', 'dark']) {
  try {
    await page.emulateMedia({ colorScheme: scheme });
    emu[scheme] = await page.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, bodyBg: getComputedStyle(document.body).backgroundColor }));
  } catch (e) { emu[scheme] = 'ERROR ' + String(e).split('\n')[0]; }
}
out['G emulateMedia'] = emu;
await page.emulateMedia({ colorScheme: null });
await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
await page.waitForTimeout(300);
await state('G2 after emulateMedia(null) and themeSource=dark');
await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
await page.emulateMedia({ colorScheme: 'light' });
await page.emulateMedia({ colorScheme: 'dark' });
await page.emulateMedia({ colorScheme: 'light' });
out['G3 emulateMedia dark->light roundtrip'] = await page.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, bodyBg: getComputedStyle(document.body).backgroundColor }));
// xterm live theme
const bgOf = () => page.evaluate(() => {
  const sc = document.querySelector('.xterm-scrollable-element');
  const rowsRule = [...document.querySelectorAll('style')].map((st) => st.textContent).join('\n').match(/\.xterm-rows \{[^}]*\}/);
  return { scrollableElementBackground: getComputedStyle(sc).backgroundColor, rowsRule: rowsRule ? rowsRule[0] : null, optionsThemeBackground: term.options.theme.background };
});
out['H xterm initial theme'] = await bgOf();
await page.evaluate(() => { term.options.theme = { background: '#ffffff', foreground: '#000000' }; });
await page.waitForTimeout(200);
out['I xterm after options.theme reassignment'] = await bgOf();
await page.evaluate(() => { term.options.theme.background = '#00ff00'; });
await page.waitForTimeout(200);
out['J xterm after mutating options.theme.background in place'] = await bgOf();
// minimumContrastRatio
await page.evaluate(() => { term.options.theme = { background: '#000000', foreground: '#ffffff' }; term.options.minimumContrastRatio = 1; term.write('\x1b[38;2;30;30;30mDARKTEXT\x1b[0m'); });
await page.waitForTimeout(300);
const color = () => page.evaluate(() => { const spans = [...document.querySelectorAll('.xterm-rows span')]; const s = spans.find(x => x.textContent.includes('DARKTEXT')); return s ? { cls: s.className, style: s.getAttribute('style') } : null; });
out['K ratio 1, rgb(30,30,30) on black'] = await color();
await page.evaluate(() => { term.options.minimumContrastRatio = 4.5; });
await page.waitForTimeout(300);
out['L ratio 4.5 set after the text was written'] = await color();
out['M minimumContrastRatio read back after setting 99 and 0.2'] = await page.evaluate(() => { term.options.minimumContrastRatio = 99; const a = term.options.minimumContrastRatio; term.options.minimumContrastRatio = 0.2; return [a, term.options.minimumContrastRatio]; });
out.versions = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }));
console.log(JSON.stringify(out, null, 2));
await app.close();
