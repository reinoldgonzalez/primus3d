/** Customer share link with no server and no login: the project (without photos/scans) is compressed into the URL itself. */
import { Project } from './model';

export interface Biz { name: string; phone: string; email: string; license: string; tagline: string }
export function getBiz(): Biz { try { return { name: 'Primus', phone: '', email: '', license: '', tagline: 'Construction · Cape Coral, FL', ...JSON.parse(localStorage.getItem('p3d-biz') || '{}') }; } catch { return { name: 'Primus', phone: '', email: '', license: '', tagline: '' }; } }
export function setBiz(b: Biz) { localStorage.setItem('p3d-biz', JSON.stringify(b)); }

const b64u = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s: string) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function pipe(data: Uint8Array, stream: any): Promise<Uint8Array> { const r = new Blob([data as any]).stream().pipeThrough(stream); return new Uint8Array(await new Response(r).arrayBuffer()); }

export async function encodeProject(P: Project): Promise<string> {
  const lite: any = JSON.parse(JSON.stringify(P)); lite.background = null; lite.scan = null; lite.photos = []; lite.biz = getBiz();
  // round coordinates to the millimetre: shorter link, same accuracy
  const json = JSON.stringify(lite, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));
  const u8 = new TextEncoder().encode(json);
  if (typeof (globalThis as any).CompressionStream === 'function') return 'z' + b64u(await pipe(u8, new (globalThis as any).CompressionStream('deflate-raw')));
  return 'j' + b64u(u8);
}
export async function decodeProject(s: string): Promise<Project & { biz?: Biz }> {
  const u8 = unb64u(s.slice(1)); const raw = s[0] === 'z' ? await pipe(u8, new (globalThis as any).DecompressionStream('deflate-raw')) : u8;
  return JSON.parse(new TextDecoder().decode(raw));
}
export async function shareUrl(P: Project) { return location.origin + location.pathname + '#v=' + (await encodeProject(P)); }
