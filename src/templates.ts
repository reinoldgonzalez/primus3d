import { newProject, uid, Project, Wall, Room, Obj, Opening, Pt } from './model';
import { CAT_BY_KEY } from './catalog';
const IN = 0.0254, FT = 0.3048;

function box(p: Project, x: number, y: number, W: number, L: number) {
  const T = p.defaults.wallThickness; const pts: Pt[] = [{ x, y }, { x: x + W, y }, { x: x + W, y: y + L }, { x, y: y + L }]; const ids: string[] = [];
  for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; const ex = p.walls.find(w => (near(w.a, a) && near(w.b, b)) || (near(w.a, b) && near(w.b, a)));
    if (ex) { ids.push(ex.id); continue; } const w: Wall = { id: uid(), a: { ...a }, b: { ...b }, thickness: T, height: p.defaults.wallHeight, color: '#f4f1ea' }; p.walls.push(w); ids.push(w.id); }
  return ids; // top, right, bottom, left
}
const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;
function room(p: Project, name: string, x: number, y: number, W: number, L: number, floor = 'tile', outdoor = false): Room { const r: Room = { id: uid(), name, pts: [{ x, y }, { x: x + W, y }, { x: x + W, y: y + L }, { x, y: y + L }], floor, ceilingHeight: p.defaults.ceiling, showCeiling: !outdoor, outdoor }; p.rooms.push(r); return r; }
function door(p: Project, wallId: string, t: number, key = 'door-int', flip = false) { const it: any = { 'door-int': [32, 80, 'door', 'interior'], 'door-ext': [36, 80, 'door', 'exterior'], 'door-slider6': [72, 80, 'slider', 'slider'], 'door-garage2': [192, 84, 'door', 'garage'], 'win': [36, 48, 'window', 'single-hung'], 'win-pic': [72, 48, 'window', 'picture'] }[key];
  const o: Opening = { id: uid(), kind: it[2], style: it[3], wallId, t, width: it[0] * IN, height: it[1] * IN, sill: it[2] === 'window' ? (key === 'win-pic' ? 30 : 36) * IN : 0, flip, hingeRight: false }; p.openings.push(o); }
function item(p: Project, key: string, x: number, y: number, rot = 0, over: Partial<Obj> = {}) { const c = CAT_BY_KEY[key]; p.objects.push({ id: uid(), kind: key, name: c.name, x, y, w: c.w, d: c.d, h: c.h, elev: c.ceiling ? p.defaults.ceiling - c.h : (c.elev || 0), rot, color: c.color, finish: c.finish, ...over }); }

