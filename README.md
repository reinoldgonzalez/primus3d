# Primus 3D

Free web app (PWA) for Primus to design rooms, homes and yards to exact size and show customers in 2D and 3D.
Works on iPhone (Safari → Share → Add to Home Screen), Android Chrome and Windows. Saves on the device (IndexedDB), works offline.

Live: https://reinoldgonzalez.github.io/primus3d/

## Features
- 2D plan (precise) + 3D orbit + walk-through, synced; split view on wide screens.
- Quick room (type W × L), draw walls with typed lengths (ft-in or metric), snapping, dimensions, undo/redo.
- Doors (interior, exterior, French, pocket, bifold, sliding glass, garage), windows (single-hung, slider, picture, bay).
- Rooms / outdoor areas with materials, curved edges (beds, paths), concrete curbing.
- Parametric catalog (~100 items): kitchen, bath, laundry, furniture, stairs, lighting, pools, screen cage, pavers, pergola, deck, dock, seawall, fence, shed, AC, palms, trees… All geometry is generated in code (no third‑party model files/licenses).
- Blueprint / survey / aerial import (image or PDF) with 2‑point scale calibration, tracing.
- 3D scan import: GLB, glTF (embedded), OBJ, PLY, STL, USDZ; Apple RoomPlan USDZ and RoomPlan JSON auto-create editable walls, doors, windows and objects at real (metric) scale.
- Design on a yard photo (plants, materials, curbing, before/after).
- Takeoff with your own unit prices, branded proposal PDF, PNG, DXF, 3D screenshot, project JSON backup.

## Dev
```
npm install
npm run dev
npm run build   # GITHUB_PAGES=true for the /primus3d/ base
```

## Photo / video → 3D pipeline (`pipeline/`)

Free, open-source photogrammetry: COLMAP (camera poses) + OpenMVS (dense cloud, mesh, texture), CPU only.

```bash
# needs: colmap, ffmpeg, OpenMVS binaries, python3 with trimesh fast-simplification scipy pillow
MVS=/path/to/OpenMVS/bin PY=python3 ./pipeline/scan.sh my_walkaround.mp4 out/      # or a folder of photos
# options: QUALITY=fast|normal|high  FPS=2  MAX_FRAMES=90  TARGET_FACES=150000
```

Output: `out/model.glb` (leveled, centered, ≤150k faces, 2048px texture). Import it in the app with
☰ → Import 3D scan. Photo/video scans have **no real-world size**: the app asks you to tap **Set scale**
on a length you measured (iPhone LiDAR / RoomPlan scans are already in meters).
