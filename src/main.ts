import './style.css';
import { store, newProject, uid, Pt, Wall, Room, Obj, Project, dist, wallLen, wallAngle, wallDir, polyArea, polyPerimeter, roomOutline, FLOORS, findSel, migrate, ScanRef } from './model';
import { PlanView, Tool, findEnclosure } from './plan';
import { View3D } from './view3d';
import { PhotoView, PHOTO_MATS, PHOTO_SPRITES } from './photo';
import { fmtLen, fmtArea, parseLen, setUnits, getUnits, fmtAngle, FT, IN } from './units';
import { saveProject, listProjects, loadProject, deleteProject, lastProjectId, exportProjectJSON, importProjectJSON, requestPersist } from './storage';
import { blueprintToImageBlob, scanFormat, loadScanObject, parseRoomPlanJSON, detectArchFromScene, applyArch } from './importers';
import { exportPNG, exportPDF, shareOrDownload, renderPlanCanvas } from './export';
import { exportDXF } from './dxf';
import { CATALOG, CATEGORIES, OPENINGS, CAT_BY_KEY, PAINTS, FINISHES } from './catalog';
import { takeoff, money } from './takeoff';
import { TEMPLATES } from './templates';
import { $, h, toast, modal, prompt, pickFile, closeModal } from './ui';

type View = 'plan' | '3d' | 'walk' | 'photo';
let view: View = 'plan'; let split = false;

// ---------- DOM ----------
const app = $('#app');
const plan = new PlanView($('#plan') as HTMLCanvasElement, {
  askDistance: async (m) => { const s = await prompt('Set real length', `You marked ${fmtLen(m)} on the image. What is the real length?`, '', 'Examples: 12\' 6"  ·  12 6  ·  150"  ·  3.5m'); if (s == null) return null; const v = parseLen(s); if (!v) { toast('Could not read that length'); return null; } return v; },
  onDraftChange: () => { updateHint(); updateDraftBar(); },
  toast,
});
let underlay: any = null;
const v3 = new View3D($('#v3d'), {
  askDistance: async (m) => { const s = await prompt('Real distance', `Those two points are ${fmtLen(m)} apart in the scan. Real distance?`, ''); if (s == null) return null; return parseLen(s); },
  toast, onScanUnderlay: (u) => { underlay = u; plan.scanUnderlay = u; plan.redraw(); },
});
const photo = new PhotoView($('#photo') as HTMLCanvasElement);
photo.onChange = () => renderDock();

// ---------- views ----------
function setView(v: View) {
  view = v; app.dataset.view = v; app.classList.toggle('split', split && (v === 'plan' || v === '3d'));
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', (b as HTMLElement).dataset.v === v));
  const show3d = v === '3d' || v === 'walk' || (split && v === 'plan');
  plan.setVisible(v === 'plan' || (split && v === '3d')); v3.setActive(show3d);
  if (v === 'walk') v3.setMode('walk'); else if (v3.mode === 'walk') v3.setMode('orbit');
  if (v === 'photo') { photo.resize(); if (!store.p.photos.length) setTimeout(() => newPhotoDesign(), 50); else if (!photo.design) photo.open(store.p.photos[store.p.photos.length - 1]); }
  if (v !== 'plan') plan.setTool('select');
  renderDock(); updateHint(); renderCtx();
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView((b as HTMLElement).dataset.v as View)));
$('#splitBtn').addEventListener('click', () => { split = !split; $('#splitBtn').classList.toggle('on', split); setView(view === 'walk' || view === 'photo' ? 'plan' : view); setTimeout(() => { plan.resize(); v3.resize(); }, 50); });

// ---------- dock (tools) ----------
interface DockBtn { id: string; icon: string; label: string; on?: boolean; act: () => void }
function renderDock() {
  const d = $('#dock'); d.innerHTML = ''; let btns: DockBtn[] = [];
  if (view === 'plan') btns = [
    { id: 'select', icon: '👆', label: 'Select', on: plan.tool === 'select', act: () => setTool('select') },
    { id: 'quick', icon: '⬛', label: 'Quick room', act: () => quickRoom() },
    { id: 'wall', icon: '📏', label: 'Draw walls', on: plan.tool === 'wall', act: () => setTool('wall') },
    { id: 'room', icon: '🔷', label: 'Floor / area', on: plan.tool === 'room', act: () => areaMenu() },
    { id: 'door', icon: '🚪', label: 'Door/window', on: ['door', 'window', 'slider', 'opening'].includes(plan.tool), act: () => openCatalog('Doors') },
    { id: 'item', icon: '🛋️', label: 'Add item', act: () => openCatalog() },
    { id: 'measure', icon: '📐', label: 'Measure', on: plan.tool === 'measure', act: () => setTool('measure') },
  ];
  else if (view === '3d') btns = [
    { id: 'sel3', icon: '👆', label: 'Select', on: v3.tool === 'select', act: () => { v3.setTool('select'); renderDock(); updateHint(); } },
    { id: 'item', icon: '🛋️', label: 'Add item', act: () => openCatalog() },
    { id: 'meas3', icon: '📐', label: 'Measure', on: v3.tool === 'measure', act: () => { v3.setTool('measure'); renderDock(); updateHint(); } },
    { id: 'top', icon: '⬇️', label: 'Top view', act: () => topView() },
    { id: 'reset', icon: '🎯', label: 'Reset view', act: () => v3.fitView() },
    { id: 'cut', icon: '✂️', label: 'Low walls', on: v3.lowWalls, act: () => { v3.lowWalls = !v3.lowWalls; store.emit('change'); renderDock(); } },
    { id: 'ceil', icon: '🏠', label: 'Ceilings', on: v3.showCeilings, act: () => { v3.showCeilings = !v3.showCeilings; store.emit('change'); renderDock(); } },
  ];
  else if (view === 'walk') btns = [
    { id: 'eye', icon: '🚶', label: 'Start in a room', act: () => { const r = store.p.rooms.find(r => !r.outdoor) || store.p.rooms[0]; if (r) { const c = centroid(roomOutline(r)); v3.camera.position.set(c.x, 1.65, c.y); } } },
    { id: 'orbit', icon: '🔄', label: 'Back to 3D', act: () => setView('3d') },
  ];
  else btns = [
    { id: 'pnew', icon: '📷', label: 'New photo', act: () => newPhotoDesign() },
    { id: 'psel', icon: '👆', label: 'Select', on: photo.tool === 'select', act: () => { photo.tool = 'select'; photo.draft = []; renderDock(); updateHint(); photo.draw(); } },
    { id: 'pplant', icon: '🌴', label: 'Plants & items', on: photo.tool === 'sprite', act: () => photoSpritePicker() },
    { id: 'parea', icon: '🟫', label: 'Material area', on: photo.tool === 'area', act: () => photoMatPicker() },
    { id: 'pcurb', icon: '〰️', label: 'Curbing', on: photo.tool === 'curb', act: () => { photo.tool = 'curb'; photo.draft = []; renderDock(); updateHint(); } },
    { id: 'phz', icon: '🌅', label: 'Horizon', on: photo.tool === 'horizon', act: () => { photo.tool = photo.tool === 'horizon' ? 'select' : 'horizon'; renderDock(); updateHint(); photo.draw(); } },
    { id: 'pbefore', icon: '👁️', label: 'Hold: before', act: () => {} },
  ];
  for (const b of btns) {
    const el = h('button', { class: 'tool' + (b.on ? ' on' : ''), id: 'tool-' + b.id, onclick: b.act }, h('span', { class: 'ti' }, b.icon), h('span', { class: 'tl' }, b.label));
    if (b.id === 'pbefore') { const on = () => { photo.before = true; photo.draw(); }, off = () => { photo.before = false; photo.draw(); }; el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off); }
    d.append(el);
  }
  if (view === 'photo' && photo.selId) d.append(h('button', { class: 'tool', onclick: () => photo.scaleSel(1.2) }, h('span', { class: 'ti' }, '➕'), h('span', { class: 'tl' }, 'Bigger')), h('button', { class: 'tool', onclick: () => photo.scaleSel(1 / 1.2) }, h('span', { class: 'ti' }, '➖'), h('span', { class: 'tl' }, 'Smaller')), h('button', { class: 'tool', onclick: () => photo.flipSel() }, h('span', { class: 'ti' }, '↔️'), h('span', { class: 'tl' }, 'Flip')), h('button', { class: 'tool danger', onclick: () => photo.deleteSel() }, h('span', { class: 'ti' }, '🗑️'), h('span', { class: 'tl' }, 'Delete')));
  if (view === 'photo' && (photo.tool === 'area' || photo.tool === 'curb') && photo.draft.length) d.append(h('button', { class: 'tool primary', onclick: () => { photo.finishDraft(); renderDock(); updateHint(); } }, h('span', { class: 'ti' }, '✅'), h('span', { class: 'tl' }, 'Done')));
}
function setTool(t: Tool) { if (view !== 'plan') setView('plan'); plan.setTool(t); renderDock(); updateHint(); }

