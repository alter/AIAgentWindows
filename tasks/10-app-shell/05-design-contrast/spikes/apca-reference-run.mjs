// usage: node apca-reference-run.mjs <apca-w3-0.1.9 src/apca-w3.js with the colorparsley import line replaced by `const colorParsley=()=>0;`>
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { APCAcontrast, sRGBtoY } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const h = (s) => { s = s.replace('#', ''); if (s.length === 3) s = [...s].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const pairs = [['#888', '#fff'], ['#fff', '#888'], ['#000', '#aaa'], ['#aaa', '#000'], ['#123', '#def'], ['#def', '#123'], ['#123', '#444'], ['#444', '#123'], ['#000', '#fff'], ['#fff', '#000']];
console.log('text bg Lc');
for (const [t, b] of pairs) console.log(t, b, APCAcontrast(sRGBtoY(h(t)), sRGBtoY(h(b))));
