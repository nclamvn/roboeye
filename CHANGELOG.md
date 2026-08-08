# CHANGELOG · RoboEye

Ghi theo TIP. Chi tiết kỹ thuật trong docs/COMPLETION-REPORTS.md.

## v2 · Engine perception + auto-label (02/08/2026)

### P1-B · TIP-08 — Công cụ auto-label trưởng thành
- Detection đa-engine: RT-DETR (COCO nhanh) và OWL-ViT (open-vocabulary, gõ chữ ra lớp).
- Panel review vật thể: chọn, sửa lớp (double-click), xoá.
- Export ba định dạng: COCO JSON, YOLO txt, RoboEye-3D JSON (cờ scale=relative).
- Smoke 24/24.

### P1-A · TIP-07 — Engine v2 fusion 2D→3D
- Worker detection RT-DETR, latest-frame-wins.
- Nâng 2D box + depth thành 3D wireframe box trong point cloud (3D từ camera đơn, không LiDAR).
- Overlay 2D SVG, badge số vật. Smoke 18/18.

## v1.1 · Phase 2 demo (01/08/2026)

### TIP-05 / TIP-06 — Alert + robot ảo A*
- Obstacle alert khoảng cách tương đối trong quạt FOV.
- A* 8 hướng trên BEV grid, robot ảo click-đặt-đích, replan mỗi depth frame.
- Smoke 15/15.

## v1.0 · Demo perception (01/08/2026)

### M1-M4
- Webcam → depth (Depth Anything V2 Small, WebGPU worker) → point cloud 150k → BEV occupancy → panel giải thích.
- Fallback WebGL2 + WASM, badge nói thật, switch ?webgl ?wasm ?localmodels.
- Nghiệm thu máy thật: 14-15fps inference WebGPU 336px (đóng fact F10). Smoke 14/14.
- Lên public GitHub Pages.
