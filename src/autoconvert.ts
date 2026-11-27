import { ppReady, ppRead, type PPRead } from './ppocr';
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
export interface DDim { text: string; m: number; x0: number; y0: number; x1: number; y1: number; px?: number; v?: boolean; item?: number }
export interface Detection {
  w: number; h: number; walls: DWall[]; openings: DOpening[]; rooms: DRoom[];
  mpp: number; scaleFrom: 'ocr' | 'guess' | 'area'; ceiling?: number | null; elevations?: number; scaleNote: string; askDim?: { text: string; m: number; px: number; x0: number; y0: number; x1: number; y1: number } | null; cands?: { x0: number; y0: number; x1: number; y1: number; v: boolean; px: number; text: string }[]; dims: DDim[]; longestDim: DDim | null; ocrOk: boolean; words: OcrWord[]; ms: number;
}
export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; line: number; conf: number; vert?: boolean }
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
/** Screenshots: the paper is pure white, app bars and thumbnail strips are grey/dark. Keep the largest run of white-paper rows/columns. */
export function cropPage(src: HTMLCanvasElement): { cv: HTMLCanvasElement; notes: string[] } {
  const W = src.width, H = src.height; const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const wr = new Float32Array(H), wc = new Float32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (d[i] > 243 && d[i + 1] > 243 && d[i + 2] > 243) { wr[y]++; wc[x]++; } }
  const run = (a: Float32Array, n: number, other: number) => { let best = [0, n], bl = 0, s0 = -1, gap = 0; const tol = Math.max(2, n * 0.015);
    for (let i = 0; i <= n; i++) { const ok = i < n && a[i] / other > 0.45; if (ok) { if (s0 < 0) s0 = i; gap = 0; } else if (s0 >= 0) { gap++; if (gap > tol || i === n) { const e = i - gap + 1; if (e - s0 > bl) { bl = e - s0; best = [s0, e]; } s0 = -1; gap = 0; } } }
    return best; };
  const [y0, y1] = run(wr, H, W); const [x0, x1] = run(wc, W, H); const notes: string[] = [];
  if ((y1 - y0) * (x1 - x0) > 0.92 * W * H || (y1 - y0) < H * 0.2 || (x1 - x0) < W * 0.3) return { cv: src, notes };
  // only when what is cut off really is app chrome (grey/dark bars), not part of a drawing
  let cw = 0, cn = 0; for (let y = 0; y < H; y++) if (y < y0 || y >= y1) { cw += wr[y] / W; cn++; } for (let x = 0; x < W; x++) if (x < x0 || x >= x1) { cw += wc[x] / H; cn++; }
  if (!cn || cw / cn > 0.3) return { cv: src, notes };
  const out = document.createElement('canvas'); out.width = x1 - x0; out.height = y1 - y0; out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  notes.push('screen/app borders removed'); return { cv: out, notes };
}
/** Phone screenshots and full sheets: keep only the drawing (drops app toolbars, thumbnails, title blocks, notes, tables).
 *  Finds the biggest cluster of line work; photos/thumbnails (solid dark areas) count little. */
