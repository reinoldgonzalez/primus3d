/**
 * Blueprint auto-convert (free, runs fully in the browser, no cloud vision API).
 * Classic computer vision written in plain TypeScript (same steps as an OpenCV pipeline, without the 8 MB download):
 *   threshold (Otsu) → morphology (opening) → long horizontal/vertical line extraction (snapped to 90°)
 *   → thick strokes and parallel line pairs become walls with thickness → gaps become doors, glazed gaps windows
 *   → closed loops become rooms → OCR (tesseract.js, Apache-2.0) reads dimension strings for the scale and room names.
 * All coordinates returned are in ORIGINAL image pixels.
 */
export interface DWall { a: { x: number; y: number }; b: { x: number; y: number }; t: number; ext: boolean }
export interface DOpening { wall: number; at: number; w: number; kind: 'door' | 'window' | 'opening'; style: string; flip: boolean; hingeRight: boolean }
export interface DRoom { pts: { x: number; y: number }[]; name: string }
export interface DDim { text: string; m: number; x0: number; y0: number; x1: number; y1: number; px?: number }
export interface Detection {
  w: number; h: number; walls: DWall[]; openings: DOpening[]; rooms: DRoom[];
  mpp: number; scaleFrom: 'ocr' | 'guess'; scaleNote: string; dims: DDim[]; longestDim: DDim | null; ocrOk: boolean; words: OcrWord[]; ms: number;
}
export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; line: number; conf: number }
type Seg = { o: 'h' | 'v'; c: number; a: number; b: number; t: number; src: 'thick' | 'pair' | 'thin'; glazed?: [number, number][] };

const FT = 0.3048, IN = 0.0254;

// ---------------- image helpers ----------------
export function canvasFrom(img: CanvasImageSource & { width: number; height: number }, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
  const c = cv.getContext('2d', { willReadFrequently: true })!; c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(img, 0, 0, cv.width, cv.height);
  return { cv, k };
}
function grayOf(cv: HTMLCanvasElement) {
  const d = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height).data; const g = new Uint8Array(cv.width * cv.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return g;
}
function otsu(g: Uint8Array) {
  const hist = new Float64Array(256); for (const v of g) hist[v]++; const n = g.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128; for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = i; } }
  return Math.min(th, 200);
}
/** Is this image a drawing (plan/survey) rather than a photo? Plans are mostly white paper with dark lines and little color. */
export function looksLikePlan(cv: HTMLCanvasElement): { plan: boolean; white: number; sat: number; lines: number } {
  const { cv: s } = canvasFrom(cv, 400); const d = s.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, s.width, s.height).data;
  let white = 0, sat = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mn > 215) white++; sat += mx ? (mx - mn) / mx : 0; }
  const lines = lineDensity(s); white /= n; sat /= n;
  return { plan: (white > 0.55 && sat < 0.18) || (white > 0.35 && sat < 0.1 && lines > 0.01), white, sat, lines };
}
/** Fraction of pixels on long horizontal/vertical dark runs. Used to pick the floor-plan page of a PDF set. */
export function lineDensity(cv: HTMLCanvasElement): number {
  const { cv: s } = canvasFrom(cv, 900); const g = grayOf(s); const W = s.width, H = s.height; const t = otsu(g); const L = Math.max(10, Math.round(Math.max(W, H) * 0.03));
  let on = 0;
  for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x <= W; x++) { const dk = x < W && g[y * W + x] < t; if (dk) run++; else { if (run >= L) on += run; run = 0; } } }
  for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y <= H; y++) { const dk = y < H && g[y * W + x] < t; if (dk) run++; else { if (run >= L) on += run; run = 0; } } }
  // penalise pages that are mostly text (many short runs, few long)
  return on / (W * H);
}

/** Clean the sheet before reading it: invert blueprints (light lines on dark), flatten yellowed paper, shadows and uneven light. */
export function prepare(src: HTMLCanvasElement): { cv: HTMLCanvasElement; notes: string[] } {
  const W = src.width, H = src.height; const g = grayOf(src); const notes: string[] = []; const n = W * H;
  let sum = 0; for (let i = 0; i < n; i++) sum += g[i];
  if (sum / n < 110) { for (let i = 0; i < n; i++) g[i] = 255 - g[i]; notes.push('inverted'); }
  const f = Math.max(1, Math.round(Math.max(W, H) / 300)); const w = Math.ceil(W / f), h = Math.ceil(H / f); const sm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0, c = 0; for (let yy = y * f; yy < Math.min(H, y * f + f); yy++) for (let xx = x * f; xx < Math.min(W, x * f + f); xx++) { m += g[yy * W + xx]; c++; } sm[y * w + x] = m / c; }
  const r = Math.max(2, Math.round(Math.max(w, h) / 40)); const mx = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let q = Math.max(0, x - r); q <= Math.min(w - 1, x + r); q++) m = Math.max(m, sm[y * w + q]); tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let q = Math.max(0, y - r); q <= Math.min(h - 1, y + r); q++) m = Math.max(m, tmp[q * w + x]); mx[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0, c = 0; for (let q = Math.max(0, x - r); q <= Math.min(w - 1, x + r); q++) { m += mx[y * w + q]; c++; } tmp[y * w + x] = m / c; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0, c = 0; for (let q = Math.max(0, y - r); q <= Math.min(h - 1, y + r); q++) { m += tmp[q * w + x]; c++; } mx[y * w + x] = m / c; }
  let bsum = 0, bmin = 255; for (const v of mx) { bsum += v; bmin = Math.min(bmin, v); } const bmean = bsum / mx.length;
  const flatten = bmean < 238 || bmin < 200;
  if (!flatten && !notes.length) return { cv: src, notes };
  if (flatten) notes.push('flattened');
  const out = document.createElement('canvas'); out.width = W; out.height = H; const oc = out.getContext('2d', { willReadFrequently: true })!; const od = oc.createImageData(W, H);
  for (let y = 0; y < H; y++) { const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / f - 0.5)); const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) { const i = y * W + x; let v = g[i];
      if (flatten) { const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / f - 0.5)); const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
        const b = (mx[y0 * w + x0] * (1 - fx) + mx[y0 * w + x1] * fx) * (1 - fy) + (mx[y1 * w + x0] * (1 - fx) + mx[y1 * w + x1] * fx) * fy; v = Math.min(255, (v * 255) / Math.max(30, b)); }
      od.data[i * 4] = od.data[i * 4 + 1] = od.data[i * 4 + 2] = v; od.data[i * 4 + 3] = 255; } }
  oc.putImageData(od, 0, 0); return { cv: out, notes };
}

