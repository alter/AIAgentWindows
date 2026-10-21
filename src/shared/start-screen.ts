// start-screen.ts
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ESCAPES = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`, 'g');

const BLOCKING: ReadonlyArray<{ marker: string; reason: string }> = [
  { marker: 'updatenow', reason: 'an update dialog is open' },
  { marker: 'skipuntilnextversion', reason: 'an update dialog is open' },
  { marker: 'trustthisfolder', reason: 'a folder trust dialog is open' },
  { marker: 'folderaccess', reason: 'a folder trust dialog is open' },
  { marker: 'isthisaprojectyoucreatedoryoutrust', reason: 'a folder trust dialog is open' },
  { marker: 'yes,itrustthisfolder', reason: 'a folder trust dialog is open' },
  { marker: 'entercontinue', reason: 'a start-up dialog is waiting for Enter' },
  { marker: 'entertoconfirm', reason: 'a start-up dialog is waiting for Enter' },
];

export function blockingStartScreen(output: string): string | null {
  const compact = output.replace(ESCAPES, '').replace(/\s+/g, '').toLowerCase();
  for (const { marker, reason } of BLOCKING) {
    if (compact.includes(marker)) return `${reason}; nothing was typed into it`;
  }
  return null;
}
