import { Project, wallDir, wallLen, roomOutline, objCorners } from './model';
// Minimal AutoCAD R12 DXF. Units: inches. Y is flipped so the plan reads the same way up.
export function exportDXF(P: Project): Blob {
  const K = 1 / 0.0254; const out: string[] = [];
  const g = (c: number, v: string | number) => out.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$INSUNITS'); g(70, 1); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => { g(0, 'LINE'); g(8, layer); g(10, (x1 * K).toFixed(3)); g(20, (-y1 * K).toFixed(3)); g(30, 0); g(11, (x2 * K).toFixed(3)); g(21, (-y2 * K).toFixed(3)); g(31, 0); };
  const poly = (layer: string, pts: { x: number; y: number }[]) => { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; line(layer, a.x, a.y, b.x, b.y); } };
  const text = (layer: string, x: number, y: number, hgt: number, s: string) => { g(0, 'TEXT'); g(8, layer); g(10, (x * K).toFixed(3)); g(20, (-y * K).toFixed(3)); g(30, 0); g(40, hgt.toFixed(2)); g(1, s); };
  for (const w of P.walls) { const d = wallDir(w), n = { x: -d.y, y: d.x }, t = w.thickness / 2; line('WALLS', w.a.x + n.x * t, w.a.y + n.y * t, w.b.x + n.x * t, w.b.y + n.y * t); line('WALLS', w.a.x - n.x * t, w.a.y - n.y * t, w.b.x - n.x * t, w.b.y - n.y * t); line('WALL_CENTER', w.a.x, w.a.y, w.b.x, w.b.y); void wallLen; }
  for (const o of P.openings) { const w = P.walls.find(x => x.id === o.wallId); if (!w) continue; const d = wallDir(w); const c = { x: w.a.x + d.x * o.t, y: w.a.y + d.y * o.t }; line(o.kind === 'window' ? 'WINDOWS' : 'DOORS', c.x - d.x * o.width / 2, c.y - d.y * o.width / 2, c.x + d.x * o.width / 2, c.y + d.y * o.width / 2); }
  for (const r of P.rooms) { const ol = roomOutline(r); poly(r.outdoor ? 'AREAS' : 'ROOMS', ol); const cx = ol.reduce((s, p) => s + p.x, 0) / ol.length, cy = ol.reduce((s, p) => s + p.y, 0) / ol.length; text('LABELS', cx, cy, 6, r.name); }
  for (const o of P.objects) poly('ITEMS', objCorners(o));
  g(0, 'ENDSEC'); g(0, 'EOF');
  return new Blob([out.join('\n')], { type: 'application/dxf' });
}
