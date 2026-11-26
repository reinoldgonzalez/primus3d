// Small DOM helpers: modal dialogs, sheet, toast.
export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
// the tap that opened a dialog also produces a click a moment later (iOS/Android) — don't let it hit the dialog
let modalOpenedAt = 0; let guarded = false;
function guardModal(root: HTMLElement) { if (guarded) return; guarded = true; let downAt = 0;
  root.addEventListener('pointerdown', () => { downAt = performance.now(); }, true);
  root.addEventListener('click', e => { if (e.isTrusted && e.detail > 0 && downAt < modalOpenedAt && performance.now() - modalOpenedAt < 1000) { e.stopPropagation(); e.preventDefault(); } }, true); }
export function h(tag: string, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k === 'style') el.setAttribute('style', v); else (el as any)[k] = v === true ? true : v, el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c as any);
  return el;
}
let toastT: any;
export function toast(msg: string, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

export function modal(title: string, body: HTMLElement | string, buttons: { label: string; primary?: boolean; danger?: boolean; value?: any }[] = [{ label: 'OK', primary: true, value: true }], opts: { wide?: boolean; onOpen?: (el: HTMLElement) => void } = {}): Promise<any> {
  return new Promise(res => {
    const root = $('#modal'); root.innerHTML = ''; guardModal(root);
    const close = (v: any) => { root.classList.remove('open'); root.innerHTML = ''; res(v); };
    const box = h('div', { class: 'mbox' + (opts.wide ? ' wide' : '') },
      h('div', { class: 'mhead' }, h('h2', {}, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: () => close(null) }, '✕')),
      typeof body === 'string' ? h('div', { class: 'mbody', html: body }) : h('div', { class: 'mbody' }, body),
      buttons.length ? h('div', { class: 'mfoot' }, ...buttons.map(b => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => close(b.value ?? b.label) }, b.label))) : null);
    modalOpenedAt = performance.now();
    root.append(h('div', { class: 'mback', onclick: () => close(null) }), box);
root.classList.add('open');
    (root as any)._close = close; opts.onOpen?.(box);
  });
}
export function closeModal(v: any = null) { const r: any = $('#modal'); r._close?.(v); }

export async function prompt(title: string, label: string, value = '', hint = ''): Promise<string | null> {
  const inp = h('input', { class: 'inp big', value, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const body = h('div', {}, h('label', { class: 'lbl' }, label), inp, hint ? h('p', { class: 'muted' }, hint) : null);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') closeModal(inp.value); });
  const r = await modal(title, body, [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: '__ok' }], { onOpen: () => setTimeout(() => { inp.focus(); inp.select(); }, 60) });
  if (r === '__ok') return inp.value; return typeof r === 'string' ? r : null;
}
export function pickFile(accept: string, capture?: string): Promise<File | null> {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept; if (capture) i.setAttribute('capture', capture);
    i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { res(i.files?.[0] || null); i.remove(); };
    i.click();
  });
}
/**
 * A button that opens the file picker DIRECTLY from the user's tap (a <label> wrapping a real file input).
 * iOS Safari blocks pickers opened later from code (after a modal closes / setTimeout), so always use this in menus.
 */
export function fileBtn(cls: string, accept: string, kids: (Node | string)[], onFiles: (f: File[]) => void, opts: { multiple?: boolean; capture?: string; id?: string } = {}) {
  const inp = h('input', { type: 'file', accept: accept || null, class: 'fileinp', multiple: opts.multiple || null, capture: opts.capture || null }) as HTMLInputElement;
  const lab = h('label', { class: cls, id: opts.id || null, role: 'button', tabindex: '0' }, inp, ...kids);
  inp.addEventListener('change', () => { const fs = [...(inp.files || [])]; inp.value = ''; if (fs.length) { closeModal(); onFiles(fs); } });
  lab.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  return lab;
}
