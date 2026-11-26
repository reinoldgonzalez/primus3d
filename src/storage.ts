import { Project, store, migrate } from './model';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('primus3d', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(d => new Promise<T>((res, rej) => {
    const t = d.transaction(storeName, mode); const s = t.objectStore(storeName);
    const r = fn(s); let val: any;
    if (r) r.onsuccess = () => { val = r.result; };
    t.oncomplete = () => res(val); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
export interface ProjectMeta { id: string; name: string; updated: number; thumb?: string; client?: string }

export async function saveProject(p: Project, thumb?: string) {
  const rec = { id: p.id, name: p.name, client: p.client, updated: p.updated, thumb, json: JSON.stringify(p) };
  await tx('projects', 'readwrite', s => s.put(rec));
  // persist assets referenced
  for (const id of assetIds(p)) { const b = store.assets.get(id); if (b) await tx('assets', 'readwrite', s => s.put(b, id)); }
  await tx('meta', 'readwrite', s => s.put(p.id, 'last'));
  store.dirty = false;
}
export async function listProjects(): Promise<ProjectMeta[]> {
  const all: any[] = await tx('projects', 'readonly', s => s.getAll());
  return (all || []).map(r => ({ id: r.id, name: r.name, updated: r.updated, thumb: r.thumb, client: r.client })).sort((a, b) => b.updated - a.updated);
}
export async function loadProject(id: string): Promise<Project | null> {
  const r: any = await tx('projects', 'readonly', s => s.get(id));
  if (!r) return null;
  const p = migrate(JSON.parse(r.json));
  for (const aid of assetIds(p)) { const b: any = await tx('assets', 'readonly', s => s.get(aid)); if (b) store.assets.set(aid, b); }
  return p;
}
export async function deleteProject(id: string) {
  const p = await loadProject(id);
  await tx('projects', 'readwrite', s => s.delete(id));
  if (p) for (const aid of assetIds(p)) await tx('assets', 'readwrite', s => s.delete(aid));
}
export async function lastProjectId(): Promise<string | null> { return (await tx<any>('meta', 'readonly', s => s.get('last'))) || null; }
export function assetIds(p: Project): string[] { return [p.background?.assetId, p.scan?.assetId, ...(p.photos || []).map(x => x.assetId)].filter(Boolean) as string[]; }

// --- JSON export/import (assets inlined as base64 data URLs) ---
function blobToDataURL(b: Blob): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b); }); }
export async function exportProjectJSON(p: Project): Promise<Blob> {
  const assets: Record<string, string> = {};
  for (const id of assetIds(p)) { const b = store.assets.get(id); if (b) assets[id] = await blobToDataURL(b); }
  return new Blob([JSON.stringify({ app: 'primus3d', format: 1, project: p, assets })], { type: 'application/json' });
}
export async function importProjectJSON(text: string): Promise<Project> {
  const j = JSON.parse(text);
  const p = migrate(j.project || j);
  if (j.assets) for (const [id, url] of Object.entries<string>(j.assets)) { const r = await fetch(url); store.assets.set(id, await r.blob()); }
  return p;
}
export async function requestPersist() { try { await (navigator as any).storage?.persist?.(); } catch { /* ignore */ } }