const HINTS: Record<string, string> = {
  select: 'Tap anything to select it. Drag to move. Drag the round handles to resize. Pinch to zoom, drag empty space to pan.',
  wall: 'Tap where the wall starts, then tap each corner. Type an exact length below. Tap the first point or ✓ Done to finish.',
  room: 'Tap the corners of the floor/area. Tap the first corner to close it. Or tap “Fill inside walls”.',
  door: 'Tap on a wall to place it. Drag it along the wall after.', window: 'Tap on a wall to place it.', slider: 'Tap on a wall to place it.', opening: 'Tap on a wall to place it.',
  measure: 'Tap two points to measure between them.', calibrate: 'Tap both ends of something with a known length on the blueprint (like a dimension line), then type the real length.',
  object: 'Tap where to place it.',
};
function updateHint() {
  const el = $('#hint'); let t = '';
  if (view === 'plan') { t = HINTS[plan.tool] || ''; if (plan.tool === 'wall' && plan.wallStart) t = 'Tap the next corner, or type the length below and press Add.'; if (plan.tool === 'calibrate' && plan.calA) t = 'Now tap the other end of the known length.'; if (!store.p.walls.length && plan.tool === 'select' && store.p.scan) t = 'The dark lines are a slice through your scan. Use 📏 Draw walls to trace over them (Scan settings: ☰ menu).'; else if (!store.p.walls.length && !store.p.rooms.length && plan.tool === 'select' && !store.p.background) t = 'Start with ⬛ Quick room (type the size) or 📏 Draw walls. Tip: ☰ menu has blueprint, scan and templates.'; }
  else if (view === '3d') t = v3.tool === 'measure' ? 'Tap two points on the model or scan to measure.' : v3.tool === 'calScan' ? 'Tap two points on the scan whose real distance you know.' : v3.tool === 'floorScan' ? 'Tap a spot on the scan floor.' : 'One finger: orbit · two fingers: zoom/pan · tap to select, drag a selected item to move it.';
  else if (view === 'walk') t = 'Left pad: walk · drag on screen: look around. Keyboard: W A S D + mouse.';
  else t = photo.tool === 'area' ? 'Tap around the area to fill. Tap the first point or ✅ Done to finish.' : photo.tool === 'curb' ? 'Tap along the curb line, then ✅ Done.' : photo.tool === 'horizon' ? 'Drag to where the ground meets the horizon (sets perspective).' : photo.tool === 'sprite' ? 'Tap on the photo to place it.' : 'Tap an item to select · drag to move · pinch to resize. Hold 👁️ to see the before photo.';
  if (el.textContent !== t) { el.textContent = t; el.classList.remove('fade'); clearTimeout(hintT); hintT = setTimeout(() => el.classList.add('fade'), 9000); } el.style.display = t ? '' : 'none';
}
let hintT: any;

// ---------- wall draft bar (exact lengths) ----------
function updateDraftBar() {
  const bar = $('#draftbar');
  if (view !== 'plan' || plan.tool !== 'wall' || !plan.wallStart) { bar.style.display = 'none'; return; }
  if (bar.style.display !== 'none' && bar.dataset.built) { const inp = bar.querySelector('input') as HTMLInputElement; if (document.activeElement !== inp && plan.cursor) inp.placeholder = fmtLen(dist(plan.wallStart, plan.cursor)); return; }
  bar.innerHTML = ''; bar.dataset.built = '1'; bar.style.display = '';
  const inp = h('input', { class: 'inp', placeholder: 'Length e.g. 12 6', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'done' }) as HTMLInputElement;
  const add = (ang?: number) => { const L = parseLen(inp.value); if (!L) { toast('Type a length first, e.g. 12 6 or 12\' 6"'); inp.focus(); return; } plan.addWallExact(L, ang ?? plan.lastDir); inp.value = ''; };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  bar.append(inp,
    h('button', { class: 'btn sq', title: 'Right', onclick: () => add(0) }, '→'), h('button', { class: 'btn sq', title: 'Down', onclick: () => add(Math.PI / 2) }, '↓'),
    h('button', { class: 'btn sq', title: 'Left', onclick: () => add(Math.PI) }, '←'), h('button', { class: 'btn sq', title: 'Up', onclick: () => add(-Math.PI / 2) }, '↑'),
    h('button', { class: 'btn primary', onclick: () => { plan.finishWall(); } }, '✓ Done'));
}
store.on(() => { if (plan.tool !== 'wall') { $('#draftbar').style.display = 'none'; ($('#draftbar') as any).dataset.built = ''; } });

// ---------- selection: context toolbar + properties sheet ----------
store.on(w => { if (w === 'select' || w === 'change' || w === 'load') { renderCtx(); if (sheetOpen === 'props') renderProps(); } if (w !== 'select') { renderTotals(); if (w !== 'live') scheduleAutosave(); } if (w !== 'live') updateHint(); renderTop(); });
function renderCtx() {
  const c = $('#ctxbar'); c.innerHTML = ''; const s = store.sel; const it = s && findSel(store.p, s);
  if (!s || !it || view === 'photo' || view === 'walk') { c.style.display = 'none'; return; } c.style.display = '';
  const name = s.kind === 'wall' ? `Wall ${fmtLen(wallLen(it))}` : s.kind === 'room' ? `${it.name} · ${fmtArea(polyArea(roomOutline(it)))}` : s.kind === 'object' ? it.name : s.kind === 'opening' ? (OPENINGS.find(o => o.style === it.style && o.kind === it.kind)?.name.replace(/\s*\d.*$/, '') || it.kind) + ' ' + fmtLen(it.width, { short: true }) : s.kind === 'measure' ? 'Measure ' + fmtLen(Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y, it.b.z - it.a.z)) : s.kind === 'background' ? 'Blueprint' : 'Scan';
  c.append(h('span', { class: 'cname', onclick: () => openSheet('props') }, name));
  const B = (icon: string, label: string, fn: () => void, cls = '') => c.append(h('button', { class: 'cbtn ' + cls, title: label, 'aria-label': label, onclick: fn }, h('span', {}, icon), h('small', {}, label)));
  B('✏️', 'Edit', () => openSheet('props'));
  if (s.kind === 'object') { B('⟳', 'Rotate', () => store.mutate(() => { it.rot = (it.rot + Math.PI / 2) % (Math.PI * 2); })); B('⧉', 'Copy', () => duplicate()); B('🎨', 'Color', () => openSheet('props', 'color')); }
  if (s.kind === 'room') { B('⧉', 'Copy', () => duplicate()); B('🎨', 'Material', () => openSheet('props', 'mat')); }
  if (s.kind === 'opening') { B('⇋', 'Flip', () => store.mutate(() => { it.flip = !it.flip; })); B('⇆', 'Hinge', () => store.mutate(() => { it.hingeRight = !it.hingeRight; })); }
  if (s.kind === 'wall') { B('🎨', 'Paint', () => openSheet('props', 'color')); B('➗', 'Split', () => splitWall(it)); }
  if (s.kind !== 'background' && s.kind !== 'scan') B('🗑️', 'Delete', () => deleteSel(), 'danger');
  B('✕', 'Done', () => store.select(null));
}
function duplicate() {
  const s = store.sel; if (!s) return; const it = findSel(store.p, s); const off = 2 * FT;
  if (s.kind === 'object') { const o = { ...it, id: uid(), x: it.x + off, y: it.y + off }; store.mutate(p => p.objects.push(o)); store.select({ kind: 'object', id: o.id }); }
  if (s.kind === 'room') { const r = { ...it, id: uid(), name: it.name + ' copy', pts: it.pts.map((q: Pt) => ({ x: q.x + off, y: q.y + off })) }; store.mutate(p => p.rooms.push(r)); store.select({ kind: 'room', id: r.id }); }
}
function deleteSel() {
  const s = store.sel; if (!s) return;
  store.mutate(p => {
    if (s.kind === 'wall') { p.walls = p.walls.filter(w => w.id !== s.id); p.openings = p.openings.filter(o => o.wallId !== s.id); }
    if (s.kind === 'opening') p.openings = p.openings.filter(o => o.id !== s.id);
    if (s.kind === 'room') p.rooms = p.rooms.filter(o => o.id !== s.id);
    if (s.kind === 'object') p.objects = p.objects.filter(o => o.id !== s.id);
    if (s.kind === 'measure') p.measures = p.measures.filter(o => o.id !== s.id);
  });
  store.select(null); toast('Deleted. Tap ↶ Undo to bring it back.');
}
function splitWall(w: Wall) {
  const L = wallLen(w); const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }; const w2: Wall = { ...w, id: uid(), a: { ...m }, b: { ...w.b } };
  store.mutate(p => { const ww = p.walls.find(x => x.id === w.id)!; ww.b = { ...m }; p.walls.push(w2); for (const o of p.openings) if (o.wallId === w.id && o.t > L / 2) { o.wallId = w2.id; o.t -= L / 2; } });
  toast('Wall split in two');
}