export const TEMPLATES: { name: string; icon: string; desc: string; make: () => Project }[] = [
  { name: 'Bedroom 12×14', icon: '🛏️', desc: 'Walls, door, window, queen bed, closet', make: () => { const p = newProject('Bedroom 12x14'); const W = 12 * FT, L = 14 * FT; const [t, r, b, l] = box(p, 0, 0, W, L); room(p, 'Bedroom', 0, 0, W, L, 'carpet'); door(p, b, 2.5 * FT, 'door-int', true); door(p, t, W / 2, 'win'); item(p, 'bed-q', W / 2, 40 * IN + 3, Math.PI); item(p, 'nightstand', W / 2 - 42 * IN, 12 * IN, Math.PI); item(p, 'nightstand', W / 2 + 42 * IN, 12 * IN, Math.PI); item(p, 'dresser', W - 12 * IN, L / 2, -Math.PI / 2); item(p, 'fan', W / 2, L / 2); void r; void l; return p; } },
  { name: 'Kitchen (L-shape) 12×12', icon: '🍳', desc: 'Cabinets, counters, appliances, island', make: () => { const p = newProject('Kitchen 12x12'); const W = 12 * FT; const [t, r, b, l] = box(p, 0, 0, W, W); room(p, 'Kitchen', 0, 0, W, W, 'tile'); door(p, b, W / 2, 'door-int', true); door(p, r, W / 2, 'win');
    const d = 12 * IN; item(p, 'fridge', 18 * IN + 3 * IN, 15 * IN + 3 * IN, Math.PI); item(p, 'base', 60 * IN, d + 3 * IN, Math.PI); item(p, 'range', 93 * IN, 13 * IN + 3 * IN, Math.PI); item(p, 'base', 126 * IN, d + 3 * IN, Math.PI); item(p, 'sinkbase', W - d - 3 * IN, 60 * IN, -Math.PI / 2); item(p, 'dishwasher', W - d - 3 * IN, 90 * IN, -Math.PI / 2);
    item(p, 'upper', 60 * IN, 6 * IN + 3 * IN, Math.PI); item(p, 'microwave', 93 * IN, 8 * IN + 3 * IN, Math.PI); item(p, 'upper', 126 * IN, 6 * IN + 3 * IN, Math.PI); item(p, 'island', W / 2 - 6 * IN, W / 2 + 12 * IN); void t; void l; return p; } },
  { name: 'Bathroom 5×8', icon: '🛁', desc: 'Tub, toilet, vanity', make: () => { const p = newProject('Bathroom 5x8'); const W = 5 * FT, L = 8 * FT; const [t, r, b, l] = box(p, 0, 0, W, L); room(p, 'Bath', 0, 0, W, L, 'graytile'); door(p, b, W / 2, 'door-int', true); item(p, 'tub', W / 2, 15 * IN + 3 * IN, Math.PI); item(p, 'toilet', W - 17 * IN, 60 * IN, -Math.PI / 2); item(p, 'vanity30', 13 * IN, 66 * IN, Math.PI / 2); item(p, 'mirror', 3 * IN, 66 * IN, Math.PI / 2); void t; void r; void l; return p; } },
  { name: '3 bed / 2 bath house (~1,500 sq ft)', icon: '🏠', desc: 'Simple Florida ranch layout to edit', make: () => { const p = newProject('3/2 house'); p.defaults.wallThickness = 6 * IN; const f = FT;
    const ext = box(p, 0, 0, 50 * f, 32 * f); door(p, ext[2], 25 * f, 'door-ext', false); door(p, ext[0], 25 * f, 'door-slider6', true);
    // interior
    const iw = (a: Pt, b: Pt) => { const w: Wall = { id: uid(), a, b, thickness: 4.5 * IN, height: p.defaults.wallHeight, color: '#f4f1ea' }; p.walls.push(w); return w.id; };
    const w1 = iw({ x: 14 * f, y: 0 }, { x: 14 * f, y: 32 * f }); const w2 = iw({ x: 36 * f, y: 0 }, { x: 36 * f, y: 32 * f }); const w3 = iw({ x: 0, y: 16 * f }, { x: 14 * f, y: 16 * f }); const w4 = iw({ x: 36 * f, y: 18 * f }, { x: 50 * f, y: 18 * f }); const w5 = iw({ x: 36 * f, y: 10 * f }, { x: 50 * f, y: 10 * f });
    door(p, w1, 8 * f); door(p, w1, 24 * f); door(p, w2, 5 * f, 'door-int', true); door(p, w2, 14 * f, 'door-int', true); door(p, w2, 25 * f, 'door-int', true);
    door(p, ext[3], 8 * f, 'win'); door(p, ext[3], 24 * f, 'win'); door(p, ext[1], 25 * f, 'win'); door(p, ext[1], 5 * f, 'win'); door(p, ext[2], 7 * f, 'win'); door(p, ext[2], 43 * f, 'win');
    room(p, 'Bedroom 2', 0, 0, 14 * f, 16 * f, 'carpet'); room(p, 'Bedroom 3', 0, 16 * f, 14 * f, 16 * f, 'carpet'); room(p, 'Great room / kitchen', 14 * f, 0, 22 * f, 32 * f, 'lvp'); room(p, 'Bath 2', 36 * f, 0, 14 * f, 10 * f, 'graytile'); room(p, 'Primary bath', 36 * f, 10 * f, 14 * f, 8 * f, 'graytile'); room(p, 'Primary bedroom', 36 * f, 18 * f, 14 * f, 14 * f, 'carpet');
    item(p, 'island', 25 * f, 10 * f); item(p, 'sofa', 25 * f, 24 * f); item(p, 'bed-k', 43 * f, 28 * f, 0); item(p, 'bed-q', 7 * f, 4 * f, Math.PI); item(p, 'bed-q', 7 * f, 28 * f, 0); return p; } },
  { name: 'Backyard: pool, cage & pavers', icon: '🏊', desc: 'Pool 14×28, screen cage, pavers, palms, lanai', make: () => { const p = newProject('Pool & cage'); const f = FT;
    const ext = box(p, 0, 0, 50 * f, 30 * f); door(p, ext[2], 25 * f, 'door-slider6', true); room(p, 'House', 0, 0, 50 * f, 30 * f, 'tile');
    room(p, 'Paver deck', 6 * f, 30 * f, 38 * f, 34 * f, 'pavers', true); item(p, 'pool-rect', 25 * f, 50 * f, Math.PI / 2); item(p, 'cage', 25 * f, 47 * f, 0, { w: 38 * f, d: 34 * f });
    item(p, 'lanai', 25 * f, 36 * f, 0, { w: 20 * f, d: 12 * f }); const bed = room(p, 'Planting bed', 46 * f, 32 * f, 6 * f, 30 * f, 'mulch', true); bed.smooth = true; bed.curb = true;
    item(p, 'palm', 49 * f, 36 * f); item(p, 'palm', 49 * f, 56 * f); item(p, 'shrub', 48 * f, 46 * f); item(p, 'lounger', 14 * f, 58 * f); item(p, 'lounger', 18 * f, 58 * f); item(p, 'ac', -3 * f, 10 * f);
    room(p, 'Lawn', -10 * f, 30 * f, 16 * f, 34 * f, 'grass', true); return p; } },
];