// ---------------- morphology ----------------
function integral(m: Uint8Array, W: number, H: number) { const I = new Uint32Array((W + 1) * (H + 1)); for (let y = 0; y < H; y++) { let r = 0; for (let x = 0; x < W; x++) { r += m[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + r; } } return I; }
const box = (I: Uint32Array, W: number, x0: number, y0: number, x1: number, y1: number) => I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
function open(m: Uint8Array, W: number, H: number, k: number) {
  const I = integral(m, W, H); const E = new Uint8Array(W * H); const kk = k * k;
  for (let y = 0; y + k <= H; y++) for (let x = 0; x + k <= W; x++) if (box(I, W, x, y, x + k, y + k) === kk) E[y * W + x] = 1;
  const J = integral(E, W, H); const O = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!m[y * W + x]) continue; const x0 = Math.max(0, x - k + 1), y0 = Math.max(0, y - k + 1); if (box(J, W, x0, y0, x + 1, y + 1) > 0) O[y * W + x] = 1; }
  return O;
}
function erode(m: Uint8Array, W: number, H: number, r: number) { const inv = new Uint8Array(W * H); for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1; const d = dilate(inv, W, H, r); for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1; return d; }
function dilate(m: Uint8Array, W: number, H: number, r: number) { const I = integral(m, W, H); const O = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1); if (box(I, W, x0, y0, x1, y1) > 0) O[y * W + x] = 1; } return O; }

/** Typical thin-line width: the most common short dark run length. */
function lineWidth(m: Uint8Array, W: number, H: number) {
  const hist = new Uint32Array(40);
  for (let y = 0; y < H; y += 2) { let r = 0; for (let x = 0; x <= W; x++) { if (x < W && m[y * W + x]) r++; else { if (r && r < 40) hist[r]++; r = 0; } } }
  for (let x = 0; x < W; x += 2) { let r = 0; for (let y = 0; y <= H; y++) { if (y < H && m[y * W + x]) r++; else { if (r && r < 40) hist[r]++; r = 0; } } }
  let best = 1; for (let i = 1; i < 40; i++) if (hist[i] > hist[best]) best = i; return Math.max(1, Math.min(6, best));
}

/** Long runs along one axis grouped into straight segments (90° only). */
function extract(m: Uint8Array, W: number, H: number, o: 'h' | 'v', Lmin: number, bridge: number): { c: number; a: number; b: number; t: number }[] {
  const N = o === 'h' ? H : W, M = o === 'h' ? W : H; const at = o === 'h' ? (i: number, j: number) => m[i * W + j] : (i: number, j: number) => m[j * W + i];
  type Run = { i: number; a: number; b: number; g: number };
  const rows: Run[][] = []; const runs: Run[] = [];
  for (let i = 0; i < N; i++) {
    const list: Run[] = []; let s = -1, gap = 0, last = -1;
    for (let j = 0; j <= M; j++) {
      const on = j < M && at(i, j);
      if (on) { if (s < 0) s = j; last = j; gap = 0; }
      else if (s >= 0) { gap++; if (gap > bridge || j === M) { if (last - s + 1 >= Lmin) { const r = { i, a: s, b: last, g: -1 }; list.push(r); runs.push(r); } s = -1; gap = 0; } }
    }
    rows.push(list);
  }
  // union-find across consecutive rows
  const par: number[] = runs.map((_, k) => k); const idx = new Map<Run, number>(); runs.forEach((r, k) => idx.set(r, k));
  const find = (k: number): number => (par[k] === k ? k : (par[k] = find(par[k])));
  for (let i = 1; i < N; i++) { const A = rows[i - 1], B = rows[i]; let p = 0;
    for (const r of B) { while (p < A.length && A[p].b < r.a) p++; for (let q = p; q < A.length && A[q].a <= r.b; q++) { const ov = Math.min(A[q].b, r.b) - Math.max(A[q].a, r.a); const sh = Math.min(A[q].b - A[q].a, r.b - r.a), lo = Math.max(A[q].b - A[q].a, r.b - r.a); if (ov >= 0.5 * sh && (bridge > 1 || sh >= 0.2 * lo)) par[find(idx.get(r)!)] = find(idx.get(A[q])!); } } }
  const groups = new Map<number, Run[]>(); runs.forEach((r, k) => { const g = find(k); (groups.get(g) || groups.set(g, []).get(g)!).push(r); });
  const out: { c: number; a: number; b: number; t: number }[] = [];
  const med = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  for (const g of groups.values()) {
    let i0 = Infinity, i1 = -Infinity; for (const r of g) { i0 = Math.min(i0, r.i); i1 = Math.max(i1, r.i); }
    // extent = positions covered by enough rows (robust to rows that are split into several runs)
    let a0 = Infinity, b0 = -Infinity; for (const r of g) { a0 = Math.min(a0, r.a); b0 = Math.max(b0, r.b); }
    const cov = new Uint16Array(b0 - a0 + 1); for (const r of g) for (let q = r.a; q <= r.b; q++) cov[q - a0]++;
    const need = Math.max(1, Math.floor(0.4 * (i1 - i0 + 1))); let fa = -1, fb = -1; for (let q = 0; q < cov.length; q++) if (cov[q] >= need) { if (fa < 0) fa = q; fb = q; }
    if (fa < 0) continue; void med;
    out.push({ c: (i0 + i1) / 2, a: a0 + fa, b: a0 + fb + 1, t: i1 - i0 + 1 });
  }
  return out;
}