// ---------- sheet ----------
let sheetOpen: string | null = null; let sheetFocus = '';
function openSheet(kind: string, focus = '') { sheetOpen = kind; sheetFocus = focus; $('#sheet').classList.add('open'); if (kind === 'props') renderProps(); }
function closeSheet() { sheetOpen = null; $('#sheet').classList.remove('open'); }
function sheetShell(title: string, ...kids: (Node | null)[]) { const s = $('#sheet'); s.innerHTML = ''; s.append(h('div', { class: 'shead' }, h('div', { class: 'grab' }), h('h3', {}, title), h('button', { class: 'x', onclick: closeSheet, 'aria-label': 'Close' }, '✕')), h('div', { class: 'sbody' }, ...kids)); }

function lenField(label: string, val: number, set: (v: number) => void, min = 0) {
  const inp = h('input', { class: 'inp', value: fmtLen(val), autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'done' }) as HTMLInputElement;
  const commit = () => { const v = parseLen(inp.value); if (v == null || v < min) { inp.value = fmtLen(val); if (inp.value !== '') toast('Could not read that. Try 12 6 or 12\' 6"'); return; } if (Math.abs(v - val) > 1e-6) set(v); };
  inp.addEventListener('change', commit); inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); }); inp.addEventListener('focus', () => setTimeout(() => inp.select(), 30));
  return h('label', { class: 'field' }, h('span', {}, label), inp);
}
function numField(label: string, val: number, set: (v: number) => void, suffix = '') {
  const inp = h('input', { class: 'inp', value: String(Math.round(val * 10) / 10), inputmode: 'decimal' }) as HTMLInputElement;
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) set(v); }); inp.addEventListener('focus', () => setTimeout(() => inp.select(), 30));
  return h('label', { class: 'field' }, h('span', {}, label + (suffix ? ` (${suffix})` : '')), inp);
}
function txtField(label: string, val: string, set: (v: string) => void) { const inp = h('input', { class: 'inp', value: val }) as HTMLInputElement; inp.addEventListener('change', () => set(inp.value)); return h('label', { class: 'field' }, h('span', {}, label), inp); }
function toggle(label: string, on: boolean, set: (v: boolean) => void) { const b = h('button', { class: 'chip' + (on ? ' on' : ''), onclick: () => set(!on) }, (on ? '✓ ' : '') + label); return b; }
function swatches(cur: string, set: (c: string) => void) {
  const wrap = h('div', { class: 'swatches' });
  for (const p of PAINTS) wrap.append(h('button', { class: 'sw' + (p.hex.toLowerCase() === (cur || '').toLowerCase() ? ' on' : ''), style: `background:${p.hex}`, title: p.name, 'aria-label': p.name, onclick: () => set(p.hex) }));
  const ci = h('input', { type: 'color', value: cur || '#ffffff', class: 'swc', title: 'Custom color' }) as HTMLInputElement; ci.addEventListener('change', () => set(ci.value)); wrap.append(ci); return wrap;
}
const row = (...k: (Node | null)[]) => h('div', { class: 'row' }, ...k);
const sec = (t: string) => h('div', { class: 'sec' }, t);

function renderProps() {
  const s = store.sel; const it = s && findSel(store.p, s); if (!s || !it) { if (sheetOpen === 'props') closeSheet(); return; }
  const M = (fn: () => void) => store.mutate(fn);
  if (s.kind === 'wall') {
    const w = it as Wall; const L = wallLen(w);
    sheetShell('Wall',
      row(lenField('Length', L, v => M(() => { const d = wallDir(w); const nb = { x: w.a.x + d.x * v, y: w.a.y + d.y * v }; const old = { ...w.b }; for (const o of store.p.walls) { if (dist(o.a, old) < 1e-4) o.a = { ...nb }; if (dist(o.b, old) < 1e-4) o.b = { ...nb }; } }), 0.05),
        lenField('Height', w.height, v => M(() => { w.height = v; }), 0.1), lenField('Thickness', w.thickness, v => M(() => { w.thickness = v; }), 0.01)),
      row(numField('Angle', ((wallAngle(w) * 180 / Math.PI) + 360) % 360, v => M(() => { const a = v * Math.PI / 180; w.b = { x: w.a.x + Math.cos(a) * L, y: w.a.y + Math.sin(a) * L }; }), '°'),
        h('div', { class: 'field' }, h('span', {}, 'All walls'), h('button', { class: 'btn', onclick: () => M(() => { store.p.walls.forEach(x => { x.height = w.height; x.thickness = w.thickness; }); }) }, 'Use this height & thickness'))),
      sec('Paint color'), swatches(w.color, c => M(() => { w.color = c; })),
      row(h('button', { class: 'btn', onclick: () => M(() => { store.p.walls.forEach(x => x.color = w.color); }) }, 'Paint all walls this color'), h('button', { class: 'btn', onclick: () => splitWall(w) }, 'Split in half'), h('button', { class: 'btn danger', onclick: deleteSel }, 'Delete wall')));
  } else if (s.kind === 'opening') {
    const o = it; const w = store.wall(o.wallId)!; const opts = OPENINGS.filter(x => (o.kind === 'window') === (x.kind === 'window'));
    const sel = h('select', { class: 'inp', onchange: (e: any) => { const x = OPENINGS.find(q => q.key === e.target.value)!; M(() => { o.kind = x.kind; o.style = x.style; o.width = x.width; o.height = x.height; o.sill = x.sill; }); } }, ...opts.map(x => h('option', { value: x.key, selected: x.style === o.style && x.kind === o.kind && Math.abs(x.width - o.width) < 0.01 }, x.name)));
    sheetShell(o.kind === 'window' ? 'Window' : 'Door / opening', h('label', { class: 'field' }, h('span', {}, 'Type'), sel),
      row(lenField('Width', o.width, v => M(() => { o.width = Math.min(v, wallLen(w)); }), 0.1), lenField('Height', o.height, v => M(() => { o.height = v; }), 0.1), o.kind === 'window' ? lenField('Sill height', o.sill, v => M(() => { o.sill = v; })) : null),
      row(lenField('From wall start to edge', o.t - o.width / 2, v => M(() => { o.t = Math.max(o.width / 2, Math.min(wallLen(w) - o.width / 2, v + o.width / 2)); })), lenField('From wall end to edge', wallLen(w) - o.t - o.width / 2, v => M(() => { o.t = Math.max(o.width / 2, Math.min(wallLen(w) - o.width / 2, wallLen(w) - v - o.width / 2)); }))),
      row(h('button', { class: 'btn', onclick: () => M(() => { o.t = wallLen(w) / 2; }) }, 'Center on wall'), toggle('Swing other side', o.flip, v => M(() => { o.flip = v; })), toggle('Hinge right', o.hingeRight, v => M(() => { o.hingeRight = v; })), h('button', { class: 'btn danger', onclick: deleteSel }, 'Delete')));
  } else if (s.kind === 'room') {
    const r = it as Room; const ol = roomOutline(r);
    const fsel = h('div', { class: 'mats' }, ...Object.entries(FLOORS).map(([k, f]) => h('button', { class: 'mat' + (r.floor === k ? ' on' : ''), onclick: () => M(() => { r.floor = k; }) }, h('i', { style: `background:${f.color}` }), f.label)));
    sheetShell(r.outdoor ? 'Outdoor area' : 'Room',
      row(txtField('Name', r.name, v => M(() => { r.name = v; })), r.outdoor ? null : lenField('Ceiling height', r.ceilingHeight, v => M(() => { r.ceilingHeight = v; }), 0.5)),
      h('p', { class: 'muted' }, `Area ${fmtArea(polyArea(ol))} · Perimeter ${fmtLen(polyPerimeter(ol), { short: true })}`),
      sec('Floor / surface material'), fsel,
      row(toggle('Outdoor', !!r.outdoor, v => M(() => { r.outdoor = v; })), toggle('Curved edges', !!r.smooth, v => M(() => { r.smooth = v; })), toggle('Concrete curbing', !!r.curb, v => M(() => { r.curb = v; })), r.outdoor ? null : toggle('Ceiling', r.showCeiling, v => M(() => { r.showCeiling = v; }))),
      h('p', { class: 'muted' }, 'Drag the white dots to move corners. Drag a small blue dot to add a corner. Curved edges makes smooth beds, paths and pool shapes.'),
      row(h('button', { class: 'btn', onclick: () => wallsAroundRoom(r) }, 'Build walls around it'), h('button', { class: 'btn', onclick: () => duplicate() }, 'Duplicate'), r.pts.length > 3 ? h('button', { class: 'btn', onclick: () => M(() => { r.pts.pop(); }) }, 'Remove last corner') : null, h('button', { class: 'btn danger', onclick: deleteSel }, 'Delete')));
  } else if (s.kind === 'object') {
    const o = it as Obj; const cat = CAT_BY_KEY[o.kind];
    const fin = h('select', { class: 'inp', onchange: (e: any) => M(() => { o.finish = e.target.value; }) }, ...Object.entries(FINISHES).map(([k, f]) => h('option', { value: k, selected: (o.finish || cat?.finish || 'satin') === k }, f.label)));
    sheetShell(o.name,
      row(txtField('Name', o.name, v => M(() => { o.name = v; }))),
      row(lenField('Width', o.w, v => M(() => { o.w = v; }), 0.01), lenField('Depth', o.d, v => M(() => { o.d = v; }), 0.005), lenField('Height', o.h, v => M(() => { o.h = v; }), 0.005)),
      row(lenField('Off the floor', o.elev, v => M(() => { o.elev = v; })), numField('Rotation', ((o.rot * 180 / Math.PI) % 360 + 360) % 360, v => M(() => { o.rot = v * Math.PI / 180; }), '°'), h('label', { class: 'field' }, h('span', {}, 'Finish'), fin)),
      sec('Color'), swatches(o.color, c => M(() => { o.color = c; })),
      row(h('button', { class: 'btn', onclick: () => cat && M(() => { o.w = cat.w; o.d = cat.d; o.h = cat.h; }) }, 'Reset size'), h('button', { class: 'btn', onclick: () => M(() => { o.elev = 0; }) }, 'Drop to floor'), h('button', { class: 'btn', onclick: duplicate }, 'Duplicate'), h('button', { class: 'btn danger', onclick: deleteSel }, 'Delete')));
  } else if (s.kind === 'measure') {
    const L = Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y, it.b.z - it.a.z);
    sheetShell('Measurement', h('p', { class: 'big' }, fmtLen(L)), row(h('button', { class: 'btn danger', onclick: deleteSel }, 'Delete')));
  } else if (s.kind === 'background') renderBgPanel(); else if (s.kind === 'scan') renderScanPanel();
  if (sheetFocus) { const el = $('#sheet').querySelector(sheetFocus === 'color' ? '.swatches' : '.mats'); el?.scrollIntoView({ block: 'center' }); sheetFocus = ''; }
}
function wallsAroundRoom(r: Room) {
  const D = store.p.defaults; const pts = r.pts;
  store.mutate(p => { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if (!p.walls.some(w => (dist(w.a, a) < 0.01 && dist(w.b, b) < 0.01) || (dist(w.a, b) < 0.01 && dist(w.b, a) < 0.01))) p.walls.push({ id: uid(), a: { ...a }, b: { ...b }, thickness: D.wallThickness, height: D.wallHeight, color: '#f4f1ea' }); } });
  toast('Walls added');
}

