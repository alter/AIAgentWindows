// generic-scripts.ts
const PRELUDE = String.raw`
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SVG', 'CANVAS', 'IFRAME']);
const STOP_NAME = /(^|[^a-z])(stop|cancel)([^a-z]|$)|останов|отмен/i;
const SEND_NAME = /send|submit|отправ/i;
const OTHER_NAME = /attach|upload|file|photo|image|mic|voice|dictat|record|search|think|reason|tool|model|menu|more|copy|share|прикреп|добав|голос|поиск/i;
const TAIL_CHARS = 200;

function collapse(value) {
  return value.replace(/\s+/g, ' ');
}

function hidden(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
}

function hasLayout() {
  return document.documentElement.getBoundingClientRect().width > 0;
}

function visible(el) {
  if (hidden(el)) return false;
  if (!hasLayout()) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isEditable(el) {
  if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
  const flag = el.getAttribute('contenteditable');
  return flag === '' || flag === 'true' || flag === 'plaintext-only';
}

function findComposer() {
  const found = Array.from(document.querySelectorAll('textarea, [contenteditable], [role="textbox"]'))
    .filter((el) => isEditable(el) && visible(el));
  let best = null;
  let bestBottom = -Infinity;
  for (const el of found) {
    const bottom = hasLayout() ? el.getBoundingClientRect().bottom : 0;
    if (bottom >= bestBottom) {
      best = el;
      bestBottom = bottom;
    }
  }
  return best;
}

function collect(root, skip) {
  let out = '';
  const breakLine = () => {
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };
  const walk = (node, pre) => {
    if (node.nodeType === 3) {
      if (pre) {
        out += node.data;
        return;
      }
      const text = collapse(node.data);
      out += out === '' || out.endsWith('\n') || out.endsWith(' ') ? text.replace(/^ /, '') : text;
      return;
    }
    if (node.nodeType !== 1 || node === skip) return;
    if (SKIP_TAGS.has(node.tagName.toUpperCase()) || node.hidden || node.getAttribute('aria-hidden') === 'true') return;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    const block = !String(style.display).startsWith('inline');
    if (block) breakLine();
    const keep = String(style.whiteSpace).startsWith('pre');
    for (const child of Array.from(node.childNodes)) walk(child, keep);
    if (block) breakLine();
  };
  walk(root, false);
  return out;
}

function conversationRoot() {
  const main = document.querySelector('main, [role="main"]');
  return main && !hidden(main) ? main : document.body;
}

function conversationText(composer) {
  return collect(conversationRoot(), composer);
}

function fieldText(el) {
  return 'value' in el ? el.value : collect(el, null);
}

function accessibleName(el) {
  const parts = [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent];
  const image = el.querySelector('img[alt]');
  if (image) parts.push(image.getAttribute('alt'));
  return parts.filter((part) => part).join(' ').trim();
}

function pressable() {
  return Array.from(document.querySelectorAll('button, [role="button"]'));
}

function disabledButton(el) {
  return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
}

function stopShown() {
  return pressable().some((el) => STOP_NAME.test(accessibleName(el)) && !hidden(el));
}

function chooseSendButton(composer) {
  let scope = composer.parentElement;
  for (let depth = 0; scope && depth < 6; depth += 1) {
    const candidates = Array.from(scope.querySelectorAll('button, [role="button"]')).filter((el) => {
      const name = accessibleName(el);
      return !hidden(el) && !STOP_NAME.test(name) && !OTHER_NAME.test(name);
    });
    if (candidates.length > 0) {
      const enabled = candidates.filter((el) => !disabledButton(el));
      if (enabled.length === 0) return null;
      return enabled.find((el) => el.type === 'submit' || SEND_NAME.test(accessibleName(el))) || enabled[enabled.length - 1];
    }
    scope = scope.parentElement;
  }
  return null;
}

function normalized(text) {
  const chars = [];
  const starts = [];
  let space = true;
  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index])) {
      if (space) continue;
      chars.push(' ');
      starts.push(index);
      space = true;
    } else {
      chars.push(text[index]);
      starts.push(index);
      space = false;
    }
  }
  while (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop();
    starts.pop();
  }
  return { text: chars.join(''), starts };
}
`;

function wrap(body: string): string {
  return `(() => {
  try {${PRELUDE}
${body}
  } catch (error) {
    return JSON.stringify({ ok: false, error: 'page-error', detail: String(error && error.message || error) });
  }
})()`;
}

export function genericInsertScript(text: string): string {
  return wrap(`
    const composer = findComposer();
    if (!composer) return JSON.stringify({ ok: false, error: 'input-missing' });
    const text = ${JSON.stringify(text)};
    composer.focus();
    if ('value' in composer) {
      const proto = composer.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(composer, text);
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      return JSON.stringify({ ok: true, value: composer.value === text });
    }
    let done = false;
    if (typeof document.execCommand === 'function') {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        done = document.execCommand('insertText', false, text) === true;
      } catch (error) {
        done = false;
      }
    }
    if (!done || collapse(fieldText(composer)).trim() !== collapse(text).trim()) {
      const rows = text.split('\\n').map((line) => {
        const row = document.createElement('p');
        row.textContent = line;
        return row;
      });
      composer.replaceChildren(...rows);
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
    return JSON.stringify({ ok: true, value: collapse(fieldText(composer)).trim() === collapse(text).trim() });`);
}

export function genericEnterScript(): string {
  return wrap(`
    const composer = findComposer();
    if (!composer) return JSON.stringify({ ok: false, error: 'input-missing' });
    const baseline = conversationText(composer).length;
    composer.focus();
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    composer.dispatchEvent(new KeyboardEvent('keydown', init));
    composer.dispatchEvent(new KeyboardEvent('keyup', init));
    return JSON.stringify({ ok: true, value: baseline });`);
}

export function genericSendButtonScript(): string {
  return wrap(`
    const composer = findComposer();
    if (!composer || collapse(fieldText(composer)).trim() === '') return JSON.stringify({ ok: true, value: 'sent' });
    const button = chooseSendButton(composer);
    if (!button) return JSON.stringify({ ok: false, error: 'submit-unavailable' });
    button.click();
    return JSON.stringify({ ok: true, value: 'clicked' });`);
}

export function genericStateScript(prompt: string, baseline: number): string {
  return wrap(`
    const composer = findComposer();
    const text = conversationText(composer);
    const wanted = normalized(${JSON.stringify(prompt)}).text;
    const key = wanted.slice(-TAIL_CHARS);
    const seen = normalized(text);
    let reply = null;
    if (key !== '') {
      let at = seen.text.indexOf(key);
      while (at !== -1 && seen.starts[at] < ${Math.max(0, Math.floor(baseline))}) at = seen.text.indexOf(key, at + 1);
      if (at !== -1) {
        const end = seen.starts[at + key.length - 1] + 1;
        const after = text.slice(end).trim();
        reply = after === '' ? null : after;
      }
    }
    return JSON.stringify({ ok: true, value: { stop: stopShown(), reply } });`);
}