// ---------------- OCR ----------------
let ocrWorker: any = null;
export async function ocr(cv: HTMLCanvasElement, onProgress?: (s: string) => void): Promise<OcrWord[]> {
  const T: any = await import('tesseract.js');
  if (!ocrWorker) {
    onProgress?.('Loading text reader (first time only)…');
    ocrWorker = await T.createWorker('eng', 1, { logger: (m: any) => { if (m.status === 'recognizing text') onProgress?.(`Reading text ${Math.round(m.progress * 100)}%`); } });
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
  }
  const { data } = await ocrWorker.recognize(cv, {}, { blocks: true });
  const words: OcrWord[] = []; let ln = 0;
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) { ln++; for (const w of l.words || []) { const t = (w.text || '').trim(); if (!t) continue; words.push({ text: t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, line: ln, conf: w.confidence }); } }
  return words;
}
/** "12'-6"", "12' 6", "12'6 1/2"", "40'", "3.5m", "3500mm" → meters */
export function parseDim(s: string): number | null {
  const t = s.replace(/[’′`´]/g, "'").replace(/[”″]|''/g, '"').replace(/\s+/g, ' ').trim();
  let m = t.match(/^(\d{1,3})\s*'\s*-?\s*(\d{1,2})?(?:\s+(\d{1,2})\/(\d{1,2}))?\s*"?$/);
  if (m) { const ft = +m[1], inch = m[2] ? +m[2] : 0, fr = m[3] ? +m[3] / +m[4] : 0; if (inch >= 12) return null; return ft * FT + (inch + fr) * IN; }
  m = t.match(/^(\d{1,3})\s*-\s*(\d{1,2})\s*"$/); if (m && +m[2] < 12) return +m[1] * FT + +m[2] * IN; // apostrophe lost by OCR: 14-0"
  m = t.match(/^(\d{1,3}(?:\.\d+)?)\s*m$/i); if (m) return +m[1];
  m = t.match(/^(\d{3,5})\s*mm$/i); if (m) return +m[1] / 1000;
  return null;
}
function dimsFromWords(words: OcrWord[]): DDim[] {
  const out: DDim[] = []; const byLine = new Map<number, OcrWord[]>(); words.forEach(w => (byLine.get(w.line) || byLine.set(w.line, []).get(w.line)!).push(w));
  for (const ws of byLine.values()) {
    ws.sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < ws.length; i++) for (let n = 1; n <= 3 && i + n <= ws.length; n++) { // join up to 3 neighbouring words ("12'" "-" "6"")
      const g = ws.slice(i, i + n); if (n > 1 && g.some((w, k) => k && w.x0 - g[k - 1].x1 > (w.y1 - w.y0) * 1.2)) break;
      const txt = g.map(w => w.text).join(n > 1 ? ' ' : ''); const v = parseDim(txt) ?? parseDim(g.map(w => w.text).join(''));
      if (v && v > 0.5) { out.push({ text: txt, m: v, x0: g[0].x0, y0: Math.min(...g.map(w => w.y0)), x1: g[g.length - 1].x1, y1: Math.max(...g.map(w => w.y1)) }); i += n - 1; break; }
    }
  }
  return out;
}

/** White-out long lines and walls so the text reader only sees text (big accuracy gain on drawings). */
function cleanForOcr(cv: HTMLCanvasElement, D: Uint8Array, segs: Seg[], W: number, H: number, Lmin: number) {
  const out = document.createElement('canvas'); out.width = W; out.height = H; const c = out.getContext('2d')!; c.drawImage(cv, 0, 0);
  const id = c.getImageData(0, 0, W, H); const kill = new Uint8Array(W * H); const L = Math.round(Lmin * 2.2);
  for (let y = 0; y < H; y++) { let s = -1; for (let x = 0; x <= W; x++) { const on = x < W && D[y * W + x]; if (on && s < 0) s = x; else if (!on && s >= 0) { if (x - s >= L) for (let q = s; q < x; q++) kill[y * W + q] = 1; s = -1; } } }
  for (let x = 0; x < W; x++) { let s = -1; for (let y = 0; y <= H; y++) { const on = y < H && D[y * W + x]; if (on && s < 0) s = y; else if (!on && s >= 0) { if (y - s >= L) for (let q = s; q < y; q++) kill[q * W + x] = 1; s = -1; } } }
  const K = dilate(kill, W, H, 1);
  for (let i = 0; i < K.length; i++) if (K[i]) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; }
  c.putImageData(id, 0, 0); c.fillStyle = '#fff';
  for (const s of segs) { const ht = s.t / 2 + 2; if (s.o === 'h') c.fillRect(s.a - 2, s.c - ht, s.b - s.a + 4, 2 * ht); else c.fillRect(s.c - ht, s.a - 2, 2 * ht, s.b - s.a + 4); }
  return out;
}

// ---------------- main ----------------
export async function analyze(img: CanvasImageSource & { width: number; height: number }, opts: { onProgress?: (s: string) => void; useOcr?: boolean; forceMpp?: number; forceNote?: string; words?: OcrWord[] } = {}): Promise<Detection> {
  const t0 = performance.now(); const say = opts.onProgress || (() => {});
  const { cv, k } = canvasFrom(img, 2200); const W = cv.width, H = cv.height; const maxD = Math.max(W, H);
  say('Finding lines…'); await new Promise(r => setTimeout(r, 0));
  const g = grayOf(cv); const th = otsu(g); const D = new Uint8Array(W * H); for (let i = 0; i < g.length; i++) D[i] = g[i] <= th ? 1 : 0;
  const lw = lineWidth(D, W, H); const Lmin = Math.max(12, Math.round(maxD * 0.011));
  // 1) thick strokes (solid / poché walls): morphological opening removes thin lines and text
  const O = open(D, W, H, lw + 2);
  const segs: Seg[] = [];
  for (const o of ['h', 'v'] as const) for (const s of extract(O, W, H, o, Lmin, 1)) if (s.t >= lw + 2 && s.b - s.a >= Math.max(Lmin, 1.5 * s.t)) segs.push({ o, ...s, src: 'thick' });
  // 1b) hatched / patterned walls (two outlines with hatching between): close small gaps, keep bands whose two edges are continuous lines
  { const Cl = erode(dilate(D, W, H, 2), W, H, 2); const O2 = open(Cl, W, H, lw + 3);
    const edgeCov = (o: 'h' | 'v', c: number, a: number, b: number) => { let n = 0, on = 0; for (let q = Math.ceil(a); q <= b; q += 1) { n++; let dk = 0; for (let e = -1; e <= 1; e++) { const cc = Math.round(c) + e; dk |= o === 'h' ? (cc >= 0 && cc < H ? D[cc * W + q] : 0) : (cc >= 0 && cc < W ? D[q * W + cc] : 0); } on += dk; } return n ? on / n : 0; };
    for (const o of ['h', 'v'] as const) for (const s of extract(O2, W, H, o, Lmin, 1)) {
      if (s.t < lw + 3 || s.t > maxD * 0.03 || s.b - s.a < Math.max(2 * Lmin, 2 * s.t)) continue;
      if (segs.some(q => q.o === o && Math.abs(q.c - s.c) < (q.t + s.t) / 2 && Math.min(q.b, s.b) - Math.max(q.a, s.a) > 0.5 * (s.b - s.a))) continue;
      const e1 = edgeCov(o, s.c - s.t / 2 + 1, s.a, s.b), e2 = edgeCov(o, s.c + s.t / 2 - 1, s.a, s.b);
      if (e1 > 0.8 && e2 > 0.8) segs.push({ o, ...s, src: 'thick' });
    } }
  // 2) thin lines (double-line walls, glazing, dimension lines)
  const Od = dilate(O, W, H, 1); const Tm = new Uint8Array(W * H); for (let i = 0; i < Tm.length; i++) Tm[i] = D[i] && !Od[i] ? 1 : 0;
  const thin: Seg[] = []; for (const o of ['h', 'v'] as const) for (const s of extract(Tm, W, H, o, Lmin, 2)) if (s.t <= lw * 2 + 1) thin.push({ o, ...s, src: 'thin' });
  // 3) OCR → scale
  let words: OcrWord[] = []; let ocrOk = false;
  if (opts.words) { words = opts.words; ocrOk = true; } else if (opts.useOcr !== false) { try { words = await ocr(cleanForOcr(cv, D, segs, W, H, Lmin), say); ocrOk = true; } catch (e) { console.warn('OCR unavailable', e); } }
  const dims = dimsFromWords(words);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? D[(y | 0) * W + (x | 0)] : 0);
  // match each horizontal dimension text to the dimension line under/over it, split at tick marks
  const ratios: { r: number; d: DDim }[] = [];
  for (const d of dims) {
    const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2, hh = d.y1 - d.y0; let best: Seg | null = null, bd = Infinity;
    for (const s of [...thin, ...segs]) { if (s.o !== 'h' || s.a > cx || s.b < cx) continue; const dy = Math.abs(s.c - cy); if (dy < 2.4 * hh + 4 && dy < bd && s.b - s.a >= (d.x1 - d.x0) * 0.8) { bd = dy; best = s; } }
    if (!best) continue;
    // walk along the dimension line in the raw mask from the text centre until a tick / arrow / extension line
    const c = Math.round(best.c), off = Math.ceil(best.t / 2) + 2;
    const onLine = (x: number) => at(x, c) || at(x, c - 1) || at(x, c + 1);
    const tick = (x: number) => { let up = 0, dn = 0; for (let q = off; q <= off + 4; q++) { up |= at(x, c - q); dn |= at(x, c + q); } return !!(up && dn); };
    const walk = (dir: number) => { let x = Math.round(cx), gap = 0, last = x; for (let n = 0; n < W; n++, x += dir) { if (x < 0 || x >= W) break; if (tick(x)) { let e = x; while (tick(e + dir)) e += dir; return (x + e) / 2; } if (onLine(x)) { gap = 0; last = x; } else if (++gap > 3) break; } return last; };
    const L = walk(1) - walk(-1);
    if (L > (d.x1 - d.x0) * 0.8) { d.px = L / k; ratios.push({ r: d.m / L, d }); }
  }
  let mpp = 0; let scaleFrom: 'ocr' | 'guess' = 'guess'; let scaleNote = '';
  if (ratios.length) {
    let bestSet: typeof ratios = []; for (const a of ratios) { const set = ratios.filter(b => Math.abs(b.r / a.r - 1) < 0.025); if (set.length > bestSet.length) bestSet = set; }
    const r = bestSet.reduce((s, x) => s + x.r, 0) / bestSet.length; const thickMax = Math.max(0, ...segs.map(s => s.t));
    const plausible = !thickMax || (thickMax * r > 2.5 * IN && thickMax * r < 20 * IN);
    if ((bestSet.length >= 2 || ratios.length === 1) && plausible) { mpp = r; scaleFrom = 'ocr'; scaleNote = `from ${bestSet.length} dimension${bestSet.length > 1 ? 's' : ''} (${bestSet.map(x => x.d.text).slice(0, 3).join(', ')})`; }
  }
  if (opts.forceMpp) { mpp = opts.forceMpp; scaleFrom = 'ocr'; scaleNote = opts.forceNote || 'set'; }
  if (!mpp) { const tk = segs.map(s => s.t).sort((a, b) => b - a); const ref = tk.length ? tk[Math.min(2, tk.length - 1)] : 0; mpp = ref ? (8 * IN) / ref : (50 * FT) / maxD; scaleNote = ref ? 'guessed from wall thickness — please confirm' : 'unknown — please set it'; }
  const px = (m: number) => m / mpp;
  // 4) pair thin parallel lines → double-line walls
  const minGap = Math.max(3, 2 * lw), maxGap = Math.min(px(16 * IN), maxD * 0.03);
  for (const o of ['h', 'v'] as const) {
    const L = thin.filter(s => s.o === o).sort((a, b) => a.c - b.c); const cand: [number, number, number][] = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length && L[j].c - L[i].c <= maxGap; j++) { const gp = L[j].c - L[i].c; if (gp < minGap) continue; const ov = Math.min(L[i].b, L[j].b) - Math.max(L[i].a, L[j].a); if (ov >= Math.max(Lmin, 0.5 * Math.min(L[i].b - L[i].a, L[j].b - L[j].a))) cand.push([gp, i, j]); }
    cand.sort((p, q) => q[0] - p[0]); const used: [number, number][][] = L.map(() => []);
    const free = (k: number, a: number, b: number) => used[k].every(([u, v]) => Math.min(v, b) - Math.max(u, a) <= 2);
    for (const [gp, i, j] of cand) {
      const a = Math.max(L[i].a, L[j].a), b = Math.min(L[i].b, L[j].b); if (!free(i, a, b) || !free(j, a, b)) continue;
      used[i].push([a, b]); used[j].push([a, b]);
      const c = (L[i].c + L[j].c) / 2; const s: Seg = { o, c, a, b, t: gp + lw, src: 'pair', glazed: [] };
      // a line running down the middle = glazing (window)
      let run = -1; for (let q = Math.ceil(a); q <= b + 1; q++) { let dk = 0; for (let e = -1; e <= 1; e++) dk |= o === 'h' ? at(q, c + e) : at(c + e, q); if (dk && q <= b) { if (run < 0) run = q; } else if (run >= 0) { if (q - run >= Math.max(Lmin * 0.8, px(18 * IN))) s.glazed!.push([run, q]); run = -1; } }
      segs.push(s);
    }
  }
  // 5) collinear merge → wall lines with openings
  const longT = (src: string) => segs.filter(s => s.src === src && s.b - s.a >= 3 * Lmin).map(s => s.t);
  const maxT = Math.max(...(longT('thick').length ? longT('thick') : longT('pair')), 1);
  type Line = { o: 'h' | 'v'; c: number; a: number; b: number; t: number; ext: boolean; ops: { a: number; b: number; kind: 'door' | 'window' | 'opening'; style: string }[] };
  const lines: Line[] = []; const ws = segs.filter(s => s.src !== 'thin');
  const perpCross = (o: 'h' | 'v', c: number, a: number, b: number) => ws.some(s => s.o !== o && s.c > a + 1 && s.c < b - 1 && s.a <= c + s.t && s.b >= c - s.t);
  for (const o of ['h', 'v'] as const) {
    const L = ws.filter(s => s.o === o).sort((p, q) => p.c - q.c); const done = new Set<Seg>();
    for (const s of L) {
      if (done.has(s)) continue; const grp = L.filter(q => !done.has(q) && Math.abs(q.c - s.c) <= Math.max(q.t, s.t) / 2 + 1);
      grp.forEach(q => done.add(q)); grp.sort((p, q) => p.a - q.a);
      // pieces: solid or glazed spans
      type P = { a: number; b: number; glz: boolean; t: number; c: number };
      const pcs: P[] = [];
      for (const q of grp) { const gl = (q.glazed || []).sort((x, y) => x[0] - y[0]); let cur = q.a; for (const [u, v] of gl) { if (u > cur) pcs.push({ a: cur, b: u, glz: false, t: q.t, c: q.c }); pcs.push({ a: u, b: v, glz: true, t: q.t, c: q.c }); cur = v; } if (q.b > cur) pcs.push({ a: cur, b: q.b, glz: false, t: q.t, c: q.c }); }
      pcs.sort((p, q) => p.a - q.a);
      // merge overlapping pieces (solid wins over glazed where they overlap)
      const m: P[] = []; for (const p of pcs) { const l = m[m.length - 1]; if (l && p.a <= l.b + 1 && l.glz === p.glz) { l.b = Math.max(l.b, p.b); l.t = Math.max(l.t, p.t); } else if (l && p.a < l.b) { if (p.glz) { if (p.b > l.b) m.push({ ...p, a: l.b }); } else { l.b = p.a; if (l.b - l.a < 2) m.pop(); m.push(p); } } else m.push({ ...p }); }
      let cur: Line | null = null;
      const solidT = (arr: P[]) => { const v = arr.filter(p => !p.glz).map(p => p.t).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : arr[0].t; };
      let bucket: P[] = [];
      const flush = () => { if (!cur) return; const t = solidT(bucket); cur.t = t; cur.ext = t >= 0.75 * maxT; cur.c = bucket.reduce((s, p) => s + p.c * (p.b - p.a), 0) / bucket.reduce((s, p) => s + (p.b - p.a), 0); if (cur.b - cur.a >= Math.max(Lmin, 2 * t)) lines.push(cur); cur = null; bucket = []; };
      for (const p of m) {
        if (cur) {
          const gap = p.a - cur.b; const ext = Math.max(p.t, cur.t) >= 0.75 * maxT;
          if (gap <= Math.max(3 * lw + 6, 1.4 * Math.max(p.t, cur.t)) && gap <= px(18 * IN)) { /* tiny break (wall junction): continuous */ }
          else if (gap > 0 && (gap > px((ext ? 18.5 : 10.5) * FT) || perpCross(o, s.c, cur.b, p.a))) flush();
          else if (gap > 0) cur.ops.push({ a: cur.b, b: p.a, kind: 'door', style: '' });
        }
        if (!cur) cur = { o, c: p.c, a: p.a, b: p.b, t: p.t, ext: false, ops: [] };
        if (p.glz) cur.ops.push({ a: p.a, b: p.b, kind: 'window', style: 'single-hung' });
        cur.b = Math.max(cur.b, p.b); bucket.push(p);
      }
      flush();
    }
  }
  // 6) join corners: snap ends to the centerline of a perpendicular wall
  for (const L of lines) for (const end of ['a', 'b'] as const) {
    let best: Line | null = null, bd = Infinity; const e = L[end];
    for (const P of lines) { if (P.o === L.o) continue; if (L.c < P.a - L.t - 2 || L.c > P.b + L.t + 2) continue; const d = Math.abs(P.c - e); if (d <= P.t / 2 + L.t / 2 + 4 + lw && d < bd) { bd = d; best = P; } }
    if (best) L[end] = best.c;
  }
  for (const L of lines) for (const end of ['a', 'b'] as const) { // the other way round (perpendicular wall end meets this line)
    for (const P of lines) { if (P.o === L.o) continue; for (const pe of ['a', 'b'] as const) if (Math.abs(P[pe] - L.c) < 0.5 && Math.abs(P.c - L[end]) <= L.t / 2 + P.t / 2 + 4 + lw) L[end] = P.c; }
  }
  // 6b) clutter: strokes inside text labels, and small pieces that touch no wall network (furniture, symbols, stairs, title text)
  { const tb = words.filter(w => w.conf > 45 && w.text.length >= 2 && /[A-Za-z0-9]/.test(w.text)).map(w => { const hh = w.y1 - w.y0; return { x0: w.x0 - hh * 0.25, y0: w.y0 - hh * 0.25, x1: w.x1 + hh * 0.25, y1: w.y1 + hh * 0.25, hh }; });
    const inText = (L: Line) => { const len = L.b - L.a; if (len <= 0) return true; let cov = 0;
      for (const b of tb) { if (len > 4 * b.hh) continue; const [p0, p1, c0, c1] = L.o === 'h' ? [b.x0, b.x1, b.y0, b.y1] : [b.y0, b.y1, b.x0, b.x1]; if (L.c < c0 || L.c > c1) continue; cov += Math.max(0, Math.min(L.b, p1) - Math.max(L.a, p0)); }
      return cov >= 0.6 * len; };
    for (let i = lines.length - 1; i >= 0; i--) if (inText(lines[i])) lines.splice(i, 1);
    const par = lines.map((_, i) => i); const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) { const A = lines[i], B = lines[j]; const tol = Math.max(A.t, B.t) / 2 + 3 + lw;
      const touch = A.o !== B.o ? (A.c >= B.a - tol && A.c <= B.b + tol && B.c >= A.a - tol && B.c <= A.b + tol) : (Math.abs(A.c - B.c) <= tol && Math.min(A.b, B.b) - Math.max(A.a, B.a) >= -tol);
      if (touch) par[find(i)] = find(j); }
    const tot = new Map<number, number>(); lines.forEach((L, i) => tot.set(find(i), (tot.get(find(i)) || 0) + (L.b - L.a)));
    const big = Math.max(0, ...tot.values());
    for (let i = lines.length - 1; i >= 0; i--) if ((tot.get(find(i)) || 0) < 0.12 * big) lines.splice(i, 1);
  }
  // 7) classify door gaps (swing arc beside the gap?)
  const dens = (x0: number, y0: number, x1: number, y1: number) => { let n = 0, on = 0; for (let y = Math.max(0, y0 | 0); y < Math.min(H, y1); y += 1) for (let x = Math.max(0, x0 | 0); x < Math.min(W, x1); x += 1) { n++; on += D[y * W + x]; } return n ? on / n : 0; };
  const dOps: DOpening[] = []; const dWalls: DWall[] = [];
  for (const L of lines) {
    const wi = dWalls.length; const A = L.o === 'h' ? { x: L.a, y: L.c } : { x: L.c, y: L.a }, B = L.o === 'h' ? { x: L.b, y: L.c } : { x: L.c, y: L.b };
    dWalls.push({ a: A, b: B, t: L.t, ext: L.ext });
    for (const op of L.ops) {
      const w = op.b - op.a; if (w < px(14 * IN)) continue; const mid = (op.a + op.b) / 2; let kind = op.kind, style = op.style, flip = false, hingeRight = false;
      if (kind === 'door') {
        const ht = L.t / 2 + 1; const r = Math.min(w, px(4 * FT));
        // side +n (n = (-d.y, d.x)): for h walls d=(1,0) → n=(0,1) (down); for v walls d=(0,1) → n=(-1,0) (left)
        const sideP = L.o === 'h' ? dens(op.a, L.c + ht, op.b, L.c + ht + r) : dens(L.c - ht - r, op.a, L.c - ht, op.b);
        const sideN = L.o === 'h' ? dens(op.a, L.c - ht - r, op.b, L.c - ht) : dens(L.c + ht, op.a, L.c + ht + r, op.b);
        const swing = Math.max(sideP, sideN) > 0.012; flip = sideN > sideP;
        if (swing) {
          const sgn = flip ? -1 : 1; const leaf = (s: number) => L.o === 'h' ? dens(s - 2, L.c + sgn * ht + (sgn > 0 ? 0 : -r), s + 3, L.c + sgn * ht + (sgn > 0 ? r : 0)) : dens(L.c - sgn * ht + (sgn > 0 ? -r : 0), s - 2, L.c - sgn * ht + (sgn > 0 ? 0 : r), s + 3);
          hingeRight = leaf(op.b) > leaf(op.a);
          const ft = w * mpp / FT; if (ft > 4.6) style = 'french'; else style = L.ext ? 'exterior' : 'interior';
        } else { const ft = w * mpp / FT; if (L.ext && ft >= 7.5) style = 'garage'; else { kind = 'opening'; style = 'opening'; } }
      }
      dOps.push({ wall: wi, at: (mid - L.a) / k, w: w / k, kind, style, flip, hingeRight });
    }
  }
  // 8) rooms: rasterize walls, flood the outside, every closed pocket is a room
  const cs = Math.max(2, Math.round(lw)); const GW = Math.ceil(W / cs), GH = Math.ceil(H / cs); const G = new Uint8Array(GW * GH);
  for (const L of lines) { const ht = L.t / 2 + 0.5; const x0 = L.o === 'h' ? L.a - ht : L.c - ht, x1 = L.o === 'h' ? L.b + ht : L.c + ht, y0 = L.o === 'h' ? L.c - ht : L.a - ht, y1 = L.o === 'h' ? L.c + ht : L.b + ht;
    for (let y = Math.max(0, Math.floor(y0 / cs)); y <= Math.min(GH - 1, Math.floor(y1 / cs)); y++) for (let x = Math.max(0, Math.floor(x0 / cs)); x <= Math.min(GW - 1, Math.floor(x1 / cs)); x++) G[y * GW + x] = 1; }
  const lab = new Int32Array(GW * GH); let nl = 0; const regions: { id: number; n: number; border: boolean; cells: number[] }[] = [];
  for (let s0 = 0; s0 < G.length; s0++) { if (G[s0] || lab[s0]) continue; nl++; const st = [s0]; lab[s0] = nl; const reg = { id: nl, n: 0, border: false, cells: [] as number[] };
    while (st.length) { const c = st.pop()!; reg.n++; reg.cells.push(c); const x = c % GW, y = (c / GW) | 0; if (!x || !y || x === GW - 1 || y === GH - 1) reg.border = true;
      for (const nb of [x > 0 ? c - 1 : -1, x < GW - 1 ? c + 1 : -1, y > 0 ? c - GW : -1, y < GH - 1 ? c + GW : -1]) if (nb >= 0 && !G[nb] && !lab[nb]) { lab[nb] = nl; st.push(nb); } }
    regions.push(reg); }
  const minCells = (12 * FT * FT) / (mpp * mpp * cs * cs);
  const dRooms: DRoom[] = [];
  for (const r of regions) {
    if (r.border || r.n < minCells) continue;
    const poly = trace(lab, GW, GH, r.id).map(p => ({ x: p.x * cs / k, y: p.y * cs / k }));
    if (poly.length < 4) continue;
    dRooms.push({ pts: poly, name: '' });
  }
  // room names: biggest text line inside each room that is not a dimension
  const lineMap = new Map<number, OcrWord[]>(); words.forEach(w => (lineMap.get(w.line) || lineMap.set(w.line, []).get(w.line)!).push(w));
  for (const r of dRooms) {
    let best = '', bh = 0, by = Infinity;
    for (const ws2 of lineMap.values()) {
      const inside = ws2.filter(w => /[A-Za-z]|^\d$/.test(w.text) && w.conf > 40 && pip({ x: (w.x0 + w.x1) / 2 / k, y: (w.y0 + w.y1) / 2 / k }, r.pts));
      if (!inside.some(w => /[A-Za-z]{2,}/.test(w.text))) continue; const txt = inside.map(w => w.text).join(' ').replace(/[^\w .&/'-]/g, '').trim(); if (!txt || parseDim(txt)) continue;
      const hh = Math.max(...inside.map(w => w.y1 - w.y0)) * (ROOMWORD.test(txt) ? 4 : inside.some(w => w.conf > 75 && /[A-Za-z]{3,}/.test(w.text)) ? 1 : 0.2), y = Math.min(...inside.map(w => w.y0));
      if (hh > bh * 1.15 || (hh > bh * 0.85 && y < by)) { best = txt.replace(/\s*\d.*$/, '').trim() || txt; bh = hh; by = y; }
    }
    r.name = best.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  // scale from room-size labels ("BEDROOM 12'0" X 14'0"") when no dimension line gave it
  if (scaleFrom === 'guess' && !opts.forceMpp) {
    const cand: { r: number; txt: string }[] = [];
    for (const ws2 of lineMap.values()) {
      const txt = ws2.sort((a, b) => a.x0 - b.x0).map(w => w.text).join(' '); const m = roomSize(txt); if (!m) continue;
      const cx = ws2.reduce((s2, w) => s2 + (w.x0 + w.x1) / 2, 0) / ws2.length / k, cy = ws2.reduce((s2, w) => s2 + (w.y0 + w.y1) / 2, 0) / ws2.length / k;
      const room = dRooms.find(r => pip({ x: cx, y: cy }, r.pts)); if (!room) continue;
      const xs = room.pts.map(p => p.x * k), ys = room.pts.map(p => p.y * k); const bw = Math.max(...xs) - Math.min(...xs), bh2 = Math.max(...ys) - Math.min(...ys);
      const o1 = [m[0] / bw, m[1] / bh2], o2 = [m[1] / bw, m[0] / bh2]; const d1 = Math.abs(o1[0] / o1[1] - 1), d2 = Math.abs(o2[0] / o2[1] - 1); const [o, dd] = d1 < d2 ? [o1, d1] : [o2, d2];
      if (dd < 0.12) cand.push({ r: (o[0] + o[1]) / 2, txt: txt.replace(/^.*?(\d)/, '$1') });
    }
    let bestSet: typeof cand = []; for (const a of cand) { const set = cand.filter(b => Math.abs(b.r / a.r - 1) < 0.07); if (set.length > bestSet.length) bestSet = set; }
    if (bestSet.length >= 2 || (cand.length === 1)) { const r = bestSet.reduce((s2, x) => s2 + x.r, 0) / bestSet.length; const note = `from ${bestSet.length} room size${bestSet.length > 1 ? 's' : ''} (${bestSet.slice(0, 2).map(x => x.txt).join(', ')}) — please check one wall`;
      if (Math.abs(r / mpp - 1) > 0.08) return analyze(img, { ...opts, forceMpp: r, forceNote: note, words });
      mpp = r; scaleFrom = 'ocr'; scaleNote = note; }
  }
  const scale = (p: { x: number; y: number }) => ({ x: p.x / k, y: p.y / k });
  const walls = dWalls.map(w => ({ a: scale(w.a), b: scale(w.b), t: w.t / k, ext: w.ext }));
  const longestDim = dims.reduce<DDim | null>((b, d) => (!b || d.m > b.m ? d : b), null);
  const sc = (d: DDim) => ({ ...d, x0: d.x0 / k, y0: d.y0 / k, x1: d.x1 / k, y1: d.y1 / k });
  return { w: W / k, h: H / k, walls, openings: dOps, rooms: dRooms, mpp: mpp * k, scaleFrom, scaleNote, dims: dims.map(sc), longestDim: longestDim ? sc(longestDim) : null, ocrOk, words: words.map(w => ({ ...w, x0: w.x0 / k, y0: w.y0 / k, x1: w.x1 / k, y1: w.y1 / k })), ms: performance.now() - t0 };
}
const ROOMWORD = /\b(bed|bdrm|br|bath|ba|wc|toilet|kitchen|kit|living|liv|dining|din|family|great|garage|gar|master|mstr|closet|clo|wic|laundry|util|utility|pantry|porch|lanai|patio|deck|den|office|study|foyer|entry|lobby|hall|nook|bonus|media|game|loft|mud|storage|stor|mech|lr|dr|k|pool|cabana|guest|suite|room)\b/i;
/** "12'0" X 14'0"", "12'-6" x 10'", "12 x 14" (feet) → [m, m] */
function roomSize(t: string): [number, number] | null {
  const s = t.replace(/[’′`´]/g, "'").replace(/[”″]|''/g, '"').replace(/[×*]/g, 'x');
  const D = String.raw`(\d{1,3}\s*'\s*-?\s*\d{0,2}(?:\s+\d{1,2}\/\d{1,2})?\s*"?|\d{1,3}(?:\.\d+)?\s*m?)`;
  const m = s.match(new RegExp(D + String.raw`\s*[xX]\s*` + D)); if (!m) return null;
  const v = (q: string) => { q = q.trim(); const d = parseDim(q); if (d) return d; const n = parseFloat(q); if (!n) return null; return /m$/.test(q) ? n : n * FT; };
  const a = v(m[1]), b = v(m[2]); if (!a || !b || a < 1.2 || b < 1.2 || a > 25 || b > 25) return null; return [a, b];
}
function pip(p: { x: number; y: number }, pts: { x: number; y: number }[]) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins; } return ins; }
/** Outer boundary of a labelled grid region as an orthogonal polygon (grid-corner coordinates). */
function trace(lab: Int32Array, GW: number, GH: number, id: number) {
  const inR = (x: number, y: number) => x >= 0 && y >= 0 && x < GW && y < GH && lab[y * GW + x] === id;
  const next = new Map<string, [number, number][]>(); const key = (x: number, y: number) => x + ',' + y;
  const add = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0); (next.get(k) || next.set(k, []).get(k)!).push([x1, y1]); };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { if (!inR(x, y)) continue;
    if (!inR(x, y - 1)) add(x, y, x + 1, y); if (!inR(x + 1, y)) add(x + 1, y, x + 1, y + 1); if (!inR(x, y + 1)) add(x + 1, y + 1, x, y + 1); if (!inR(x - 1, y)) add(x, y + 1, x, y); }
  let best: [number, number][] = [];
  const seen = new Set<string>();
  for (const [k0, outs] of next) for (const o0 of outs) {
    const ek = k0 + '>' + o0.join(','); if (seen.has(ek)) continue; const loop: [number, number][] = []; let [cx, cy] = k0.split(',').map(Number); let nx = o0[0], ny = o0[1]; seen.add(ek); loop.push([cx, cy]);
    let guard = 0; while (guard++ < 1e6) { const k2 = key(nx, ny); if (k2 === k0) break; loop.push([nx, ny]); const cand = next.get(k2) || []; const pick = cand.find(c => !seen.has(k2 + '>' + c.join(','))) || cand[0]; if (!pick) break; seen.add(k2 + '>' + pick.join(',')); cx = nx; cy = ny; nx = pick[0]; ny = pick[1]; }
    if (loop.length > best.length) best = loop;
  }
  // drop collinear points and 1-cell jags
  let pts = best.map(([x, y]) => ({ x, y }));
  const simplify = (P: { x: number; y: number }[]) => P.filter((p, i) => { const a = P[(i - 1 + P.length) % P.length], b = P[(i + 1) % P.length]; return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y)); });
  pts = simplify(pts);
  for (let it = 0; it < 3; it++) { // remove tiny steps (≤1 cell) created by anti-aliasing
    const out: { x: number; y: number }[] = []; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) <= 1 && pts.length > 4) { const r = pts[(i + 2) % pts.length]; if (p.x === q.x) q.x = r.x === q.x ? q.x : q.x; continue; } out.push(p); }
    pts = simplify(out.length >= 4 ? orthofix(out) : pts);
  }
  return pts;
}
function orthofix(P: { x: number; y: number }[]) { // make consecutive edges axis-aligned again after dropping jags
  const out = P.map(p => ({ ...p })); for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; if (a.x !== b.x && a.y !== b.y) { if (Math.abs(a.x - b.x) < Math.abs(a.y - b.y)) b.x = a.x; else b.y = a.y; } } return out;
}

