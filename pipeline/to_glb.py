"""Convert OpenMVS textured OBJ to a phone-friendly GLB: level it (cameras' up = +Y), center it on the floor,
decimate geometry to a face budget while keeping the texture, and downscale the texture to 2048px."""
import argparse, numpy as np, trimesh, os
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument('--obj'); ap.add_argument('--cams'); ap.add_argument('--out'); ap.add_argument('--full'); ap.add_argument('--faces', type=int, default=150000); ap.add_argument('--preview')
a = ap.parse_args()

def qrot(q):
    w, x, y, z = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])

m = trimesh.load(a.obj, force='mesh', process=False)
if m.visual is not None and getattr(m.visual, "uv", None) is not None and getattr(m.visual.material, "baseColorTexture", None) is None and hasattr(m.visual.material, "image"): pass
print(f'loaded mesh: {len(m.vertices)} verts, {len(m.faces)} faces')
# --- level: average camera "up" (COLMAP camera y axis points down in image) ---
ups, centers = [], []
if a.cams and os.path.exists(a.cams):
    lines = [l for l in open(a.cams) if l.strip() and not l.startswith('#')]
    for l in lines[0::2]:
        p = l.split(); q = list(map(float, p[1:5])); t = np.array(list(map(float, p[5:8])))
        R = qrot(q); ups.append(-R[1]); centers.append(-R.T @ t)
up = np.mean(ups, axis=0) if ups else np.array([0, 1, 0.]); up /= np.linalg.norm(up)
# rotation taking `up` to +Y
y = np.array([0, 1., 0]); v = np.cross(up, y); s = np.linalg.norm(v); c = up @ y
if s < 1e-8: R = np.eye(3) if c > 0 else np.diag([1, -1, -1.])
else:
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]); R = np.eye(3) + vx + vx @ vx * ((1 - c) / s**2)
T = np.eye(4); T[:3, :3] = R; m.apply_transform(T)
# center x/z, put the lowest 2% of points at y=0 (rough floor; refine in the app with "Tap the floor")
vv = m.vertices; floor = np.percentile(vv[:, 1], 2); ctr = np.median(vv, axis=0)
m.apply_translation([-ctr[0], -floor, -ctr[2]])
ext = m.bounds[1] - m.bounds[0]
print(f'leveled; extent (model units, NOT meters until scaled): {ext.round(3).tolist()}')
if a.full: trimesh.Scene(geometry={'primus_photo_scan': m}).export(a.full)
# --- decimate keeping UVs (quadric with attribute-agnostic simplification on positions, then reproject UV by nearest) ---
full = m
if len(m.faces) > a.faces:
    import fast_simplification
    pts, fcs = fast_simplification.simplify(np.asarray(m.vertices, dtype=np.float32), np.asarray(m.faces), target_reduction=1 - a.faces / len(m.faces))
    uv = getattr(m.visual, 'uv', None)
    if uv is not None:
        from scipy.spatial import cKDTree
        idx = cKDTree(full.vertices).query(pts)[1]; nuv = uv[idx]
        mat = m.visual.material
        m = trimesh.Trimesh(pts, fcs, visual=trimesh.visual.TextureVisuals(uv=nuv, material=mat), process=False)
    else:
        m = trimesh.Trimesh(pts, fcs, process=False)
    print(f'decimated to {len(m.faces)} faces')
# --- downscale texture ---
try:
    mat = m.visual.material; img = getattr(mat, 'image', None) or getattr(mat, 'baseColorTexture', None)
    if img is not None and max(img.size) > 2048:
        img = img.copy(); img.thumbnail((2048, 2048)); 
        if hasattr(mat, 'image'): mat.image = img
        else: mat.baseColorTexture = img
        print('texture resized to', img.size)
except Exception as e: print('texture step skipped:', e)
trimesh.Scene(geometry={'primus_photo_scan': m}).export(a.out)
print(f'GLB written: {a.out} ({os.path.getsize(a.out)/1e6:.1f} MB), faces {len(m.faces)}')
if a.preview:
    try:
        sc = trimesh.Scene(m); png = sc.save_image(resolution=(800, 600)); open(a.preview, 'wb').write(png)
    except Exception as e: print('preview skipped (no offscreen GL):', str(e)[:80])
