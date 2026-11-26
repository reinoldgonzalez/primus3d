#!/usr/bin/env bash
# Primus 3D photogrammetry pipeline (CPU-only, free/open source):
#   photos or video  ->  COLMAP (structure from motion)  ->  OpenMVS (dense, mesh, texture)  ->  GLB for the Primus 3D app
#
# Usage:
#   scan.sh <photo-folder | video-file> [output-dir] [options]
# Options (env vars):
#   FPS=2            frames per second to pull from a video (default 2)
#   MAX_FRAMES=90    cap on frames/photos used (default 90)
#   MAX_SIZE=1600    longest image side fed to COLMAP (default 1600)
#   QUALITY=fast     fast | normal | high   (dense resolution; fast is ~4x quicker)
#   TARGET_FACES=150000  face budget of the phone GLB (default 150k)
#   MATCHER=auto     auto | sequential | exhaustive (auto: sequential for video, exhaustive for <=60 photos)
# Output: <output-dir>/model.glb (+ model_full.glb, preview.png, report.txt)
# Notes: photogrammetry has NO real-world scale. In the app use "Set scale (2 points)" on a known length.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVS="${MVS:-$HERE/openmvs/bin/OpenMVS}"
PY="${PY:-$HERE/venv/bin/python}"
IN="${1:?give a photo folder or a video file}"
OUT="${2:-$HERE/jobs/$(date +%Y%m%d-%H%M%S)}"
FPS="${FPS:-2}"; MAX_FRAMES="${MAX_FRAMES:-90}"; MAX_SIZE="${MAX_SIZE:-1600}"; QUALITY="${QUALITY:-fast}"; TARGET_FACES="${TARGET_FACES:-150000}"; MATCHER="${MATCHER:-auto}"
THREADS="$(nproc)"
mkdir -p "$OUT"/{images,sparse,dense,logs}
OUT="$(cd "$OUT" && pwd)"
LOG="$OUT/logs"; T0=$(date +%s)
step() { echo "[$(date +%H:%M:%S)] $*"; }
elapsed() { echo $(( $(date +%s) - T0 ))s; }

# ---------- 1. images ----------
IS_VIDEO=0
if [ -f "$IN" ]; then
  IS_VIDEO=1; step "Extracting frames from video ($FPS fps, max $MAX_FRAMES, ${MAX_SIZE}px)"
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN" | cut -d. -f1); DUR=${DUR:-0}
  # lower fps automatically for long videos so we stay under MAX_FRAMES
  if [ "$DUR" -gt 0 ] && [ $(( DUR * FPS )) -gt "$MAX_FRAMES" ]; then FPS=$(python3 -c "print(round($MAX_FRAMES/$DUR,3))"); step "  long video (${DUR}s) -> using $FPS fps"; fi
  ffmpeg -v error -i "$IN" -vf "fps=$FPS,scale='if(gt(iw,ih),min($MAX_SIZE,iw),-2)':'if(gt(iw,ih),-2,min($MAX_SIZE,ih))'" -q:v 2 "$OUT/images/f%04d.jpg"
else
  step "Preparing photos from $IN"
  "$PY" - "$IN" "$OUT/images" "$MAX_SIZE" "$MAX_FRAMES" <<'PYEOF'
