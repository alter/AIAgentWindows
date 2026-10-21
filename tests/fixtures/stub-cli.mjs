#!/usr/bin/env node
// stub-cli.mjs
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const childSession = process.env.CLAUDE_CODE_CHILD_SESSION === undefined ? 'unset' : 'set';

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write('\x1b[?2004h');
process.stdout.write(`STUB-CLI BANNER argv=${JSON.stringify(process.argv.slice(2))} CLAUDE_CODE_CHILD_SESSION=${childSession}\r\n`);

let line = '';
let inPaste = false;

function feed(chunk) {
  let rest = chunk;
  while (rest.length > 0) {
    if (rest.startsWith(PASTE_START)) {
      inPaste = true;
      rest = rest.slice(PASTE_START.length);
    } else if (rest.startsWith(PASTE_END)) {
      inPaste = false;
      rest = rest.slice(PASTE_END.length);
    } else {
      const char = rest[0];
      rest = rest.slice(1);
      if (char === '\r' && !inPaste) {
        process.stdout.write(`\r\nSUBMITTED:${line}\r\n`);
        if (line === '/exit') process.exit(0);
        line = '';
      } else {
        line += char;
        process.stdout.write(char);
      }
    }
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', feed);
process.stdin.resume();