// ---------- totals ----------
function renderTotals() {
  const t = takeoff(); const P = store.p; const parts: string[] = [];
  if (t.wallLf) parts.push(`Walls ${Math.round(t.wallLf)} lf`); if (t.floorSf) parts.push(`Floor ${Math.round(t.floorSf)} sq ft`); if (t.outdoorSf) parts.push(`Outdoor ${Math.round(t.outdoorSf)} sq ft`); if (t.curbLf) parts.push(`Curb ${Math.round(t.curbLf)} lf`);
  const items = P.objects.length + P.openings.length; if (items) parts.push(`${items} items`);
  const el = $('#totals'); el.innerHTML = ''; el.append(h('span', {}, parts.join(' · ') || 'Nothing drawn yet'), h('button', { class: 'tot', onclick: () => openTakeoff() }, t.total ? money(t.total) : '$ Set prices'));
}
async function openTakeoff() {
  const t = takeoff(); const P = store.p as any;
  const tbl = h('table', { class: 'tk' }, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Qty'), h('th', {}, 'Price / unit'), h('th', {}, 'Total')));
  for (const l of t.lines) {
    const inp = h('input', { class: 'inp sm', inputmode: 'decimal', value: l.price ? String(l.price) : '', placeholder: '$' }) as HTMLInputElement;
    inp.addEventListener('change', () => { store.mutate(() => { P.prices[l.key] = parseFloat(inp.value) || 0; }); openTakeoff(); });
    tbl.append(h('tr', {}, h('td', {}, l.label), h('td', {}, `${l.qty} ${l.unit}`), h('td', {}, inp), h('td', {}, l.price ? money(l.qty * l.price) : '—')));
  }
  const mk = h('input', { class: 'inp sm', inputmode: 'decimal', value: String(P.markup || 0) }) as HTMLInputElement; mk.addEventListener('change', () => { store.mutate(() => { P.markup = parseFloat(mk.value) || 0; }); openTakeoff(); });
  const body = h('div', {}, t.lines.length ? tbl : h('p', {}, 'Draw rooms, areas, walls or add items and the quantities show up here automatically.'),
    h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Markup / overhead %'), mk), h('div', { class: 'field' }, h('span', {}, 'Estimated total'), h('b', { class: 'big' }, money(t.total)))),
    h('p', { class: 'muted' }, 'Enter your own installed prices per unit. They are saved with this project. Quantities come from the drawing, so check them on site.'));
  const r = await modal('Takeoff & estimate', body, [{ label: 'Close', value: null }, { label: '📄 Proposal PDF', primary: true, value: 'pdf' }], { wide: true });
  if (r === 'pdf') doExportPDF();
}

// ---------- top bar ----------
function renderTop() {
  $('#pname').textContent = store.p.name || 'Untitled';
  ($('#undo') as HTMLButtonElement).disabled = !store.canUndo(); ($('#redo') as HTMLButtonElement).disabled = !store.canRedo();
}
$('#undo').addEventListener('click', () => store.undo()); $('#redo').addEventListener('click', () => store.redo());
$('#pname').addEventListener('click', () => projectInfo());
$('#menuBtn').addEventListener('click', () => openMenu());
$('#shareBtn').addEventListener('click', () => shareMenu());
$('#helpBtn').addEventListener('click', () => help());
window.addEventListener('keydown', e => {
  if ((e.target as any)?.closest?.('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (store.sel) deleteSel(); }
  else if (e.key === 'Escape') { if (plan.tool === 'wall') plan.finishWall(); else if (plan.tool === 'room') plan.finishRoom(); else { setTool('select'); store.select(null); } }
});

async function projectInfo() {
  const P = store.p; const f = (k: 'name' | 'client' | 'address' | 'notes', l: string, ta = false) => { const i = (ta ? h('textarea', { class: 'inp', rows: 3 }) : h('input', { class: 'inp' })) as HTMLInputElement; i.value = P[k] || ''; i.dataset.k = k; return h('label', { class: 'field' }, h('span', {}, l), i); };
  const body = h('div', {}, f('name', 'Project name'), f('client', 'Client'), f('address', 'Job address'), f('notes', 'Notes (show on proposal)', true));
  const r = await modal('Project info', body, [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: 'ok' }], {});
  if (r !== 'ok') return; const vals: any = {}; body.querySelectorAll('[data-k]').forEach((i: any) => vals[i.dataset.k] = i.value);
  store.mutate(p => Object.assign(p, vals));
}

// ---------- menus ----------
async function openMenu() {
  const items: [string, string, () => void][] = [
    ['🆕', 'New project', () => startWizard(true)], ['📂', 'My projects', () => projectsList()], ['🧬', 'Save a copy (design option B)', () => saveVariant()],
    ['🗺️', 'Import blueprint, survey or aerial (image/PDF)', () => importBlueprint()], ['📱', 'Import 3D scan (iPhone LiDAR, Polycam, GLB/OBJ/PLY/USDZ, RoomPlan)', () => importScan()],
    ['🎥', 'Photos/video → 3D model (how it works)', () => videoHelp()], ['🧰', 'Templates', () => templatesMenu()],
    ['📥', 'Open project file (.json)', () => importJSON()], ['💾', 'Save project file (.json backup)', () => exportJSON()],
    ['📏', `Units: ${getUnits() === 'imperial' ? 'feet & inches' : 'metric'} (tap to switch)`, () => { const u = getUnits() === 'imperial' ? 'metric' : 'imperial'; setUnits(u); store.mutate(p => { p.units = u; }); }],
    ['⚙️', 'Default wall height & thickness', () => defaultsMenu()], ['💲', 'Takeoff & prices', () => openTakeoff()], ['❓', 'Help & tips', () => help()],
  ];
  const list = h('div', { class: 'menu' }, ...items.map(([i, l, fn]) => h('button', { class: 'mi', onclick: () => { closeModal(); fn(); } }, h('span', { class: 'mii' }, i), l)));
  if (store.p.background) list.prepend(h('button', { class: 'mi', onclick: () => { closeModal(); store.select({ kind: 'background', id: 'bg' }); openSheet('props'); } }, h('span', { class: 'mii' }, '🖼️'), 'Blueprint settings (scale, opacity, lock)'));
  if (store.p.scan) list.prepend(h('button', { class: 'mi', onclick: () => { closeModal(); store.select({ kind: 'scan', id: 'scan' }); openSheet('props'); } }, h('span', { class: 'mii' }, '🧊'), 'Scan settings (scale, floor, walls)'));
  modal('Menu', list, []);
}
async function shareMenu() {
  const r = await modal('Share / export', h('div', { class: 'menu' },
    ...([['pdf', '📄', 'Proposal PDF (plan, dimensions, takeoff, 3D view)'], ['png', '🖼️', 'Floor plan image (PNG)'], ['shot', '📸', '3D view screenshot'], ['photo', '🌴', 'Photo design image'], ['dxf', '📐', 'CAD file (DXF)'], ['json', '💾', 'Project file (backup / send to another device)']] as const)
      .map(([v, i, l]) => h('button', { class: 'mi', onclick: () => closeModal(v) }, h('span', { class: 'mii' }, i), l))), []);
  if (r === 'pdf') doExportPDF(); if (r === 'png') doExportPNG(); if (r === 'shot') doShot(); if (r === 'dxf') shareOrDownload(exportDXF(store.p), fileBase() + '.dxf'); if (r === 'json') exportJSON();
  if (r === 'photo') { if (view !== 'photo') setView('photo'); const b = await photo.exportBlob(); if (b) shareOrDownload(b, fileBase() + '-photo-design.jpg'); else toast('Make a photo design first'); }
}
const fileBase = () => (store.p.name || 'primus3d').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'primus3d';
async function doExportPNG() { toast('Making image…'); const b = await exportPNG(underlay, true); shareOrDownload(b, fileBase() + '-plan.png'); }
async function doShot() { const was = view; if (view !== '3d' && view !== 'walk') { setView('3d'); await new Promise(r => setTimeout(r, 400)); } const url = v3.screenshot(); const b = await (await fetch(url)).blob(); shareOrDownload(b, fileBase() + '-3d.png'); if (was !== view && was === 'plan') setView('plan'); }
async function doExportPDF() {
  toast('Building proposal PDF…', 4000); const was = view;
  let shot: string | undefined; try { if (store.p.walls.length || store.p.objects.length) { if (view !== '3d') { setView('3d'); await new Promise(r => setTimeout(r, 500)); } v3.fitView(); await new Promise(r => setTimeout(r, 300)); shot = v3.screenshot(); } } catch { /* ignore */ }
  if (was !== view) setView(was);
  const b = await exportPDF(underlay, true, shot); shareOrDownload(b, fileBase() + '-proposal.pdf');
}
async function exportJSON() { const b = await exportProjectJSON(store.p); shareOrDownload(b, fileBase() + '.primus3d.json'); }
async function importJSON() { const f = await pickFile('.json,application/json'); if (!f) return; try { const p = await importProjectJSON(await f.text()); p.id = uid(); store.load(p); afterLoad(); toast('Project opened'); } catch (e: any) { toast('Could not open: ' + e.message); } }
async function saveVariant() { await saveNow(); const p = JSON.parse(JSON.stringify(store.p)) as Project; p.id = uid(); p.name = (p.name || 'Project') + ' – option B'; p.created = p.updated = Date.now(); store.load(p); await saveNow(); toast('Copy made. You are now editing the copy; the original is in My projects.'); }
async function defaultsMenu() {
  const D = store.p.defaults; const body = h('div', {},
    lenField('Wall height', D.wallHeight, v => store.mutate(() => { D.wallHeight = v; })), lenField('Wall thickness', D.wallThickness, v => store.mutate(() => { D.wallThickness = v; })),
    lenField('Ceiling height (new rooms)', D.ceiling, v => store.mutate(() => { D.ceiling = v; })),
    row(toggle('Snap to grid & corners', plan.snap, v => { plan.snap = v; closeModal(); toast(v ? 'Snapping on' : 'Snapping off'); }), toggle('Dimensions on walls', plan.showDims, v => { plan.showDims = v; v3.showDims = v; store.emit('change'); closeModal(); })),
    h('p', { class: 'muted' }, 'Typical: 2x4 wall with drywall = 4½", 2x6 = 6½", 8" CMU block + stucco = 9". Ceiling 8\', 9\' or 10\'.'));
  modal('Defaults', body, [{ label: 'Done', primary: true }]);
}

// ---------- catalog ----------
const RECENT_KEY = 'p3d-recent', FAV_KEY = 'p3d-fav';
const getList = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
function openCatalog(cat = '') {
  let q = ''; let curCat = cat || (getList(RECENT_KEY).length ? 'Recent' : 'Kitchen');
  const tabs = h('div', { class: 'tabs' }); const grid = h('div', { class: 'grid' });
  const search = h('input', { class: 'inp', placeholder: '🔍 Search (e.g. palm, vanity, pavers)', autocomplete: 'off' }) as HTMLInputElement;
  const draw = () => {
    tabs.innerHTML = ''; for (const c of ['Recent', '★ Favorites', ...CATEGORIES]) tabs.append(h('button', { class: 'tab' + (c === curCat && !q ? ' on' : ''), onclick: () => { curCat = c; q = ''; search.value = ''; draw(); } }, c));
    grid.innerHTML = ''; const fav = getList(FAV_KEY), rec = getList(RECENT_KEY);
    const ops = OPENINGS.map(o => ({ key: o.key, cat: o.cat, name: o.name, icon: o.icon, op: true }));
    const all = [...ops, ...CATALOG.map(c => ({ key: c.key, cat: c.cat, name: c.name, icon: c.icon, op: false }))];
    let list = q ? all.filter(x => (x.name + ' ' + x.cat).toLowerCase().includes(q.toLowerCase())) : curCat === 'Recent' ? rec.map(k => all.find(x => x.key === k)!).filter(Boolean) : curCat === '★ Favorites' ? fav.map(k => all.find(x => x.key === k)!).filter(Boolean) : all.filter(x => x.cat === curCat);
    if (!list.length) grid.append(h('p', { class: 'muted' }, curCat === '★ Favorites' ? 'Tap ☆ on any item to keep it here.' : 'Nothing yet.'));
    for (const x of list) {
      const isFav = fav.includes(x.key); const ci = CAT_BY_KEY[x.key];
      grid.append(h('div', { class: 'card' }, h('button', { class: 'cardb', onclick: () => { pickItem(x.key, x.op); } }, h('span', { class: 'ci' }, x.icon), h('span', { class: 'cn' }, x.name), ci ? h('span', { class: 'cd' }, `${fmtLen(ci.w, { short: true })} × ${fmtLen(ci.d, { short: true })}`) : null),
        h('button', { class: 'fav', 'aria-label': 'Favorite', onclick: () => { const f = getList(FAV_KEY); localStorage.setItem(FAV_KEY, JSON.stringify(isFav ? f.filter(k => k !== x.key) : [x.key, ...f])); draw(); } }, isFav ? '★' : '☆')));
    }
  };
  search.addEventListener('input', () => { q = search.value; draw(); }); draw();
  modal('Add to design', h('div', { class: 'catalog' }, search, tabs, grid), [], { wide: true });
}
function pickItem(key: string, isOpening: boolean) {
  closeModal(); const r = getList(RECENT_KEY).filter(k => k !== key); r.unshift(key); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 16)));
  if (isOpening) { const o = OPENINGS.find(x => x.key === key)!; setView('plan'); plan.openingPreset = key; plan.setTool(o.kind); renderDock(); updateHint(); toast('Tap on a wall to place: ' + o.name); return; }
  // place at the center of the current plan view (or 3D target)
  let p: Pt = view === '3d' ? { x: v3.controls.target.x, y: v3.controls.target.z } : { x: plan.v.cx, y: plan.v.cy };
  const g = 3 * IN; p = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  plan.placeObject(key, p); renderDock(); openSheetLite();
}
function openSheetLite() { /* keep the canvas visible: just the context toolbar shows; Edit opens full sheet */ }

