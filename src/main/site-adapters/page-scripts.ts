// page-scripts.ts
const READ_FIELD = `
function readField(el) {
  if ('value' in el && el.tagName !== 'BUTTON') return el.value;
  const kids = Array.from(el.children);
  return kids.length === 0 ? el.textContent : kids.map((kid) => kid.textContent).join('\\n');
}`;

function wrap(body: string): string {
  return `(() => {
  try {
${body}
  } catch (error) {
    return JSON.stringify({ ok: false, error: 'page-error', detail: String(error && error.message || error) });
  }
})()`;
}

function lit(value: string): string {
  return JSON.stringify(value);
}

export function insertTextScript(selector: string, text: string): string {
  return wrap(`${READ_FIELD}
    const el = document.querySelector(${lit(selector)});
    if (!el) return JSON.stringify({ ok: false, error: 'input-missing' });
    const text = ${lit(text)};
    el.focus();
    if ('value' in el) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
    } else {
      const lines = text.split('\\n').map((line) => {
        const row = document.createElement('p');
        row.textContent = line;
        return row;
      });
      el.replaceChildren(...lines);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return JSON.stringify({ ok: true, value: readField(el) === text });`);
}

export function submitScript(inputSelector: string, submitSelector: string | undefined): string {
  return wrap(`
    const button = ${submitSelector === undefined ? 'null' : `document.querySelector(${lit(submitSelector)})`};
    if (button) {
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
        return JSON.stringify({ ok: false, error: 'submit-unavailable' });
      }
      button.click();
      return JSON.stringify({ ok: true });
    }
    const el = document.querySelector(${lit(inputSelector)});
    if (!el) return JSON.stringify({ ok: false, error: 'input-missing' });
    el.focus();
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    return JSON.stringify({ ok: true });`);
}

export function isGeneratingScript(stopSelector: string | undefined): string {
  if (stopSelector === undefined) return wrap(`return JSON.stringify({ ok: true, value: false });`);
  return wrap(`
    const stop = document.querySelector(${lit(stopSelector)});
    const shown = stop !== null && !stop.hidden && stop.getAttribute('aria-hidden') !== 'true';
    return JSON.stringify({ ok: true, value: shown });`);
}

export function lastReplyScript(repliesSelector: string): string {
  return wrap(`
    const all = document.querySelectorAll(${lit(repliesSelector)});
    if (all.length === 0) return JSON.stringify({ ok: true, value: null });
    const last = all[all.length - 1];
    const text = typeof last.innerText === 'string' ? last.innerText : last.textContent;
    return JSON.stringify({ ok: true, value: text });`);
}