export function cropToDrawing(src: HTMLCanvasElement, maxSide = 2400, screenshot = false): { cv: HTMLCanvasElement; box: { x: number; y: number; w: number; h: number } | null; notes: string[] } {
  const W = src.width, H = src.height; const g = grayOf(src); const k = Math.max(1, Math.ceil(Math.max(W, H) / 500)); const w = Math.ceil(W / k), h = Math.ceil(H / k);
  const ink = new Uint8Array(w * h), cnt = new Uint16Array(w * h);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y * W + x] < 150) { const j = ((y / k) | 0) * w + ((x / k) | 0); ink[j] = 1; cnt[j]++; }
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.007)); const dl = new Uint8Array(w * h), tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (ink[y * w + x]) last = x; if (x - last <= r) tmp[y * w + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (ink[y * w + x]) last = x; if (last - x <= r) tmp[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= r) dl[y * w + x] = 1; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) dl[y * w + x] = 1; } }
  const lab = new Int32Array(w * h).fill(-1); let best = -1, bestScore = 0, bb = { x0: 0, y0: 0, x1: 0, y1: 0 }; const st: number[] = [];
  for (let i = 0; i < w * h; i++) { if (!dl[i] || lab[i] >= 0) continue; let x0 = w, y0 = h, x1 = 0, y1 = 0, inkC = 0, dense = 0; st.push(i); lab[i] = i;
    while (st.length) { const j = st.pop()!; const x = j % w, y = (j / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); if (ink[j]) { inkC++; if (cnt[j] > k * k * 0.6) dense++; }
      for (const q of [j - 1, j + 1, j - w, j + w]) if (q >= 0 && q < w * h && dl[q] && lab[q] < 0 && Math.abs((q % w) - x) <= 1) { lab[q] = i; st.push(q); } }
    const score = dense > 0.75 * inkC ? inkC * 0.1 : inkC; if (score > bestScore) { bestScore = score; best = i; bb = { x0, y0, x1, y1 }; } }
  const notes: string[] = []; if (best < 0) return { cv: src, box: null, notes };
  const pad = -Math.round(Math.max(w, h) * 0.02); const box = { x: Math.max(0, Math.round((bb.x0 + pad) * k)), y: Math.max(0, Math.round((bb.y0 + pad) * k)), w: 0, h: 0 }; box.w = Math.min(W, Math.round((bb.x1 + 1 - pad) * k)) - box.x; box.h = Math.min(H, Math.round((bb.y1 + 1 - pad) * k)) - box.y;
  if (box.w * box.h > (screenshot ? 0.9 : 0.5) * W * H || box.w < W * 0.2 || box.h < H * 0.1) return { cv: src, box: null, notes };
  const sc = Math.max(box.w, box.h) < 1300 ? Math.min(2.2, maxSide / Math.max(box.w, box.h)) : 1; const out = document.createElement('canvas'); out.width = Math.round(box.w * sc); out.height = Math.round(box.h * sc); const c = out.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  notes.push(`cropped to the drawing${sc > 1.05 ? ` (enlarged ${sc.toFixed(1)}×)` : ''}`); return { cv: out, box, notes };
}
export function prepare(src: HTMLCanvasElement): { cv: HTMLCanvasElement; notes: string[] } {
  const W = src.width, H = src.height; const g = grayOf(src); const notes: string[] = []; const n = W * H;
  // colored markup (red pen, green engineer stamps, yellow highlighter) on a black-and-white drawing: drop it
  { const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data; let col = 0; const isCol = (i: number) => { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]; return Math.max(r, gg, b) - Math.min(r, gg, b) > 70; };
    for (let i = 0; i < n; i += 7) if (isCol(i)) col++; const frac = col * 7 / n;
    if (frac > 0.0005 && frac < 0.06) { for (let i = 0; i < n; i++) if (isCol(i)) g[i] = 255; notes.push('colored marks removed'); } }
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
  let T: any; try { T = await import('tesseract.js'); } catch (e) { console.warn('OCR unavailable', e); return []; }
  if (!ocrWorker) try {
    onProgress?.('Loading text reader (first time only)…');
    const base = new URL(((import.meta as any).env?.BASE_URL || '/') + 'tesseract/', location.href).href; ocrWorker = await T.createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', workerBlobURL: false, logger: (m: any) => { if (m.status === 'recognizing text') onProgress?.(`Reading text ${Math.round(m.progress * 100)}%`); } });
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
  } catch (e) { console.warn('OCR unavailable (offline?)', e); ocrWorker = null; return []; }
  const { data } = await ocrWorker.recognize(cv, {}, { blocks: true });
  const words: OcrWord[] = []; let ln = 0;
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) { ln++; for (const w of l.words || []) { const t = (w.text || '').trim(); if (!t) continue; words.push({ text: t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, line: ln, conf: w.confidence }); } }
  return words;
}
let ocrWorker2: any = null; let ocr2Params = '';
/** Second reader with its own settings (single-line / digits-only passes). */
export async function ocrWith(cv: HTMLCanvasElement, params: Record<string, string>): Promise<{ words: OcrWord[]; text: string; conf: number }> {
  let T: any; try { T = await import('tesseract.js'); } catch { return { words: [], text: '', conf: 0 }; }
  if (!ocrWorker2) try { const base = new URL(((import.meta as any).env?.BASE_URL || '/') + 'tesseract/', location.href).href; ocrWorker2 = await T.createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', workerBlobURL: false }); } catch { return { words: [], text: '', conf: 0 }; }
  const ps = JSON.stringify(params); if (ps !== ocr2Params) { await ocrWorker2.setParameters({ tessedit_char_whitelist: '', ...params }); ocr2Params = ps; }
  const { data } = await ocrWorker2.recognize(cv, {}, { blocks: true }); const words: OcrWord[] = []; let ln = 0;
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) { ln++; for (const w of l.words || []) { const t = (w.text || '').trim(); if (t) words.push({ text: t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, line: ln, conf: w.confidence }); } }
  return { words, text: (data.text || '').trim(), conf: data.confidence || 0 };
}
/** "12'-6"", "12' 6", "12'6 1/2"", "40'", "3.5m", "3500mm" → meters */
/** Clean up how text readers garble dimensions: °/* as inch marks, ~ or / for the foot mark, O→0 and I/l→1 in numbers, ½ ¼ ¾, lost fraction slash (9'-1012" = 9'-10½"). */
export function normDim(s: string): string {
  let t = s.replace(/[’′`´‘~]/g, "'").replace(/[”″“°*]|''/g, '"').replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4');
  t = t.replace(/(?<=[\d'-])[Oo](?=[\d"'\s]|$)/g, '0').replace(/(?<=^|[\d'-])[Oo](?=\d)/g, '0').replace(/(?<=[\d'-]|^)[Il|](?=[\d'"-])/g, '1').replace(/(?<=\d)[Il|](?=$|["'\s])/g, '1');
  t = t.replace(/(\d)\/['-]/g, "$1'-").replace(/(?<=['-])g(?=["\s]|$)/g, '9').replace(/'-'/g, "'-").replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(\d{1,3}'?-\d{1,2})'$/, '$1"'); // inch mark read as a foot mark
  // inches with a fraction whose space or slash was lost: 1311/2 → 13'-1 1/2 handled below; -1012" → -10 1/2"
  let m = /^(\d{1,3})('?-|')(\d{1,2})(\d)\/?(2|4|8)"?$/.exec(t); if (m && +m[3] < 12 && +m[4] < +m[5]) t = `${m[1]}'-${m[3]} ${m[4]}/${m[5]}"`;
  m = /^(\d{1,3})('?-|')(\d)(\d)\/(2|4|8)"?$/.exec(t); if (m && +m[4] < +m[5]) t = `${m[1]}'-${m[3]} ${m[4]}/${m[5]}"`;
  return t;
}
export function parseDim(s: string): number | null {
  const t = normDim(s);
  let m = t.match(/^(\d{1,3})\s*'\s*-?\s*(\d{1,2})?(?:\s+(\d{1,2})\/(\d{1,2}))?\s*"?$/);
  if (m) { const ft = +m[1], inch = m[2] ? +m[2] : 0, fr = m[3] ? +m[3] / +m[4] : 0; if (inch >= 12) return null; return ft * FT + (inch + fr) * IN; }
  m = t.match(/^(\d{1,3})\s*-\s*(\d{1,2})(?:\s+(\d{1,2})\/(\d{1,2}))?\s*"$/); if (m && +m[2] < 12) return +m[1] * FT + (+m[2] + (m[3] ? +m[3] / +m[4] : 0)) * IN; // apostrophe lost by OCR: 14-0"
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
      if (v && v > 0.5 && /^(C[LI1l]G|CEIL|AFF|A\.F\.F|TRAY|VAULT|PLATE|T\.?O\.?W)/i.test(ws[i + n]?.text || '')) { i += n - 1; break; } // ceiling / height notes are not lengths
      if (v && /m$/i.test(txt.trim()) && !/mm$/i.test(txt.trim()) && !/\d[.,]\d/.test(txt)) { i += n - 1; break; } // '10M', '518m' (scale bars, notes) are not dimensions
      if (v && v > 0.5) { out.push({ text: txt, v: g.some(w => w.vert), m: v, x0: g[0].x0, y0: Math.min(...g.map(w => w.y0)), x1: g[g.length - 1].x1, y1: Math.max(...g.map(w => w.y1)) }); i += n - 1; break; }
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

// ---------------- text-line OCR (small print) ----------------
// Plans are usually photographed or screenshotted far too small for the text reader (dimension text 5–10 px tall).
// Find every little text line (horizontal or vertical) on the drawing, enlarge each one to ~32 px letters, binarize,
// pack them onto a few clean pages and read those. Each word is mapped back to where it sits on the plan.
type TItem = { x0: number; y0: number; x1: number; y1: number; v: boolean; ch: number; id: number; rot?: 1 | -1 };
export function findTextItems(g: Uint8Array, thr: number, W: number, H: number): { items: TItem[]; ch: number } {
  const maxD = Math.max(W, H); const lab = new Int32Array(W * H); type C = { x0: number; y0: number; x1: number; y1: number; n: number };
  const comps: C[] = []; const st: number[] = [];
  for (let s = 0; s < W * H; s++) { if (lab[s] || g[s] > thr) continue; const c: C = { x0: W, y0: H, x1: 0, y1: 0, n: 0 }; lab[s] = comps.length + 1; st.push(s);
    while (st.length) { const p = st.pop()!; const x = p % W, y = (p / W) | 0; c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const q = yy * W + xx; if (!lab[q] && g[q] <= thr) { lab[q] = lab[s]; st.push(q); } } }
    comps.push(c); }
  const big = 0.08 * maxD;
  const ok = comps.filter(c => { const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1; return c.n >= 3 && w <= big && h <= big && !(Math.max(w, h) > 7 * Math.min(w, h) && Math.max(w, h) > 12); });
  const hs = ok.map(c => c.y1 - c.y0 + 1).filter(h => h >= 4).sort((a, b) => a - b); const ch = hs.length ? Math.max(4, hs[(hs.length * 0.6) | 0]) : 8;
  const cand = ok.filter(c => Math.min(c.y1 - c.y0, c.x1 - c.x0) + 1 <= 0.025 * maxD);
  // horizontal lines: union chars that overlap vertically and sit close side by side
  const par = cand.map((_, i) => i); const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  const join = (vert: boolean, use: (i: number) => boolean) => { const idx = cand.map((_, i) => i).filter(use).sort((a, b) => vert ? cand[a].y0 - cand[b].y0 : cand[a].x0 - cand[b].x0);
    for (let p = 0; p < idx.length; p++) { const A = cand[idx[p]]; for (let q = p + 1; q < idx.length; q++) { const B = cand[idx[q]];
      const gap = vert ? B.y0 - A.y1 : B.x0 - A.x1; if (gap > Math.max(2.5 * ch, 0.025 * maxD)) break; const hA = vert ? A.x1 - A.x0 + 1 : A.y1 - A.y0 + 1, hB = vert ? B.x1 - B.x0 + 1 : B.y1 - B.y0 + 1; if (gap > Math.max(1.1 * ch, 0.45 * Math.max(hA, hB))) continue; const ov = vert ? Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) : Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      const ha = vert ? A.x1 - A.x0 : A.y1 - A.y0, hb = vert ? B.x1 - B.x0 : B.y1 - B.y0; const ca = vert ? (A.x0 + A.x1) / 2 : (A.y0 + A.y1) / 2, cb = vert ? (B.x0 + B.x1) / 2 : (B.y0 + B.y1) / 2;
      if (ov >= 0.35 * Math.min(ha, hb) || (Math.abs(ca - cb) < 0.6 * ch)) par[find(idx[q])] = find(idx[p]); } } };
  const groups = (sel: number[]) => { const m = new Map<number, number[]>(); for (const i of sel) { const r = find(i); (m.get(r) || m.set(r, []).get(r)!).push(i); } return [...m.values()]; };
  join(false, () => true);
  const items: TItem[] = []; const used = new Set<number>();
  const box = (ix: number[]) => ({ x0: Math.min(...ix.map(i => cand[i].x0)), y0: Math.min(...ix.map(i => cand[i].y0)), x1: Math.max(...ix.map(i => cand[i].x1)), y1: Math.max(...ix.map(i => cand[i].y1)) });
  for (const gI of groups(cand.map((_, i) => i))) { if (gI.length < 2) continue; const b = box(gI); const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1; if (w >= 1.3 * h && h <= 0.03 * maxD) { items.push({ ...b, v: false, ch: h, id: items.length }); gI.forEach(i => used.add(i)); } }
  // vertical lines (dimensions written along vertical dimension lines) from what is left
  for (let i = 0; i < par.length; i++) par[i] = i; const rest = cand.map((_, i) => i).filter(i => !used.has(i)); const rs = new Set(rest); join(true, i => rs.has(i));
  for (const gI of groups(rest)) { if (gI.length < 3) continue; const b = box(gI); const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1; if (h >= 1.8 * w && w <= 0.03 * maxD) items.push({ ...b, v: true, ch: Math.min(w, 1.6 * ch), id: items.length }); }
  return { items, ch };
}
/** OCR all text items at a readable size. Returns words in source pixels; word.line = item id (vertical items read both ways). */
export async function ocrTextItems(src: HTMLCanvasElement, items: TItem[], say?: (s: string) => void, maxItems = 500): Promise<OcrWord[]> {
  const PW = 2400, PH = 2400, GX = 70, GY = 46; type Pl = { it: TItem; rot: 0 | 1 | -1; s: number; x: number; y: number; w: number; h: number; page: number; pad: number };
  const pls: Pl[] = []; let page = 0, cx = 20, cy = 20, rowH = 0;
  const list: { it: TItem; rot: 0 | 1 | -1 }[] = items.slice(0, maxItems).flatMap(it => (it.v ? [{ it, rot: 1 }, { it, rot: -1 }] : [{ it, rot: 0 }]) as { it: TItem; rot: 0 | 1 | -1 }[]);
  for (const { it, rot } of list) {
    const s = Math.max(1, Math.min(5, 32 / Math.max(3, it.ch))); const pad = Math.round(0.35 * it.ch + 2); const bw = it.x1 - it.x0 + 1 + 2 * pad, bh = it.y1 - it.y0 + 1 + 2 * pad;
    const w = Math.round((rot ? bh : bw) * s), h = Math.round((rot ? bw : bh) * s); if (w > PW - 40) continue;
    if (cx + w > PW - 20) { cx = 20; cy += rowH + GY; rowH = 0; } if (cy + h > PH - 20) { page++; cx = 20; cy = 20; rowH = 0; }
    pls.push({ it, rot, s, x: cx, y: cy, w, h, page, pad }); cx += w + GX; rowH = Math.max(rowH, h);
  }
  const words: OcrWord[] = [];
  for (let p = 0; p <= page; p++) {
    const here = pls.filter(q => q.page === p); if (!here.length) continue; say?.(`Reading the small print ${p + 1}/${page + 1}…`);
    const cv = document.createElement('canvas'); cv.width = PW; cv.height = Math.min(PH, Math.max(...here.map(q => q.y + q.h)) + 30); const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    for (const q of here) { const it = q.it; const sx = it.x0 - q.pad, sy = it.y0 - q.pad, sw = it.x1 - it.x0 + 1 + 2 * q.pad, sh = it.y1 - it.y0 + 1 + 2 * q.pad;
      c.save(); c.translate(q.x + q.w / 2, q.y + q.h / 2); if (q.rot) c.rotate(q.rot * Math.PI / 2); c.drawImage(src, sx, sy, sw, sh, -sw * q.s / 2, -sh * q.s / 2, sw * q.s, sh * q.s); c.restore(); }
    // binarize (sharp black text on white reads far better than blurry grey)
    const id = c.getImageData(0, 0, cv.width, cv.height); const g = new Uint8Array(cv.width * cv.height); for (let i = 0; i < g.length; i++) g[i] = (id.data[i * 4] * 77 + id.data[i * 4 + 1] * 150 + id.data[i * 4 + 2] * 29) >> 8;
    const dark: number[] = []; for (let i = 0; i < g.length; i += 7) if (g[i] < 250) dark.push(g[i]); const BM = (globalThis as any).__p3dBin ?? 999; const t = dark.length > 50 ? Math.max(40, Math.min(200, otsu(Uint8Array.from(dark)) + BM)) : 140;
    if (BM !== 999) { for (let i = 0; i < g.length; i++) { const v = g[i] <= t ? 0 : 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; } c.putImageData(id, 0, 0); }
    (globalThis as any).__p3dTextPages = [...((globalThis as any).__p3dTextPages || []).slice(-5), cv];
    const ws = await ocr(cv, say);
    for (const w of ws) { const mx = (w.x0 + w.x1) / 2, my = (w.y0 + w.y1) / 2; const q = here.find(q2 => mx >= q2.x && mx <= q2.x + q2.w && my >= q2.y && my <= q2.y + q2.h); if (!q) continue; const it = q.it;
      const line = it.id * 4 + (q.rot === 0 ? 0 : q.rot === 1 ? 1 : 2);
      if (q.rot) words.push({ ...w, x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1, line, vert: true } as OcrWord);
      else words.push({ ...w, x0: it.x0 - q.pad + (w.x0 - q.x) / q.s, x1: it.x0 - q.pad + (w.x1 - q.x) / q.s, y0: it.y0 - q.pad + (w.y0 - q.y) / q.s, y1: it.y0 - q.pad + (w.y1 - q.y) / q.s, line }); }
  }
  // vertical items were read both ways round: keep the reading the reader is most sure of
  const byIt = new Map<number, { r1: number[]; r2: number[] }>(); for (const w of words) if (w.vert) { const id = w.line >> 2; const e = byIt.get(id) || byIt.set(id, { r1: [], r2: [] }).get(id)!; ((w.line & 3) === 1 ? e.r1 : e.r2).push(w.conf * (/\d/.test(w.text) ? 1.2 : 1)); }
  const score = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length + 4 * Math.min(a.length, 3) : -1;
  for (const [id, e] of byIt) { const it = items.find(i => i.id === id); if (it) it.rot = score(e.r1) >= score(e.r2) ? 1 : -1; }
  return words.filter(w => { if (!w.vert) return true; const e = byIt.get(w.line >> 2)!; const keep = score(e.r1) >= score(e.r2) ? 1 : 2; return (w.line & 3) === keep; });
}

/** Loose reading of a dimension the text reader half-got ("25-4"", "26 8"", "52'0") → all plausible lengths in meters. */
export function parseDimLoose(s: string): number[] {
  const out: number[] = []; const t = s.replace(/[’′`´‘]/g, "'").replace(/[”″“]|''/g, '"').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  const v = parseDim(t); if (v) out.push(v);
  if (!out.length) { const flip = [...t].reverse().map(ch => ({ '6': '9', '9': '6', ',': "'", '.': "'", '„': '"' } as Record<string, string>)[ch] ?? ch).join('').replace(/''/g, '"'); const fv = parseDim(flip); if (fv) out.push(fv); } // upside-down text
  let m = /^(\d{1,3})(?:'-?|-|'? )(\d{1,2})(?: (\d)\/(\d{1,2}))?"?$/.exec(t); if (m && +m[2] < 12) out.push(+m[1] * FT + (+m[2] + (m[3] ? +m[3] / +m[4] : 0)) * IN);
  m = /^(\d{1,3})'$/.exec(t); if (m) out.push(+m[1] * FT);
  return [...new Set(out.map(x => Math.round(x * 1e4) / 1e4))].filter(x => x > 0.5 && x < 120);
}
/** Is this text item sitting on a dimension line (a long thin line right under/over it, or beside it when vertical)? */
function onDimLine(it: TItem, D: Uint8Array, W: number, H: number): boolean {
  const len = it.v ? it.y1 - it.y0 : it.x1 - it.x0, ch = it.ch; const ca = it.v ? (it.y0 + it.y1) / 2 : (it.x0 + it.x1) / 2;
  const run = (across: number) => { let n = 0; const a0 = Math.round(ca - len), a1 = Math.round(ca + len); for (let a = a0; a <= a1; a++) { let d = 0; for (let e = -1; e <= 1; e++) { const x = it.v ? across + e : a, y = it.v ? a : across + e; if (x >= 0 && y >= 0 && x < W && y < H && D[y * W + x]) d = 1; } n += d; } return n / (a1 - a0 + 1); };
  const lo = it.v ? it.x0 : it.y0, hi = it.v ? it.x1 : it.y1;
  for (let q = 1; q <= Math.ceil(1.6 * ch); q += 1) { if (run(Math.round(hi + q)) > 0.85 || run(Math.round(lo - q)) > 0.85) return true; }
  return false;
}
/** Read dimension texts one row at a time (single-line mode, digits only, two sizes) — far more reliable than reading the whole sheet. */
async function readDimItems(src: HTMLCanvasElement, its: TItem[], say?: (s: string) => void): Promise<DDim[]> {
  const out: DDim[] = []; if (!its.length) return out; const PW = 2400, GX = 90;
  for (const [hTarget, wl] of [[34, true], [26, true]] as [number, boolean][]) {
    type Pl = { it: TItem; x: number; w: number; s: number; pad: number }; const rows: Pl[][] = [[]]; let cx = 20;
    for (const it of its) { const s = Math.max(1, Math.min(6, hTarget / Math.max(3, it.ch))); const pad = Math.round(0.3 * it.ch + 2); const L = (it.v ? it.y1 - it.y0 : it.x1 - it.x0) + 1 + 2 * pad; const w = Math.round(L * s); if (w > PW - 40) continue;
      if (cx + w > PW - 20) { rows.push([]); cx = 20; } rows[rows.length - 1].push({ it, x: cx, w, s, pad }); cx += w + GX; }
    for (let ri = 0; ri < rows.length; ri++) { const row = rows[ri]; if (!row.length) continue; say?.(`Reading dimensions ${ri + 1}/${rows.length}…`);
      const RH = Math.round(Math.max(...row.map(q => ((q.it.v ? q.it.x1 - q.it.x0 : q.it.y1 - q.it.y0) + 1 + 2 * q.pad) * q.s)) + 24);
      const cv = document.createElement('canvas'); cv.width = PW; cv.height = RH; const c = cv.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, PW, RH); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      for (const q of row) { const it = q.it; const sx = it.x0 - q.pad, sy = it.y0 - q.pad, sw = it.x1 - it.x0 + 1 + 2 * q.pad, sh = it.y1 - it.y0 + 1 + 2 * q.pad;
        c.save(); c.translate(q.x + q.w / 2, RH / 2); if (it.v) c.rotate(Math.PI / 2 * (it.rot || -1)); c.drawImage(src, sx, sy, sw, sh, -sw * q.s / 2, -sh * q.s / 2, sw * q.s, sh * q.s); c.restore(); }
      const R = await ocrWith(cv, { tessedit_pageseg_mode: '7', user_defined_dpi: '300', tessedit_char_whitelist: wl ? "0123456789'\"-/ " : '' });
      // group the words of this row by item (x centre), then try every reading
      const per = new Map<TItem, string[]>(); for (const w of R.words) { const mx = (w.x0 + w.x1) / 2; const q = row.find(q2 => mx >= q2.x - GX / 3 && mx <= q2.x + q2.w + GX / 3); if (!q) continue; (per.get(q.it) || per.set(q.it, []).get(q.it)!).push(w.text); }
      ((globalThis as any).__p3dDimDbg ||= []).push(`${hTarget}${wl ? 'w' : ''} r${ri}: ${row.length} items → ${R.text}`);
      for (const [it, ws] of per) { const txt = ws.join(' '); for (const m of parseDimLoose(txt)) out.push({ text: txt, m, x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1, v: it.v, item: it.id } as DDim); }
    }
  }
  return out;
}

