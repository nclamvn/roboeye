# Completion Reports · TIP-01 → TIP-04

Thợ nộp 01/08/2026. Môi trường build: container cloud Cowork, Node 22, Chromium headless (không GPU thật).

## REPORT TIP-01 · M1

**STATUS:** DONE

**FILES:** `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/types.ts`, `src/worker/depth-worker.ts`, `src/ui/shell.ts`, `src/styles.css`, `scripts/copy-ort.mjs`

**TEST:** smoke test bước 3–4: model load, depth frame về, badge INFER và RENDER hiển thị backend thật. PASS.

**DEVIATIONS:**
1. *Tự host runtime WASM của onnxruntime* (`/ort/` qua `scripts/copy-ort.mjs`) thay vì để transformers.js gọi CDN jsdelivr mặc định. Lý do: bỏ một điểm chết mạng lúc runtime, khớp mục 9 PRD về sinh viên mạng yếu. Contract không đổi. (L1, ghi lại)
2. *Thêm switch `?localmodels=1`* load model từ `/models/` trên chính origin. Lý do gốc: container chặn trình duyệt ra internet nên smoke test cần model local; giữ lại vì cho luôn khả năng demo offline. Mặc định vẫn HF Hub. (L1)
3. *WASM fallback dùng dtype q8* thay vì fp16 (fp16 CPU rất chậm); vẫn báo thật trên badge và tự hạ inference size về 140 theo mục 9 PRD. (L1)

**ISSUES:** không.

## REPORT TIP-02 · M2

**STATUS:** DONE

**FILES:** `src/render/scene.ts` (point cloud TSL nằm tại đây để chia sẻ texture nodes)

**TEST:** smoke bước 5 + screenshot `02-cloud.png`: khối 3D dựng từ fake webcam nhận ra được, màu RGB khớp và mirror đúng, gridHelper sàn hiển thị. PASS. Số điểm: WebGPU 448×336 = 150.528 (≥100k, R4 đạt); fallback WebGL 192×144 = 27.648 (~30k theo mục 9 PRD).

**DEVIATIONS:**
1. *Màu point cloud lấy từ frame capture cùng độ phân giải inference* (DataTexture do app kiểm soát) thay vì VideoTexture full-res. Lý do: kiểm soát tuyệt đối orientation giữa depth và màu trên cả hai backend, tránh lệch flipY giữa WebGL và WebGPU. Trade-off màu mềm hơn một chút ở chế độ cloud. (L1)
2. *Sprite instanced (SpriteNodeMaterial + count)* thay cho InstancedMesh: cùng pattern TSL examples chính thức, tiết kiệm 9.6MB instanceMatrix không dùng. (L1)

**ISSUES:** render fps trong container chỉ 1–2 do software GL, không đại diện máy thật. Đo thật tại nghiệm thu M1 trên máy Chủ nhà.

## REPORT TIP-03 · M3

**STATUS:** DONE

**FILES:** `src/render/bev.ts`, `src/ui/shell.ts`, `src/styles.css`, `index.html`

**TEST:** smoke bước 5 + screenshot `03-bev.png`: cụm ô occupied trắng trong quạt FOV, wedge dashed, marker camera, grid hairline. Đi lại trước camera chưa kiểm được trong container (fake video cố định) nên chuyển vào checklist nghiệm thu tay. Shell HIVE: sidebar đen 192px, serif brand, monochrome tuyệt đối, phím 1-4 PASS.

**DEVIATIONS:** ước lượng sàn bằng percentile 5 của y mỗi frame (PRD không chỉ định cách tìm sàn). Băng vật cản 0.18–2.0 đơn vị trên sàn, ngưỡng 3 điểm/ô, EMA α 0.35, hysteresis 0.55/0.35. Tất cả là hằng số trong `bev.ts`, đổi được không ảnh hưởng kiến trúc. (L1)

**ISSUES:** không.

## REPORT TIP-04 · M4

**STATUS:** DONE

**FILES:** `index.html` (panel), `src/ui/shell.ts`, `README.md`, `tests/smoke.mjs`, `docs/*`

**TEST:** smoke bước 8–9: panel mở phím ?, đủ 4 đoạn giải thích tiếng Việt, freeze tag hiển thị. Làn fallback `?webgl=1&wasm=1` chạy trọn pipeline trong container: model load, depth về, 4 chế độ chuyển, không lỗi console. TẤT CẢ PASS (`tests/smoke.mjs`, 14/14 check).

**DEVIATIONS:** không.

**SUGGESTIONS cho Chủ thầu:**
1. Container dùng Chromium bản cũ thiếu API `swizzle` mà three r185 WebGPU cần, nên làn WebGPU thật chỉ kiểm được trên máy Chủ nhà với Chrome/Edge mới. Đã ghi vào checklist nghiệm thu.
2. Phase 2 có thể thêm nút "Chụp PNG point cloud" một dòng code, hữu ích cho slide bài giảng của các team.

## REPORT TIP-05 + TIP-06 (phase 2)

**STATUS:** DONE

**FILES:** `src/render/astar.ts` (mới), `src/render/bev.ts` (viết lại: tách grid layer offscreen + compose mỗi frame), `src/render/scene.ts` (click đặt đích, compose theo render loop), `src/ui/shell.ts` + `index.html` + `src/styles.css` (alert chip, panel), `src/main.ts` (nối status), `README.md` (demo script v2), `tests/smoke.mjs` (+2 check).

**TEST:** smoke 15/15 PASS. Screenshot `07-bev-goal.png`: path A* 50 bước vòng qua cụm occupied, robot + đích + chip cảnh báo 0.9 đv hiển thị đúng.

**DEVIATIONS:** khoảng cách cảnh báo hiển thị bằng "đv" (đơn vị tương đối) thay vì mét vì depth là relative (F11), giữ kỷ luật trung thực thay vì quy đổi giả. (L1)

**ISSUES:** không.