// ---------- quick room / areas ----------
async function quickRoom() {
  const wI = h('input', { class: 'inp big', placeholder: "e.g. 12' or 12 6", autocomplete: 'off' }) as HTMLInputElement; const lI = h('input', { class: 'inp big', placeholder: "e.g. 14'", autocomplete: 'off' }) as HTMLInputElement;
  const nI = h('input', { class: 'inp', value: `Room ${store.p.rooms.length + 1}` }) as HTMLInputElement;
  const kind = { v: 'room' };
  const kinds = h('div', { class: 'row' }, ...([['room', '🏠 Room with walls'], ['floor', '🔷 Floor only'], ['outdoor', '🌳 Outdoor area']] as const).map(([k, l]) => { const b = h('button', { class: 'chip' + (k === 'room' ? ' on' : ''), onclick: () => { kind.v = k; kinds.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); b.classList.add('on'); } }, l); return b; }));
  const presets = h('div', { class: 'row wrap' }, ...[[10, 10], [10, 12], [12, 12], [12, 14], [14, 16], [5, 8], [20, 20], [24, 24]].map(([a, b]) => h('button', { class: 'chip', onclick: () => { wI.value = `${a}'`; lI.value = `${b}'`; } }, `${a}×${b}`)));
  const body = h('div', {}, kinds, h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Width'), wI), h('label', { class: 'field' }, h('span', {}, 'Length'), lI)), presets, h('label', { class: 'field' }, h('span', {}, 'Name'), nI),
    h('p', { class: 'muted' }, 'Inside dimensions. It is placed next to what you already drew; drag it anywhere after.'));
  const r = await modal('Quick room', body, [{ label: 'Cancel', value: null }, { label: 'Add', primary: true, value: 'ok' }], { onOpen: () => setTimeout(() => wI.focus(), 80) });
  if (r !== 'ok') return; const W = parseLen(wI.value), L = parseLen(lI.value); if (!W || !L) { toast('Enter both sizes, like 12 and 14'); return; }
  addRect(W, L, nI.value || 'Room', kind.v as any);
}
function addRect(W: number, L: number, name: string, kind: 'room' | 'floor' | 'outdoor', at?: Pt) {
  const P = store.p; const T = P.defaults.wallThickness; let x0 = 0, y0 = 0;
  if (at) { x0 = at.x; y0 = at.y; } else if (P.walls.length || P.rooms.length) { let mx = -Infinity, my = Infinity; P.walls.forEach(w => { mx = Math.max(mx, w.a.x, w.b.x); my = Math.min(my, w.a.y, w.b.y); }); P.rooms.forEach(r => r.pts.forEach(q => { mx = Math.max(mx, q.x); my = Math.min(my, q.y); })); x0 = mx + (kind === 'room' ? 0 : 1); y0 = my; if (kind === 'room') x0 += 0; }
  // rooms are given by inside size: walls on centerline offset by T/2
  const o = kind === 'room' ? T / 2 : 0; const pts = [{ x: x0, y: y0 }, { x: x0 + W + 2 * o, y: y0 }, { x: x0 + W + 2 * o, y: y0 + L + 2 * o }, { x: x0, y: y0 + L + 2 * o }];
  const shared = (a: Pt, b: Pt) => P.walls.find(w => (dist(w.a, a) < 0.02 && dist(w.b, b) < 0.02) || (dist(w.a, b) < 0.02 && dist(w.b, a) < 0.02));
  const room: Room = { id: uid(), name, pts: kind === 'room' ? pts.map((q, i) => ({ x: q.x + (i === 0 || i === 3 ? o : -o), y: q.y + (i < 2 ? o : -o) })) : pts, floor: kind === 'outdoor' ? 'pavers' : 'tile', ceilingHeight: P.defaults.ceiling, showCeiling: kind !== 'outdoor', outdoor: kind === 'outdoor' };
  store.mutate(p => {
    if (kind === 'room') for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; if (!shared(a, b)) p.walls.push({ id: uid(), a: { ...a }, b: { ...b }, thickness: T, height: p.defaults.wallHeight, color: '#f4f1ea' }); }
    p.rooms.push(room);
  });
  store.select({ kind: 'room', id: room.id }); if (view !== 'plan') setView('plan'); plan.fit();
  toast(`${name}: ${fmtArea(W * L)}. Add doors with 🚪.`);
  return room;
}
async function areaMenu() {
  const r = await modal('Floor / area', h('div', { class: 'menu' },
    h('button', { class: 'mi', onclick: () => closeModal('fill') }, h('span', { class: 'mii' }, '🪣'), 'Fill inside walls (tap inside a room)'),
    h('button', { class: 'mi', onclick: () => closeModal('draw') }, h('span', { class: 'mii' }, '✏️'), 'Draw corners (rooms, patios, beds, driveways)'),
    h('button', { class: 'mi', onclick: () => closeModal('rect') }, h('span', { class: 'mii' }, '⬛'), 'Type a size (W × L)')), []);
  if (r === 'draw') setTool('room'); if (r === 'rect') quickRoom();
  if (r === 'fill') { setTool('select'); fillMode = true; $('#hint').textContent = 'Tap inside the walls of a room to fill its floor.'; $('#hint').style.display = ''; }
}
let fillMode = false;
$('#plan').addEventListener('pointerup', e => {
  if (!fillMode) return; fillMode = false; const r = (e.target as HTMLElement).getBoundingClientRect(); const p = plan.toWorld(e.clientX - r.left, e.clientY - r.top);
  if (!plan.autoRoomAt(p)) toast('No closed walls found there. Use “Draw corners” instead.'); else toast('Floor added'); updateHint();
}, true);

