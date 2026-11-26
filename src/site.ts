/** Lot lines, setbacks and "start from address" (free sources only, no API keys). */
import { Project, Pt, dist, roomOutline, objCorners } from './model';
import { fmtLen } from './units';

const R = 6378137, D2R = Math.PI / 180;
export function toLocal(lat: number, lon: number, lat0: number, lon0: number): Pt { return { x: (lon - lon0) * D2R * R * Math.cos(lat0 * D2R), y: -(lat - lat0) * D2R * R }; }

export interface GeoHit { lat: number; lon: number; label: string }
/** OpenStreetMap Nominatim (free, no key; light use only, attribution required). */
export async function geocode(q: string): Promise<GeoHit | null> {
  const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&addressdetails=0&q=' + encodeURIComponent(q);
  const r = await fetch(u, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('Address search failed (' + r.status + ')');
  const j = await r.json(); if (!j.length) return null; return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name };
}
/** Lee County Property Appraiser public parcel map (Cape Coral / Fort Myers area). Returns ring in lat/lon or null. */
export async function leeParcel(lat: number, lon: number): Promise<{ ring: [number, number][]; id: string; area: string } | null> {
  const base = 'https://gissvr.leepa.org/gissvr/rest/services/ParcelsWFS/MapServer/0/query?f=json&returnGeometry=true&outSR=4326&inSR=4326&outFields=Name,StatedArea&spatialRel=esriSpatialRelIntersects';
  const q = async (geom: string, type: string) => { const r = await fetch(base + '&geometryType=' + type + '&geometry=' + encodeURIComponent(geom)); if (!r.ok) return []; const j = await r.json(); return (j.features || []) as any[]; };
  let fs = await q(`${lon},${lat}`, 'esriGeometryPoint');
  if (!fs.length) { const d = 0.00025; fs = await q(`${lon - d},${lat - d},${lon + d},${lat + d}`, 'esriGeometryEnvelope'); }
  if (!fs.length) return null;
  // nearest parcel centroid to the point
  let best: any = null, bd = Infinity; for (const f of fs) { const ring = f.geometry?.rings?.[0]; if (!ring) continue; const cx = ring.reduce((s: number, p: number[]) => s + p[0], 0) / ring.length, cy = ring.reduce((s: number, p: number[]) => s + p[1], 0) / ring.length; const d = (cx - lon) ** 2 + (cy - lat) ** 2; if (d < bd) { bd = d; best = f; } }
  return best ? { ring: best.geometry.rings[0], id: best.attributes?.Name || '', area: best.attributes?.StatedArea || '' } : null;
}
/** Free aerial sources that allow business use (checked Nov 2026):
 *  - FDOT statewide orthophotos (Florida public record, 3–6 in pixels; Lee County flown 2020), served by FL DEP.
 *  - USGS NAIP (public domain, 0.6 m, newer), USGS National Map imagery (public domain, ~1 m) as last resort.
 *  NOT used: Lee County / LeePA 3-inch aerials ("personal, non-business use" only), Esri/Google/Mapbox (need an API key and forbid storing images). */