import sys, os, glob
from PIL import Image, ImageOps
src, dst, mx, cap = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
files = sorted(f for f in glob.glob(os.path.join(src, '*')) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.heic', '.webp', '.tif', '.tiff')))
if len(files) > cap: files = [files[round(i * (len(files) - 1) / (cap - 1))] for i in range(cap)]
for i, f in enumerate(files):
    try:
        im = ImageOps.exif_transpose(Image.open(f)).convert('RGB'); im.thumbnail((mx, mx)); im.save(os.path.join(dst, f'p{i:04d}.jpg'), quality=93)
    except Exception as e: print('skip', f, e)
print(len(os.listdir(dst)), 'images ready')
PYEOF
fi
N=$(ls "$OUT/images" | wc -l); step "$N images"
[ "$N" -ge 3 ] || { echo "Need at least 3 images (got $N)"; exit 2; }

# ---------- 2. COLMAP SfM (CPU) ----------
DB="$OUT/colmap.db"; rm -f "$DB"
step "COLMAP feature extraction"
colmap feature_extractor --database_path "$DB" --image_path "$OUT/images" --ImageReader.single_camera 1 --ImageReader.camera_model OPENCV \
  --SiftExtraction.use_gpu 0 --SiftExtraction.num_threads "$THREADS" --SiftExtraction.max_image_size "$MAX_SIZE" > "$LOG/feat.log" 2>&1
if [ "$MATCHER" = auto ]; then if [ "$IS_VIDEO" = 1 ] || [ "$N" -gt 60 ]; then MATCHER=sequential; else MATCHER=exhaustive; fi; fi
step "COLMAP $MATCHER matching"
if [ "$MATCHER" = sequential ]; then
  colmap sequential_matcher --database_path "$DB" --SiftMatching.use_gpu 0 --SiftMatching.num_threads "$THREADS" --SequentialMatching.overlap 12 --SequentialMatching.loop_detection 0 > "$LOG/match.log" 2>&1
else
  colmap exhaustive_matcher --database_path "$DB" --SiftMatching.use_gpu 0 --SiftMatching.num_threads "$THREADS" > "$LOG/match.log" 2>&1
fi
step "COLMAP mapping (camera poses)"
colmap mapper --database_path "$DB" --image_path "$OUT/images" --output_path "$OUT/sparse" --Mapper.num_threads "$THREADS" > "$LOG/mapper.log" 2>&1
# choose the largest reconstructed model
BEST=""; BESTN=0
for m in "$OUT"/sparse/*/; do [ -f "$m/images.bin" ] || continue; n=$(colmap model_analyzer --path "$m" 2>&1 | awk '/Registered images/{print $NF}' | tr -d '\r'); n=${n:-0}; if [ "$n" -gt "$BESTN" ]; then BEST="$m"; BESTN=$n; fi; done
[ -n "$BEST" ] || { echo "COLMAP could not reconstruct the scene (not enough overlap/texture). See $LOG/mapper.log"; exit 3; }
step "Registered $BESTN / $N images"
colmap image_undistorter --image_path "$OUT/images" --input_path "$BEST" --output_path "$OUT/dense" --output_type COLMAP --max_image_size "$MAX_SIZE" > "$LOG/undist.log" 2>&1
mkdir -p "$OUT/dense/sparse_txt"; colmap model_converter --input_path "$OUT/dense/sparse" --output_path "$OUT/dense/sparse_txt" --output_type TXT > /dev/null 2>&1

# ---------- 3. OpenMVS dense + mesh + texture (CPU) ----------
case "$QUALITY" in fast) RL=2; MR=1024;; normal) RL=1; MR=1600;; high) RL=0; MR=2400;; *) RL=2; MR=1024;; esac
cd "$OUT/dense"
step "OpenMVS import"
"$MVS/InterfaceCOLMAP" -i "$OUT/dense" -o scene.mvs --image-folder "$OUT/dense/images" -w "$OUT/dense" > "$LOG/interface.log" 2>&1
step "OpenMVS dense point cloud (quality=$QUALITY)"
"$MVS/DensifyPointCloud" scene.mvs -w "$OUT/dense" --resolution-level $RL --max-resolution $MR --number-views 5 --max-threads "$THREADS" --cuda-device -2 > "$LOG/densify.log" 2>&1 || \
"$MVS/DensifyPointCloud" scene.mvs -w "$OUT/dense" --resolution-level $RL --max-resolution $MR --number-views 5 --max-threads "$THREADS" > "$LOG/densify.log" 2>&1
step "OpenMVS mesh"
"$MVS/ReconstructMesh" scene_dense.mvs -w "$OUT/dense" --max-threads "$THREADS" > "$LOG/mesh.log" 2>&1
MESH=scene_dense_mesh.ply
step "OpenMVS texture"
"$MVS/TextureMesh" scene_dense.mvs -m "$MESH" -w "$OUT/dense" -o scene_textured.mvs --export-type glb --resolution-level 1 --max-texture-size 4096 --max-threads "$THREADS" --cuda-device -2 > "$LOG/texture.log" 2>&1 || \
"$MVS/TextureMesh" scene_dense.mvs -m "$MESH" -w "$OUT/dense" -o scene_textured.mvs --export-type glb --resolution-level 1 --max-texture-size 4096 --max-threads "$THREADS" > "$LOG/texture.log" 2>&1

# ---------- 4. GLB for the phone (level, center, decimate, compress textures) ----------
step "Exporting GLB"
"$PY" "$HERE/to_glb.py" --obj "$OUT/dense/scene_textured.glb" --cams "$OUT/dense/sparse_txt/images.txt" --out "$OUT/model.glb" --full "$OUT/model_full.glb" --faces "$TARGET_FACES" --preview "$OUT/preview.png" | tee "$LOG/glb.log"
cd "$OUT"
{
  echo "Primus 3D scan report"; echo "input: $IN"; echo "images: $N  registered: $BESTN  matcher: $MATCHER  quality: $QUALITY"
  echo "runtime: $(elapsed)"; cat "$LOG/glb.log"
  echo "NOTE: photogrammetry has no real scale. In Primus 3D: Scan settings -> Set scale (2 points) on a measured length, then Tap the floor."
} > "$OUT/report.txt"
step "Done in $(elapsed): $OUT/model.glb"