// ---------- blueprint ----------
async function importBlueprint() {
  const f = await pickFile('image/*,application/pdf,.pdf'); if (!f) return;
  toast('Loading…'); try {
    let page = 1; let res = await blueprintToImageBlob(f, page);
    if (res.pages && res.pages > 1) { const s = await prompt('Which page?', `This PDF has ${res.pages} pages. Which page is the floor plan?`, '1'); page = parseInt(s || '1') || 1; if (page !== 1) res = await blueprintToImageBlob(f, page); }
    const id = uid(); store.assets.set(id, res.blob);
    // guess: 100 px per foot until calibrated; position to the view
    const mpp = (40 * FT) / res.w; store.mutate(p => { p.background = { assetId: id, x: plan.v.cx - res.w * mpp / 2, y: plan.v.cy - res.h * mpp / 2, mpp, rot: 0, opacity: 0.6, wpx: res.w, hpx: res.h, locked: false, visible: true, name: f.name }; });
    setView('plan'); plan.fit(); setTool('calibrate');
    modal('Set the scale', '<p><b>Step 1:</b> tap both ends of a dimension you know (e.g. a wall marked 12\'-0", or a lot line on a survey).</p><p><b>Step 2:</b> type the real length.</p><p>Then trace walls with 📏 Draw walls. Tip: zoom in for accurate taps.</p>', [{ label: 'Got it', primary: true }]);
  } catch (e: any) { toast('Could not load: ' + e.message, 5000); }
}
function renderBgPanel() {
  const bg = store.p.background; if (!bg) { closeSheet(); return; } const M = (fn: () => void) => store.mutate(fn);
  const op = h('input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: String(bg.opacity), class: 'range' }) as HTMLInputElement; op.addEventListener('input', () => { bg.opacity = +op.value; plan.redraw(); }); op.addEventListener('change', () => M(() => {}));
  sheetShell('Blueprint / image', h('label', { class: 'field' }, h('span', {}, 'See-through'), op),
    h('p', { class: 'muted' }, `Scale: 1 image pixel = ${fmtLen(bg.mpp)}. ${bg.locked ? 'Locked.' : 'Unlocked: drag the image to move it.'}`),
    row(h('button', { class: 'btn primary', onclick: () => { closeSheet(); setTool('calibrate'); } }, '📏 Set scale (2 points)'), toggle('Locked', bg.locked, v => M(() => { bg.locked = v; })), toggle('Visible', bg.visible, v => M(() => { bg.visible = v; })),
      h('button', { class: 'btn danger', onclick: () => { M(() => { store.p.background = null; }); store.select(null); } }, 'Remove image')));
}

// ---------- scans ----------
async function importScan() {
  const f = await pickFile(''); if (!f) return; const fmt = scanFormat(f.name);
  if (!fmt) { toast('Use a GLB, GLTF, OBJ, PLY, STL, USDZ or RoomPlan JSON file', 5000); return; }
  if (fmt === 'gltf') toast('Tip: .gltf files with separate textures may not load; export GLB instead.', 5000);
  toast('Loading scan…', 8000);
  try {
    if (fmt === 'json') { const j = JSON.parse(await f.text()); const r = parseRoomPlanJSON(j); if (!r) { toast('That JSON is not a RoomPlan room'); return; } applyArch(r); setView('plan'); plan.fit(); toast(`RoomPlan: ${r.walls.length} walls, ${r.openings.length} doors/windows, ${r.objects.length} objects`, 5000); return; }
    const id = uid(); store.assets.set(id, f);
    const obj = await loadScanObject(f, fmt); // validate + detect
    const arch = detectArchFromScene(obj);
    const THREE = await import('three'); const box = new THREE.Box3().setFromObject(obj); const size = box.getSize(new THREE.Vector3());
    const upZ = false; // most phone scan apps export Y-up; user can flip in Scan settings
    const floorY = arch ? arch.floorY : upZ ? box.min.z : box.min.y;
    const sc: ScanRef = { assetId: id, name: f.name, format: fmt, scale: 1, x: 0, y: -floorY, z: 0, rotY: 0, visible: true, opacity: 1, cutHeight: 1.2, showInPlan: true, calibrated: true, upZ, source: arch ? arch.source : 'mesh' };
    store.mutate(p => { p.scan = sc; });
    let msg = `Scan loaded (${fmtLen(size.x, { short: true })} × ${fmtLen(upZ ? size.y : size.z, { short: true })}). LiDAR scans are already real size.`;
    if (arch) { applyArch(arch); msg = `RoomPlan detected: ${arch.walls.length} walls, ${arch.openings.length} doors/windows added — all editable.`; }
    setView('3d'); setTimeout(() => v3.fitView(), 400); toast(msg, 6000);
    store.select({ kind: 'scan', id: 'scan' });
  } catch (e: any) { console.error(e); toast('Could not load scan: ' + (e.message || e), 6000); }
}
function renderScanPanel() {
  const sc = store.p.scan; if (!sc) { closeSheet(); return; } const M = (fn: () => void) => store.mutate(fn);
  const rng = (label: string, min: number, max: number, step: number, val: number, set: (v: number) => void) => { const r = h('input', { type: 'range', min, max, step, value: val, class: 'range' }) as HTMLInputElement; r.addEventListener('input', () => { set(+r.value); v3.applyScanXf(); }); r.addEventListener('change', () => M(() => {})); return h('label', { class: 'field' }, h('span', {}, label), r); };
  sheetShell('3D scan: ' + sc.name,
    h('p', { class: 'muted' }, sc.calibrated ? 'Using real-world scale (iPhone LiDAR / RoomPlan scans are in meters). For photo-only scans set the scale with 2 points.' : 'Scale not set yet: tap “Set scale”.'),
    row(h('button', { class: 'btn primary', onclick: () => { closeSheet(); setView('3d'); v3.setTool('calScan'); updateHint(); } }, '📏 Set scale (2 points)'), h('button', { class: 'btn', onclick: () => { closeSheet(); setView('3d'); v3.setTool('floorScan'); updateHint(); } }, '⬇️ Tap the floor'), h('button', { class: 'btn', onclick: () => { closeSheet(); setView('3d'); v3.setTool('measure'); renderDock(); updateHint(); } }, '📐 Measure on scan')),
    rng('Turn', -180, 180, 1, sc.rotY * 180 / Math.PI, v => { sc.rotY = v * Math.PI / 180; }),
    rng('See-through', 0.15, 1, 0.05, sc.opacity, v => { sc.opacity = v; }),
    rng(`Plan slice height (${fmtLen(sc.cutHeight, { short: true })})`, 0.3, 2.4, 0.05, sc.cutHeight, v => { sc.cutHeight = v; }),
    row(toggle('Visible', sc.visible, v => M(() => { sc.visible = v; })), toggle('Show in plan for tracing', sc.showInPlan, v => M(() => { sc.showInPlan = v; })), toggle('Cut off ceiling in 3D', v3.cutScan, v => { v3.cutScan = v; v3.applyScanXf(); renderScanPanel(); }), toggle('Z-up file (lying on its side)', sc.upZ, v => M(() => { sc.upZ = v; }))),
    row(lenField('Scale factor ×1000', sc.scale * 1000, v => M(() => { sc.scale = v / 1000; })), h('button', { class: 'btn danger', onclick: () => { M(() => { store.p.scan = null; }); store.select(null); } }, 'Remove scan')));
  // lenField isn't right for a pure number; replace last row field with a numeric one
  const last = $('#sheet').querySelector('.row:last-child .field'); if (last) last.replaceWith(numField('Scale', sc.scale, v => M(() => { sc.scale = v; }), '×'));
}
function videoHelp() {
  modal('Photos or video → 3D model', `<p><b>Best (free) on iPhone Pro / iPad Pro with LiDAR:</b> scan with a free app such as <b>3D Scanner App</b> or <b>Polycam</b> (free export), export <b>GLB</b> or <b>OBJ</b> (or RoomPlan USDZ/JSON), then ☰ → Import 3D scan. Real size, no calibration.</p>
  <p><b>Android / any phone:</b> record a slow video walking around the area (or take 30–80 overlapping photos) and send it to your Grok Bot. It runs a free photogrammetry pipeline (COLMAP + OpenMVS) and sends back a <b>.glb</b> file to import here. It takes several minutes.</p>
  <p><b>Important:</b> photos alone don't know real size. After importing, use <b>Set scale (2 points)</b> on something you measured with a tape (a door is 80" tall, a garage door 16' wide).</p>
  <p>Tips: good light, move slowly, overlap each shot ~70%, avoid plain white walls and mirrors/glass.</p>`, [{ label: 'OK', primary: true }]);
}

// ---------- photo design ----------
async function newPhotoDesign() {
  const f = await pickFile('image/*'); if (!f) return;
  try { const { blob, w, h: hh } = await blueprintToImageBlob(f); const id = uid(); store.assets.set(id, blob);
    const d = { id: uid(), assetId: id, name: f.name, wpx: w, hpx: hh, horizon: 0.42, items: [] as any[] }; store.mutate(p => { p.photos.push(d); }); await photo.open(d);
    photo.tool = 'horizon'; renderDock(); updateHint(); toast('Drag the yellow line to where the ground meets the horizon, then add plants & materials.', 6000);
  } catch (e: any) { toast(e.message, 5000); }
}
function photoSpritePicker() {
  modal('Add to photo', h('div', { class: 'grid' }, ...Object.entries(PHOTO_SPRITES).map(([k, s]) => h('div', { class: 'card' }, h('button', { class: 'cardb', onclick: () => { closeModal(); photo.sprite = k; photo.tool = 'sprite'; renderDock(); updateHint(); } }, h('span', { class: 'ci' }, ({ palm: '🌴', tree: '🌳', shrub: '🌿', flowers: '🌺', grass: '🌾', boulder: '🪨', pot: '🪴', light: '🏮', person: '🧍' } as any)[k] || '•'), h('span', { class: 'cn' }, s.label))))), [], { wide: true });
}
function photoMatPicker() {
  modal('Material area', h('div', { class: 'grid' }, ...Object.entries(PHOTO_MATS).map(([k, m]) => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; m.draw(cv.getContext('2d')!, 64); cv.className = 'matprev'; return h('div', { class: 'card' }, h('button', { class: 'cardb', onclick: () => { closeModal(); photo.mat = k; photo.tool = 'area'; photo.draft = []; renderDock(); updateHint(); } }, cv, h('span', { class: 'cn' }, m.label))); })), [], { wide: true });
}
($('#photo') as HTMLElement).addEventListener('pointerup', () => setTimeout(() => { renderDock(); updateHint(); }, 0));

