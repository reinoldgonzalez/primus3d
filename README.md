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
