// start-screen.ts
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ESCAPES = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`, 'g');

export type StartScreenKind = 'update' | 'trust' | 'enter';

export interface StartScreenIssue {
  kind: StartScreenKind;
  reason: string;
}

const BLOCKING: ReadonlyArray<{ marker: string; kind: StartScreenKind; reason: string }> = [
  { marker: 'updatenow', kind: 'update', reason: 'an update dialog is open' },
  { marker: 'skipuntilnextversion', kind: 'update', reason: 'an update dialog is open' },
  { marker: 'trustthisfolder', kind: 'trust', reason: 'a folder trust dialog is open' },
  { marker: 'folderaccess', kind: 'trust', reason: 'a folder trust dialog is open' },
  { marker: 'isthisaprojectyoucreatedoryoutrust', kind: 'trust', reason: 'a folder trust dialog is open' },
  { marker: 'yes,itrustthisfolder', kind: 'trust', reason: 'a folder trust dialog is open' },
  { marker: 'entercontinue', kind: 'enter', reason: 'a start-up dialog is waiting for Enter' },
  { marker: 'entertoconfirm', kind: 'enter', reason: 'a start-up dialog is waiting for Enter' },
];

export function startScreenIssue(output: string): StartScreenIssue | null {
  const compact = output.replace(ESCAPES, '').replace(/\s+/g, '').toLowerCase();
  const hits = BLOCKING.filter(({ marker }) => compact.includes(marker));
  const first = hits.find((hit) => hit.kind === 'update') ?? hits[0];
  return first === undefined ? null : { kind: first.kind, reason: `${first.reason}; nothing was typed into it` };
}

export function blockingStartScreen(output: string): string | null {
  return startScreenIssue(output)?.reason ?? null;
}