// ---------- 3D helpers ----------
function topView() { v3.fitView(); const t = v3.controls.target; const d = v3.camera.position.distanceTo(t); v3.camera.position.set(t.x, t.y + d, t.z + 0.01); v3.controls.update(); }
function centroid(pts: Pt[]) { return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }; }
// walk joystick
(() => { const joy = $('#joy'), knob = joy.querySelector('i') as HTMLElement; let id: number | null = null; let c = { x: 0, y: 0 };
  joy.addEventListener('pointerdown', e => { id = e.pointerId; joy.setPointerCapture(id); const r = joy.getBoundingClientRect(); c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; move(e); });
  const move = (e: PointerEvent) => { if (e.pointerId !== id) return; let dx = e.clientX - c.x, dy = e.clientY - c.y; const L = Math.hypot(dx, dy), R = 45; if (L > R) { dx *= R / L; dy *= R / L; } knob.style.transform = `translate(${dx}px,${dy}px)`; v3.setJoy(dx / R, dy / R); };
  joy.addEventListener('pointermove', move); const end = () => { id = null; knob.style.transform = ''; v3.setJoy(0, 0); }; joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end); })();

// ---------- projects ----------
async function saveNow() { try { const thumb = renderPlanCanvas(320, 220, { withBackground: false, underlay: null }).canvas.toDataURL('image/jpeg', 0.6); await saveProject(store.p, thumb); $('#saved').textContent = 'Saved'; } catch (e) { console.warn(e); $('#saved').textContent = 'Not saved!'; } }
let saveT: any; function scheduleAutosave() { $('#saved').textContent = '…'; clearTimeout(saveT); saveT = setTimeout(saveNow, 1200); }
async function projectsList() {
  const list = await listProjects(); const wrap = h('div', { class: 'plist' });
  for (const m of list) wrap.append(h('div', { class: 'pcard' + (m.id === store.p.id ? ' on' : '') }, h('button', { class: 'pmain', onclick: async () => { closeModal(); await saveNow(); const p = await loadProject(m.id); if (p) { store.load(p); afterLoad(); } } }, m.thumb ? h('img', { src: m.thumb, alt: '' }) : h('div', { class: 'nothumb' }, '🏠'), h('b', {}, m.name), h('small', {}, new Date(m.updated).toLocaleString())),
    h('button', { class: 'pdel', 'aria-label': 'Delete project', onclick: async (e: Event) => { e.stopPropagation(); const ok = await modal('Delete project?', `Delete “${m.name}”? This can't be undone.`, [{ label: 'Cancel', value: false }, { label: 'Delete', danger: true, value: true }]); if (ok) { await deleteProject(m.id); if (m.id === store.p.id) { store.load(newProject()); afterLoad(); } } projectsList(); } }, '🗑️')));
  if (!list.length) wrap.append(h('p', { class: 'muted' }, 'No saved projects yet. Projects save automatically on this device.'));
  modal('My projects', h('div', {}, h('button', { class: 'btn primary', onclick: () => { closeModal(); startWizard(true); } }, '＋ New project'), wrap), [], { wide: true });
}
function templatesMenu() {
  modal('Templates', h('div', { class: 'menu' }, ...TEMPLATES.map(t => h('button', { class: 'mi', onclick: async () => { closeModal(); await saveNow(); const p = migrate(t.make()); p.id = uid(); store.load(p); afterLoad(); toast(t.name + ' loaded — tap anything to change it'); } }, h('span', { class: 'mii' }, t.icon), h('span', {}, h('b', {}, t.name), h('br'), h('small', { class: 'muted' }, t.desc))))), []);
}
async function startWizard(isNew: boolean) {
  const opts: [string, string, string, string][] = [
    ['quick', '⬛', 'Quick room', 'Type width × length. Fastest start.'],
    ['draw', '📏', 'Draw walls', 'Tap corners on the grid, type exact lengths.'],
    ['blue', '🗺️', 'Trace a blueprint or aerial', 'Photo, screenshot or PDF of a plan, survey or Google Earth.'],
    ['scan', '📱', 'iPhone LiDAR / 3D scan', 'Polycam, 3D Scanner App, RoomPlan: GLB, OBJ, PLY, USDZ.'],
    ['photo', '🌴', 'Design on a yard photo', 'Snap the yard, drop in plants, pavers, mulch, curbing.'],
    ['tpl', '🧰', 'Start from a template', 'Bedroom, kitchen, bath, 3/2 house, pool & cage.'],
  ];
  const r = await modal(isNew ? 'New project' : 'Welcome to Primus 3D', h('div', {}, isNew ? null : h('p', { class: 'muted' }, 'Design rooms, homes and yards to exact size and show customers in 3D. Free, works offline, saves on this device.'),
    h('div', { class: 'wiz' }, ...opts.map(([v, i, t, d]) => h('button', { class: 'wizb', onclick: () => closeModal(v) }, h('span', { class: 'wi' }, i), h('b', {}, t), h('small', {}, d))))), [], { wide: true });
  if (!r) return;
  if (isNew) { await saveNow(); store.load(newProject()); afterLoad(); }
  if (r === 'quick') quickRoom(); if (r === 'draw') setTool('wall'); if (r === 'blue') importBlueprint(); if (r === 'scan') importScan(); if (r === 'photo') { setView('photo'); } if (r === 'tpl') templatesMenu();
}
function help() {
  modal('How to use Primus 3D', `<ol class="help">
  <li><b>⬛ Quick room</b>: type a size like <code>12 x 14</code>. Use <code>12 6</code> for 12'6", or <code>150"</code>, or <code>3.5m</code>.</li>
  <li><b>📏 Draw walls</b>: tap corner to corner. Type an exact length in the bar and press an arrow for the direction.</li>
  <li><b>Tap anything</b> to select it. Then: drag to move, ✏️ Edit to type exact sizes, 🗑️ to delete. ↶ Undo always works.</li>
  <li><b>🚪 Doors/windows</b>: pick one, tap a wall. <b>🛋️ Add item</b>: kitchen, bath, furniture, pool, cage, pavers, palms… then drag it.</li>
  <li><b>🔷 Floor / area</b>: rooms, patios, beds, driveways. Turn on <i>Curved edges</i> for beds and <i>Curbing</i> to count linear feet.</li>
  <li><b>3D</b>: one finger turns, two fingers zoom/move. <b>Walk</b>: walk through at eye level.</li>
  <li><b>Photo</b>: design right on a picture of the customer's yard. Hold 👁️ for before/after.</li>
  <li><b>$ total</b> (bottom right): quantities are automatic; type your prices once to get an estimate and a <b>Proposal PDF</b>.</li>
  <li>Saves automatically on this device. Use ☰ → Save project file to back up or move to another device.</li></ol>
  <p class="muted">Accuracy: the drawing is exactly what you type. Scans and blueprints are only as good as their scale — always check one known length.</p>`, [{ label: 'Got it', primary: true }], { wide: true });
}

// ---------- boot ----------
function afterLoad() { setUnits(store.p.units); v3.scanKey = ''; underlay = null; plan.scanUnderlay = null; photo.open(store.p.photos[store.p.photos.length - 1] || null); setView('plan'); setTimeout(() => { plan.fit(); v3.fitView(); }, 60); renderTotals(); renderTop(); }
async function boot() {
  requestPersist();
  try { const id = await lastProjectId(); const p = id ? await loadProject(id) : null; if (p) store.load(p); } catch (e) { console.warn(e); }
  afterLoad();
  if (!store.p.walls.length && !store.p.rooms.length && !store.p.objects.length && !localStorage.getItem('p3d-welcomed')) { localStorage.setItem('p3d-welcomed', '1'); startWizard(false); }
}
// testing hook
(window as any).__p3d = { store, plan, v3, photo, addRect, setView, takeoff };
boot();
window.addEventListener('beforeunload', () => { if (store.dirty) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && store.dirty) saveNow(); });
// prevent iOS page zoom/bounce on the canvas areas
document.addEventListener('gesturestart', e => e.preventDefault());
