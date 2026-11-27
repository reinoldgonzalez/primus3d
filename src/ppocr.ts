/**
 * Small-print text reader: PP-OCRv6 tiny recognition model (PaddleOCR, Apache-2.0, 4.5 MB)
 * run in the browser with onnxruntime-web (MIT) on WebAssembly. Self-hosted under /ppocr and /ort, cached for offline.
 * We do our own text-line finding (autoconvert.findTextItems), so only the recognizer is needed.
 */
let sess: any = null, ort: any = null, dict: string[] = [], failed = false;
const base = () => new URL(((import.meta as any).env?.BASE_URL || '/'), location.href).href;
export const PP_FILES = ['ppocr/rec_tiny.onnx', 'ppocr/dict.json', 'ort/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.mjs'];
export async function ppReady(): Promise<boolean> {
  if (sess) return true; if (failed) return false;
  try {
    ort = await import('onnxruntime-web/wasm'); ort.env.wasm.wasmPaths = base() + 'ort/'; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    const [m, d] = await Promise.all([fetch(base() + 'ppocr/rec_tiny.onnx').then(r => { if (!r.ok) throw new Error('model ' + r.status); return r.arrayBuffer(); }), fetch(base() + 'ppocr/dict.json').then(r => r.json())]);
    dict = d; sess = await ort.InferenceSession.create(new Uint8Array(m), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return true;
  } catch (e) { console.warn('PP-OCR unavailable', e); failed = true; return false; }
}
export type PPRead = { text: string; conf: number; chars: { c: string; x: number }[] };
/** Read one text line image (any size; it is scaled to 48 px high). x of each char is 0..1 across the image. */
export async function ppRead(cv: HTMLCanvasElement): Promise<PPRead> {
  const H = 48; const w = Math.max(16, Math.min(1600, Math.round(cv.width * H / cv.height))); const W = Math.ceil(w / 8) * 8;
  const t = document.createElement('canvas'); t.width = W; t.height = H; const c = t.getContext('2d', { willReadFrequently: true })!; c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.imageSmoothingQuality = 'high'; c.drawImage(cv, 0, 0, w, H);
  const px = c.getImageData(0, 0, W, H).data; const x = new Float32Array(3 * H * W);
  for (let i = 0; i < H * W; i++) { x[i] = px[i * 4 + 2] / 127.5 - 1; x[H * W + i] = px[i * 4 + 1] / 127.5 - 1; x[2 * H * W + i] = px[i * 4] / 127.5 - 1; } // BGR
  const feeds: any = {}; feeds[sess.inputNames[0]] = new ort.Tensor('float32', x, [1, 3, H, W]);
  const out = await sess.run(feeds); const o = out[sess.outputNames[0]]; const [, T, C] = o.dims; const p = o.data as Float32Array;
  let prev = -1, text = '', cs = 0, n = 0; const chars: { c: string; x: number }[] = [];
  for (let ti = 0; ti < T; ti++) { let bi = 0, bv = -1; for (let k = 0; k < C; k++) { const v = p[ti * C + k]; if (v > bv) { bv = v; bi = k; } }
    if (bi !== 0 && bi !== prev) { const ch = bi - 1 < dict.length ? dict[bi - 1] : ' '; text += ch; chars.push({ c: ch, x: (ti + 0.5) / T * W / w }); cs += bv; n++; } prev = bi; }
  return { text, conf: n ? (cs / n) * 100 : 0, chars };
}
export async function warmPP(): Promise<boolean> { for (const f of PP_FILES) { try { const r = await fetch(base() + f); if (!r.ok) return false; const cache = await caches.open('ocr-local'); await cache.put(base() + f, r.clone()); } catch { return false; } } return true; }