/** Read every text item with the PP-OCR recognizer (one crop per item, vertical items both ways round). */
export async function ppTextItems(src: HTMLCanvasElement, items: TItem[], say?: (s: string) => void, maxItems = 600): Promise<OcrWord[]> {
  const words: OcrWord[] = []; const list = items.slice(0, maxItems); let i = 0;
  for (const it of list) {
    if (++i % 40 === 0) { say?.(`Reading labels and dimensions ${Math.round(i / list.length * 100)}%`); await new Promise(r => setTimeout(r, 0)); }
    const pad = Math.round(0.3 * it.ch + 2); const sx = it.x0 - pad, sy = it.y0 - pad, sw = it.x1 - it.x0 + 1 + 2 * pad, sh = it.y1 - it.y0 + 1 + 2 * pad;
    const crop = (rot: 0 | 1 | -1 | 2) => { const q = rot === 1 || rot === -1; const c = document.createElement('canvas'); const s = Math.max(1, 64 / (q ? sw : sh)); c.width = Math.round((q ? sh : sw) * s); c.height = Math.round((q ? sw : sh) * s); const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high';
      x.translate(c.width / 2, c.height / 2); if (rot) x.rotate(rot * Math.PI / 2); x.drawImage(src, sx, sy, sw, sh, -sw * s / 2, -sh * s / 2, sw * s, sh * s); return c; };
    let r: PPRead, rot: 0 | 1 | -1 = 0;
    if (it.v) { const a = await ppRead(crop(-1)), b = await ppRead(crop(1)); const sc = (q: PPRead) => q.conf * Math.min(1, q.text.length / 3) + (parseDimLoose(q.text).length ? 15 : 0); [r, rot] = sc(a) >= sc(b) ? [a, -1] : [b, 1]; it.rot = rot as 1 | -1; }
    else { r = await ppRead(crop(0)); const f = await ppRead(crop(2)); if (f.conf > r.conf + 10 && f.text.length >= r.text.length) r = f; } // upside-down text
    if (!r.text.trim() || r.conf < 35) continue;
    // split into words using where each character sat across the crop
    let cur: { c: string; x: number }[] = []; const flush = () => { if (!cur.length) return; const tx = cur.map(q => q.c).join(''); const a = cur[0].x, b = cur[cur.length - 1].x; const span = Math.max(0.02, (b - a) / Math.max(1, cur.length - 1));
      if (it.v) words.push({ text: tx, x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1, line: it.id * 4 + (rot === 1 ? 1 : 2), conf: r.conf, vert: true });
      else words.push({ text: tx, x0: sx + (a - span / 2) * sw, x1: sx + (b + span / 2) * sw, y0: it.y0, y1: it.y1, line: it.id * 4, conf: r.conf }); cur = []; };
    for (const ch of r.chars) { if (ch.c === ' ') flush(); else cur.push(ch); } flush();
  }
  return words;
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
  let textCh = 0; let usedPP = false; let dimItems: DDim[] = []; let tItems: TItem[] = (opts as any).tItems || [];
  if (opts.words) { words = opts.words; ocrOk = true; textCh = (opts as any).textCh || 0; } else if (opts.useOcr !== false) { try {
    const clean = cleanForOcr(cv, D, segs, W, H, Lmin); (globalThis as any).__p3dClean = clean; const ti = findTextItems(grayOf(clean), Math.min(225, Math.max(200, th + 40)), W, H); textCh = ti.ch; tItems = ti.items; (globalThis as any).__p3dItems = ti.items.map(i => ({ ...i, x0: i.x0 / k, y0: i.y0 / k, x1: i.x1 / k, y1: i.y1 / k }));
    if (ti.items.length >= 4) { say(`Reading ${ti.items.length} labels and dimensions…`); if (!(globalThis as any).__p3dNoPP && await ppReady()) { words = await ppTextItems(clean, ti.items, say); usedPP = true; } else words = await ocrTextItems(clean, ti.items, say); }
    if (words.length < 6) words = await ocr(clean, say); ocrOk = true;
    const dI = usedPP ? [] : ti.items.filter(it => onDimLine(it, D, W, H)).slice(0, 120); dimItems = dI.length ? await readDimItems(clean, dI, say) : []; } catch (e) { console.warn('OCR unavailable', e); } }
  else dimItems = (opts as any).dimItems || [];
  const dims = [...dimsFromWords(words), ...dimItems.map(d => ({ ...d }))];
  for (const d of dims) if (d.item == null) { const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2; const it = tItems.find(i => cx >= i.x0 - 2 && cx <= i.x1 + 2 && cy >= i.y0 - 2 && cy <= i.y1 + 2); if (it) d.item = it.id; }
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? D[(y | 0) * W + (x | 0)] : 0);
  // match each horizontal dimension text to the dimension line under/over it, split at tick marks
  const ratios: { r: number; d: DDim }[] = [];
  const spanLen = (d: { x0: number; y0: number; x1: number; y1: number; v?: boolean }) => {
    const o: 'h' | 'v' = d.v ? 'v' : 'h'; const ca = o === 'h' ? (d.x0 + d.x1) / 2 : (d.y0 + d.y1) / 2, cc = o === 'h' ? (d.y0 + d.y1) / 2 : (d.x0 + d.x1) / 2, hh = o === 'h' ? d.y1 - d.y0 : d.x1 - d.x0, tl = o === 'h' ? d.x1 - d.x0 : d.y1 - d.y0, N = o === 'h' ? W : H;
    const A = (al: number, ac: number) => (o === 'h' ? at(al, ac) : at(ac, al)); let best: Seg | null = null, bd = Infinity;
    for (const s of [...thin, ...segs]) { if (s.o !== o || s.a > ca || s.b < ca) continue; const dy = Math.abs(s.c - cc); if (dy < 2.4 * hh + 4 && dy < bd && s.b - s.a >= tl * 0.8) { bd = dy; best = s; } }
    if (!best) return 0;
    // walk along the dimension line in the raw mask from the text centre until a tick / arrow / extension line
    const c = Math.round(best.c), off = Math.ceil(best.t / 2) + 2;
    const onLine = (x: number) => A(x, c) || A(x, c - 1) || A(x, c + 1);
    const tick = (x: number) => { let up = 0, dn = 0; for (let q = off; q <= off + 4; q++) { up |= A(x, c - q); dn |= A(x, c + q); } return !!(up && dn); };
    const walk = (dir: number) => { let x = Math.round(ca), gap = 0, last = x; for (let n = 0; n < N; n++, x += dir) { if (x < 0 || x >= N) break; if (tick(x)) { let e = x; while (tick(e + dir)) e += dir; return (x + e) / 2; } if (onLine(x)) { gap = 0; last = x; } else if (++gap > 3) break; } return last; };
    const L = walk(1) - walk(-1); return L > tl * 0.8 ? L : 0;
  };
  for (const d of dims) { const L = spanLen(d); if (L) { d.px = L / k; ratios.push({ r: d.m / L, d }); } }
  let mpp = 0; let scaleFrom: 'ocr' | 'guess' | 'area' = 'guess'; let scaleNote = ''; let askDim: { text: string; m: number; px: number; x0: number; y0: number; x1: number; y1: number } | null = (opts as any).askDim || null;
  if (ratios.length) {
    const keyOf = (d: DDim) => d.item ?? Math.round(d.x0) * 7919 + Math.round(d.y0); const nKeys = (a: typeof ratios) => new Set(a.map(x => keyOf(x.d))).size, nVals = (a: typeof ratios) => new Set(a.map(x => Math.round(x.d.m * 100))).size;
    let bestSet: typeof ratios = []; for (const a of ratios.filter(x => x.d.px !== undefined)) { const set0 = ratios.filter(b => Math.abs(b.r / a.r - 1) < 0.025); const seen = new Set<number>(); const set = set0.filter(x => { const kk = keyOf(x.d); if (seen.has(kk)) return false; seen.add(kk); return true; }); if (set.length > bestSet.length || (set.length === bestSet.length && nVals(set) > nVals(bestSet))) bestSet = set; }
    const r = bestSet.reduce((s, x) => s + x.r, 0) / bestSet.length; const thickMax = Math.max(0, ...segs.map(s => s.t));
    // plausibility: walls 3–14" thick, the drawing's walls span 12–200 ft
    const ws0 = segs.filter(q => q.src === 'thick'); const ext = ws0.length ? Math.max(Math.max(...ws0.map(q => q.o === 'h' ? q.b : q.c)) - Math.min(...ws0.map(q => q.o === 'h' ? q.a : q.c)), Math.max(...ws0.map(q => q.o === 'v' ? q.b : q.c)) - Math.min(...ws0.map(q => q.o === 'v' ? q.a : q.c))) : 0;
    const plausibleR = (r2: number) => (!thickMax || (thickMax * r2 > 3 * IN && thickMax * r2 < 14 * IN)) && (!ext || (ext * r2 > 12 * FT && ext * r2 < 200 * FT));
    const plausible = plausibleR(r);
    // chain closure: two sub-dimensions that add up to an overall one (within 1") on lengths that add up too
    let chain: typeof ratios | null = null;
    for (const c of ratios) for (const a of ratios) for (const b of ratios) { if (chain || a === b || a === c || b === c || !a.d.px || !b.d.px || !c.d.px || keyOf(a.d) === keyOf(b.d) || !!a.d.v !== !!c.d.v || !!b.d.v !== !!c.d.v) continue;
      if (Math.abs(a.d.m + b.d.m - c.d.m) <= IN && Math.abs(a.d.px + b.d.px - c.d.px) <= 0.02 * c.d.px && plausibleR(c.r)) chain = [c, a, b]; }
    const strong = bestSet.length >= 2 && nVals(bestSet) >= 2;
    if (chain && (!strong || Math.abs(chain[0].r / r - 1) > 0.025)) { bestSet = chain; }
    if ((strong || chain) && plausibleR(bestSet === chain ? chain[0].r : r)) { mpp = bestSet === chain ? chain[0].r : r; scaleFrom = 'ocr'; scaleNote = bestSet === chain ? `from a dimension chain (${chain[1].d.text} + ${chain[2].d.text} = ${chain[0].d.text})` : `from ${bestSet.length} dimensions that agree (${bestSet.slice().sort((a2, b2) => b2.d.m - a2.d.m).map(x => normDim(x.d.text)).slice(0, 3).join(', ')})`; }
    else { const one = ratios.filter(x => plausibleR(x.r)).sort((a2, b2) => b2.d.m - a2.d.m)[0]; if (one) askDim = { text: normDim(one.d.text), m: one.d.m, px: one.d.px || 0, x0: one.d.x0 / k, y0: one.d.y0 / k, x1: one.d.x1 / k, y1: one.d.y1 / k }; }
  }
  // dimension lines the user can pick from (largest first) when the scale is not certain
  const cands: { x0: number; y0: number; x1: number; y1: number; v: boolean; px: number; text: string }[] = [];
  for (const it of tItems) { if (cands.length > 60) break; if (!onDimLine(it, D, W, H)) continue; const L = spanLen(it); if (!L) continue; const rd = dims.find(d => d.item === it.id && d.px); cands.push({ x0: it.x0 / k, y0: it.y0 / k, x1: it.x1 / k, y1: it.y1 / k, v: it.v, px: L / k, text: rd ? rd.text : '' }); }
  cands.sort((a2, b2) => b2.px - a2.px);
  if (opts.forceMpp) { mpp = opts.forceMpp; scaleFrom = (opts as any).keepGuess ? 'guess' : 'ocr'; scaleNote = opts.forceNote || 'set'; }
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
    if (bestSet.length >= 2 && new Set(bestSet.map(x => x.txt)).size >= 2) { const r = bestSet.reduce((s2, x) => s2 + x.r, 0) / bestSet.length; const note = `from ${bestSet.length} room size${bestSet.length > 1 ? 's' : ''} (${bestSet.slice(0, 2).map(x => x.txt).join(', ')}) — please check one wall`;
      if (Math.abs(r / mpp - 1) > 0.08) return analyze(img, { ...opts, forceMpp: r, forceNote: note, words, dimItems, tItems, askDim } as any);
      mpp = r; scaleFrom = 'ocr'; scaleNote = note; }
  }
  // still a guess: typical swing doors are 32" wide — a better ruler than wall thickness on small screenshots
  if (scaleFrom === 'guess' && !opts.forceMpp) {
    const dw = dOps.filter(o => o.kind === 'door' && (o.style === 'interior' || o.style === 'exterior')).map(o => o.w * k).sort((a, b) => a - b);
    if (dw.length >= 3) { const r = (32 * IN) / dw[dw.length >> 1]; if (Math.abs(r / mpp - 1) > 0.08) return analyze(img, { ...opts, forceMpp: r, forceNote: `guessed from ${dw.length} door widths (32" typical) — please check one wall`, words, dimItems, tItems, askDim, keepGuess: true } as any); }
  }
  // ceiling heights written in the rooms ("10'-0" CLG") → wall height
  let ceiling: number | null = null; { const hs: number[] = []; for (const ws2 of lineMap.values()) { const t = ws2.sort((a, b) => a.x0 - b.x0).map(w => w.text).join(' ').replace(/[°*″”]/g, '"').replace(/[′’~]/g, "'").replace(/(\d)[oO]/g, '$10').replace(/C[Il1]G/gi, 'CLG'); const m = /(\d{1,2}\s*'?\s*-?\s*\d{0,2}\s*"?)\s*(CLG|CEIL)/i.exec(t); const v = m ? parseDim(m[1].replace(/\s/g, '')) ?? parseDim(m[1].replace(/\s/g, '').replace(/^(\d+)-/, "$1'-")) : null; if (v && v > 7 * FT && v < 16 * FT) hs.push(v); }
    if (hs.length >= 2) { const cnt = new Map<number, number>(); hs.forEach(v => cnt.set(Math.round(v / IN), (cnt.get(Math.round(v / IN)) || 0) + 1)); ceiling = [...cnt].sort((a, b) => b[1] - a[1])[0][0] * IN; } }
  const allTxt = words.map(w => w.text).join(' ').toUpperCase(); const elevations = (allTxt.match(/ELEVATION/g) || []).length;
  { const m = /TOP\s*OF\s*(WALL|PLATE)[^0-9]{0,24}(\d{1,2}\s*'?\s*-?\s*\d{1,2}\s*"?)/.exec(allTxt); const v = m ? parseDim(m[2].replace(/\s/g, '')) : null; if (v && v > 7 * FT && v < 16 * FT) ceiling = v; }
  const scale = (p: { x: number; y: number }) => ({ x: p.x / k, y: p.y / k });
  const walls = dWalls.map(w => ({ a: scale(w.a), b: scale(w.b), t: w.t / k, ext: w.ext }));
  const longestDim = dims.reduce<DDim | null>((b, d) => (!b || d.m > b.m ? d : b), null);
  const sc = (d: DDim) => ({ ...d, x0: d.x0 / k, y0: d.y0 / k, x1: d.x1 / k, y1: d.y1 / k });
  return { w: W / k, h: H / k, walls, openings: dOps, rooms: dRooms, mpp: mpp * k, ceiling, elevations, scaleFrom, scaleNote, dims: dims.map(sc), longestDim: longestDim ? sc(longestDim) : null, ocrOk, askDim, cands: cands.slice(0, 12), words: words.map(w => ({ ...w, x0: w.x0 / k, y0: w.y0 / k, x1: w.x1 / k, y1: w.y1 / k })), ms: performance.now() - t0 };
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

/** Area of everything closed in by the walls (outside flood-fill), in detection pixels². */
export function footprintPx(det: Detection): number {
  const f = Math.min(1, 900 / Math.max(det.w, det.h)); const W = Math.ceil(det.w * f) + 2, H = Math.ceil(det.h * f) + 2; const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.strokeStyle = '#000'; x.lineCap = 'square'; for (const w of det.walls) { x.lineWidth = Math.max(3, w.t * f + 3); x.beginPath(); x.moveTo(w.a.x * f + 1, w.a.y * f + 1); x.lineTo(w.b.x * f + 1, w.b.y * f + 1); x.stroke(); }
  const d = x.getImageData(0, 0, W, H).data; const out = new Uint8Array(W * H); const st = [0]; out[0] = 1;
  while (st.length) { const j = st.pop()!; const px = j % W; for (const q of [j - 1, j + 1, j - W, j + W]) { if (q < 0 || q >= W * H || out[q] || Math.abs((q % W) - px) > 1 || d[q * 4] < 128) continue; out[q] = 1; st.push(q); } }
  let n = 0; for (let i = 0; i < W * H; i++) if (!out[i]) n++; return n / (f * f);
}
export interface AreaTable { ac?: number; garage?: number; lanai?: number; entry?: number; underRoof?: number; text: string }
/** Reads a "BUILDING AREA" table (A/C living, garage, lanai, under roof) from the sheet around the drawing. */
export async function readAreaTable(page: HTMLCanvasElement, skip: { x: number; y: number; w: number; h: number } | null, onProgress?: (s: string) => void): Promise<AreaTable | null> {
  const W = page.width, H = page.height; const sb = skip || { x: 0, y: 0, w: 0, h: 0 };
  const regs = skip ? [[0, sb.y + sb.h, W, H - sb.y - sb.h], [sb.x + sb.w, 0, W - sb.x - sb.w, H], [0, 0, W, sb.y], [0, 0, sb.x, H]].filter(r => r[2] > 40 && r[3] > 40) : [[0, 0, W, H]];
  const words: OcrWord[] = [];
  for (const [x0, y0, w, h] of regs) { const sc = Math.min(4, 4000 / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc); const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(page, x0, y0, w, h, 0, 0, c.width, c.height);
    const ws = await ocr(c, onProgress); const base = words.length ? Math.max(...words.map(q => q.line)) + 1 : 0; ws.forEach(q => words.push({ ...q, line: q.line + base })); }
  // group into rows by height (sparse-text mode puts each word on its own "line")
  const rows: OcrWord[][] = []; for (const w of [...words].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))) { const cy = (w.y0 + w.y1) / 2, hh = w.y1 - w.y0; const r = rows.find(r2 => r2[0].line === w.line - (w.line - r2[0].line) && Math.abs((r2[0].y0 + r2[0].y1) / 2 - cy) < Math.max(hh, r2[0].y1 - r2[0].y0) * 0.5 && Math.abs(r2[0].line - w.line) < 1e6); if (r) r.push(w); else rows.push([w]); }
  // split rows with a big horizontal gap (table vs. stamp text next to it)
  const lines = new Map<number, OcrWord[]>(); let li = 0; for (const r of rows) { r.sort((a, b) => a.x0 - b.x0); let cur: OcrWord[] = []; for (const w of r) { const hh = w.y1 - w.y0; if (cur.length && w.x0 - cur[cur.length - 1].x1 > hh * 25) { lines.set(li++, cur); cur = []; } cur.push(w); } if (cur.length) lines.set(li++, cur); }
  const T: AreaTable = { text: '' }; const num = (t: string) => { const m = /(\d{1,2},?\d{3}|\d{2,4})\s*(SQ|SF|S\.F)/i.exec(t) || /(\d{1,2},?\d{3}|\d{2,4})\s*$/.exec(t); return m ? +m[1].replace(',', '') : 0; };
  for (const ws of lines.values()) { const t = ws.sort((a, b) => a.x0 - b.x0).map(w => w.text).join(' ').toUpperCase(); const v = num(t); if (!v) continue;
    if (/UNDER\s*ROOF/.test(t)) T.underRoof = v; else if (/NON/.test(t)) continue; else if (/LIVING|A\/C|CONDITIONED/.test(t)) T.ac = v; else if (/GARAGE/.test(t)) T.garage = v; else if (/LANAI|PORCH|PATIO/.test(t)) T.lanai = (T.lanai || 0) + v; else if (/ENTRY/.test(t)) T.entry = v; }
  if (T.ac && T.ac < 800) delete T.ac; if (T.garage && (T.garage < 150 || T.garage > 1500)) delete T.garage; if (T.underRoof && T.underRoof < 900) delete T.underRoof;
  const parts = [T.ac && `A/C living ${T.ac}`, T.garage && `garage ${T.garage}`, T.lanai && `lanai ${T.lanai}`, T.entry && `entry ${T.entry}`, T.underRoof && `under roof ${T.underRoof}`].filter(Boolean);
  T.text = parts.join(', '); return parts.length ? T : null;
}

/** Download the text reader once (≈15 MB) so plan reading works offline later. */
export async function warmOcr() { const base = new URL(((import.meta as any).env?.BASE_URL || '/') + 'tesseract/', location.href).href; for (const f of ['worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'lang/eng.traineddata.gz']) { try { await fetch(base + f); } catch { return false; } } return true; }