export interface AerialSource { id: string; label: string; url: string; kind: 'image' | 'map'; mpp: number }
export const AERIALS: AerialSource[] = [
  { id: 'fdot2021', label: 'FDOT 2021 (sharp)', url: 'https://ca.dep.state.fl.us/image/rest/services/FDOT_Yearly_Aerials/Aerial_Imagery_2021/ImageServer', kind: 'image', mpp: 0.08 },
  { id: 'fdot2020', label: 'FDOT 2020 (sharp)', url: 'https://ca.dep.state.fl.us/image/rest/services/FDOT_Yearly_Aerials/Aerial_Imagery_2020/ImageServer', kind: 'image', mpp: 0.08 },
  { id: 'fdot2019', label: 'FDOT 2019 (sharp)', url: 'https://ca.dep.state.fl.us/image/rest/services/FDOT_Yearly_Aerials/Aerial_Imagery_2019/ImageServer', kind: 'image', mpp: 0.08 },
  { id: 'fdot2018', label: 'FDOT 2018 (sharp)', url: 'https://ca.dep.state.fl.us/image/rest/services/FDOT_Yearly_Aerials/Aerial_Imagery_2018/ImageServer', kind: 'image', mpp: 0.08 },
  { id: 'naip', label: 'USGS NAIP (newer, 2 ft)', url: 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer', kind: 'image', mpp: 0.3 },
  { id: 'usgs', label: 'USGS basic (3 ft)', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer', kind: 'map', mpp: 0.5 },
];
async function blank(b: Blob) { // a source with no coverage returns a flat image
  const bm = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(bm, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data; let s = 0, s2 = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; s += v; s2 += v * v; } const sd = Math.sqrt(s2 / n - (s / n) ** 2); return sd < 6; }
/** Square aerial of `size` m around the point at the source's full detail (≤ 4000 px). Tries sources in order until one has coverage. */
export async function aerialImage(lat: number, lon: number, size: number, prefer?: string): Promise<{ blob: Blob; px: number; src: AerialSource }> {
  const mx = lon * D2R * R, my = Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) * R; const half = size / 2 / Math.cos(lat * D2R);
  const order = prefer ? [...AERIALS.filter(a => a.id === prefer), ...AERIALS.filter(a => a.id !== prefer)] : AERIALS;
  for (const a of order) {
    const px = Math.min(4000, Math.max(800, Math.round(size / a.mpp)));
    const u = `${a.url}/${a.kind === 'image' ? 'exportImage' : 'export'}?bbox=${mx - half},${my - half},${mx + half},${my + half}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=jpg&f=image`;
    try { const r = await fetch(u); if (!r.ok) continue; const b = await r.blob(); if (!b.type.startsWith('image') || await blank(b)) continue; return { blob: b, px, src: a }; } catch (e) { console.warn(a.id, e); }
  }
  throw new Error('No aerial available here');
}
/** Old name kept for callers. */
export async function usgsImage(lat: number, lon: number, size: number, px = 1024): Promise<Blob> { void px; return (await aerialImage(lat, lon, size, 'usgs')).blob; }

/** "13 Northwest 36th Avenue" → "13 NW 36TH AVE" (Lee County address style). */
export function leeStreet(q: string): string {
  const A: Record<string, string> = { NORTHWEST: 'NW', NORTHEAST: 'NE', SOUTHWEST: 'SW', SOUTHEAST: 'SE', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', AVENUE: 'AVE', STREET: 'ST', TERRACE: 'TER', PARKWAY: 'PKWY', BOULEVARD: 'BLVD', COURT: 'CT', PLACE: 'PL', LANE: 'LN', ROAD: 'RD', DRIVE: 'DR', CIRCLE: 'CIR', WAY: 'WAY', LOOP: 'LOOP', TRAIL: 'TRL', HIGHWAY: 'HWY', COVE: 'CV', POINT: 'PT', ISLE: 'ISLE' };
  return q.split(',')[0].toUpperCase().replace(/[.#]/g, ' ').replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1$2').split(/\s+/).filter(Boolean).map(w => A[w] || w).join(' ').replace(/\b(\d+)\b(?= (AVE|ST|TER|PL|CT|LN|RD|DR)\b)/g, (m, n) => n + (/1[123]$/.test(n) ? 'TH' : n.endsWith('1') ? 'ST' : n.endsWith('2') ? 'ND' : n.endsWith('3') ? 'RD' : 'TH'));
}
/** Exact parcel number from the typed address (Lee County footprints carry the site address). */
export async function leeStrapByAddress(q: string): Promise<string | null> {
  const st = leeStreet(q); if (!/^\d+ /.test(st)) return null;
  const u = 'https://services2.arcgis.com/LvWGAAhHwbCJ2GMP/arcgis/rest/services/Building_Footprints/FeatureServer/0/query?f=json&returnGeometry=false&outFields=STRAP,StreetAddress&where=' + encodeURIComponent(`StreetAddress='${st.replace(/'/g, '')}'`);
  const r = await fetch(u); if (!r.ok) return null; const j = await r.json(); return j.features?.[0]?.attributes?.STRAP || null;
}
export async function leeParcelByStrap(strap: string): Promise<{ ring: [number, number][]; id: string; area: string } | null> {
  const u = 'https://gissvr.leepa.org/gissvr/rest/services/ParcelsWFS/MapServer/0/query?f=json&returnGeometry=true&outSR=4326&outFields=Name,StatedArea&where=' + encodeURIComponent(`Name='${strap.replace(/'/g, '')}'`);
  const r = await fetch(u); if (!r.ok) return null; const j = await r.json(); const f = j.features?.[0]; return f?.geometry?.rings?.[0] ? { ring: f.geometry.rings[0], id: f.attributes?.Name || strap, area: f.attributes?.StatedArea || '' } : null;
}
/** Lee County GIS building footprints (from the Property Appraiser; public information resource). Rings in lat/lon. */
export async function leeBuildings(strap: string, lat: number, lon: number): Promise<{ ring: [number, number][]; info: any }[]> {
  const base = 'https://services2.arcgis.com/LvWGAAhHwbCJ2GMP/arcgis/rest/services/Building_Footprints/FeatureServer/0/query?f=json&returnGeometry=true&outSR=4326&outFields=STRAP,BldgDescription,MaxStories,ActualArea,ActualYearBuilt,StreetAddress,BldgUseType';
  let u = base + (strap ? '&where=' + encodeURIComponent(`STRAP='${strap.replace(/'/g, '')}'`) : `&where=1%3D1&inSR=4326&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&geometry=${lon},${lat}`);
  let r = await fetch(u); let j = r.ok ? await r.json() : {}; let fs: any[] = j.features || [];
  if (!fs.length && strap) { u = base + `&where=1%3D1&inSR=4326&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&geometry=${lon},${lat}`; r = await fetch(u); j = r.ok ? await r.json() : {}; fs = j.features || []; }
  return fs.filter(f => f.geometry?.rings?.[0]).map(f => ({ ring: f.geometry.rings[0], info: f.attributes }));
}

// ---------- setbacks ----------
export interface Setback { edge: number; from: Pt; to: Pt; d: number; what: string }
function structurePts(P: Project) {
  const groups: { what: string; pts: Pt[] }[] = [];
  const house: Pt[] = []; for (const w of P.walls) { const n = Math.max(2, Math.ceil(dist(w.a, w.b) / 0.5)); for (let i = 0; i <= n; i++) house.push({ x: w.a.x + (w.b.x - w.a.x) * i / n, y: w.a.y + (w.b.y - w.a.y) * i / n }); }
  for (const r of P.rooms) if (!r.outdoor) house.push(...roomOutline(r));
  if (house.length) groups.push({ what: 'House', pts: house });
  const kinds: [RegExp, string][] = [[/^pool/, 'Pool (water edge)'], [/^cage$/, 'Screen cage'], [/^(shed|lanai|pergola)/, 'Accessory'], [/^(ac|generator|pad)$/, 'Equipment']];
  for (const [re, what] of kinds) { const pts = P.objects.filter(o => re.test(o.kind)).flatMap(o => objCorners(o)); if (pts.length) groups.push({ what, pts }); }
  return groups;
}
export function setbacks(P: Project): Setback[] {
  const L = P.lot; if (!L || L.length < 3) return []; const out: Setback[] = [];
  for (const g of structurePts(P)) for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length]; const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy; let best: Setback | null = null;
    for (const p of g.pts) { const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; if (u < 0 || u > 1) continue; const q = { x: a.x + dx * u, y: a.y + dy * u }; const d = dist(p, q); if (!best || d < best.d) best = { edge: i, from: p, to: q, d, what: g.what }; }
    if (best) out.push(best);
  }
  // keep, per group, only the edges where this group is the closest structure and is reasonably near (avoids clutter)
  return out.filter(s => s.d < 60);
}
export function edgeName(P: Project, i: number) { const n = P.lot?.length || 0; const f = (P as any).lotFront ?? 0; if (i === f) return 'Front'; const opp = (f + Math.round(n / 2)) % n; if (n === 4 && i === opp) return 'Rear'; return 'Side'; }

export function drawSite(c: CanvasRenderingContext2D, P: Project, px: number, dims: boolean, print = false) {
  const L = P.lot; if (!L || L.length < 3) return;
  c.save(); c.strokeStyle = print ? '#000' : '#2f9e44'; c.lineWidth = 2.2 * px; c.setLineDash([14 * px, 5 * px, 3 * px, 5 * px]);
  c.beginPath(); L.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.stroke(); c.setLineDash([]);
  // lot edge lengths (outside)
  const cx = L.reduce((s, p) => s + p.x, 0) / L.length, cy = L.reduce((s, p) => s + p.y, 0) / L.length;
  c.font = `600 ${11 * px}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const len = dist(a, b); if (len < 1 || len / px < 90) continue; let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len; if (nx * (m.x - cx) + ny * (m.y - cy) < 0) { nx = -nx; ny = -ny; }
    const t = `${edgeName(P, i).toUpperCase()} ${fmtLen(len, { short: true })}`; const q = { x: m.x + nx * 14 * px, y: m.y + ny * 14 * px }; let ang = Math.atan2(b.y - a.y, b.x - a.x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    c.save(); c.translate(q.x, q.y); c.rotate(ang); c.fillStyle = print ? '#000' : '#2b8a3e'; c.fillText(t, 0, 0); c.restore(); }
  if (dims) for (const s of setbacks(P)) {
    c.strokeStyle = print ? '#000' : '#e8590c'; c.fillStyle = c.strokeStyle; c.lineWidth = 1.2 * px; c.setLineDash([5 * px, 3 * px]); c.beginPath(); c.moveTo(s.from.x, s.from.y); c.lineTo(s.to.x, s.to.y); c.stroke(); c.setLineDash([]);
    for (const p of [s.from, s.to]) { c.beginPath(); c.arc(p.x, p.y, 2.5 * px, 0, 7); c.fill(); }
    const m = { x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 }; const t = `${fmtLen(s.d, { short: true })}`; c.font = `700 ${11 * px}px system-ui, sans-serif`; const w = c.measureText(t).width + 8 * px;
    c.fillStyle = 'rgba(255,255,255,0.92)'; c.fillRect(m.x - w / 2, m.y - 8 * px, w, 16 * px); c.fillStyle = print ? '#000' : '#d9480f'; c.fillText(t, m.x, m.y);
  }
  c.restore();
}
export function lotArea(L: Pt[]) { let s = 0; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