/** Straighten a slightly rotated scan/photo of a plan: find the angle (±12°) where dark pixels line up into the sharpest rows/columns. */
export function deskew(src: HTMLCanvasElement): { cv: HTMLCanvasElement; deg: number } {
  const { cv: s } = canvasFrom(src, 500); const g = grayOf(s); const W = s.width, H = s.height; const t = otsu(g);
  const pts: number[] = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y * W + x] < t) pts.push(x, y);
  if (pts.length < 200) return { cv: src, deg: 0 };
  const score = (deg: number) => { const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a); const R = Math.ceil(Math.hypot(W, H)) * 2; const hr = new Float32Array(R), hc = new Float32Array(R);
    for (let i = 0; i < pts.length; i += 2) { const x = pts[i] - W / 2, y = pts[i + 1] - H / 2; hr[(y * c - x * sn + R / 2) | 0]++; hc[(x * c + y * sn + R / 2) | 0]++; }
    let v = 0; for (let i = 0; i < R; i++) v += hr[i] * hr[i] + hc[i] * hc[i]; return v; };
  let best = 0, bs = score(0); for (let d = -12; d <= 12; d += 0.5) { const v = score(d); if (v > bs * 1.0001) { bs = v; best = d; } }
  for (let d = best - 0.4; d <= best + 0.4; d += 0.1) { const v = score(d); if (v > bs) { bs = v; best = d; } }
  if (Math.abs(best) < 0.25) return { cv: src, deg: 0 };
  const a = -best * Math.PI / 180; const out = document.createElement('canvas'); out.width = src.width; out.height = src.height; const c = out.getContext('2d')!;
  c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height); c.translate(out.width / 2, out.height / 2); c.rotate(a); c.drawImage(src, -src.width / 2, -src.height / 2);
  return { cv: out, deg: best };
}
