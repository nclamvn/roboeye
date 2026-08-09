// Metric lift: từ depth map ĐƠN VỊ MÉT + focal (pixel) nâng 2D box thành 3D box
// kích thước mét thật, hệ toạ độ camera KITTI (X phải, Y xuống, Z tới, gốc principal point).
// Thuần toán, không phụ thuộc three, để test độc lập trong Node/headless.

export interface Box2DNorm {
  label: string;
  score: number;
  x0: number; // normalized 0..1 gốc trên-trái
  y0: number;
  x1: number;
  y1: number;
}

export interface MetricBox3D {
  center: [number, number, number]; // mét, camera coords
  dims: [number, number, number]; // [rộng W(x), cao H(y), dài L(z)] mét
  bottomCenter: [number, number, number]; // đáy hộp, cho KITTI location
  distance: number; // Z tâm hộp, mét
}

/** focal (pixel) từ FOV ngang (độ) và chiều rộng ảnh. */
export function focalFromFov(fovDeg: number, width: number): number {
  return width / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * Nâng danh sách 2D box qua depth mét + focal.
 * depth: Float32Array w*h, đơn vị mét, hàng 0 = mép trên ảnh (KHÔNG mirror).
 * Trả về mảng cùng thứ tự boxes, phần tử null nếu box không có depth hợp lệ.
 */
export function metricLift(
  depth: Float32Array,
  w: number,
  h: number,
  focal: number,
  boxes: Box2DNorm[]
): Array<MetricBox3D | null> {
  const cx = w / 2;
  const cy = h / 2;
  const out: Array<MetricBox3D | null> = [];

  for (const b of boxes) {
    const px0 = Math.max(0, Math.min(w - 1, Math.round(b.x0 * w)));
    const px1 = Math.max(0, Math.min(w - 1, Math.round(b.x1 * w)));
    const py0 = Math.max(0, Math.min(h - 1, Math.round(b.y0 * h)));
    const py1 = Math.max(0, Math.min(h - 1, Math.round(b.y1 * h)));

    // Lấy mẫu depth trong box, bỏ giá trị vô lệ (<=0 hoặc quá xa)
    const samples: number[] = [];
    const SN = 9;
    for (let iy = 1; iy < SN; iy++) {
      for (let ix = 1; ix < SN; ix++) {
        const px = Math.round(px0 + ((px1 - px0) * ix) / SN);
        const py = Math.round(py0 + ((py1 - py0) * iy) / SN);
        const z = depth[py * w + px];
        if (z > 0.05 && z < 100) samples.push(z);
      }
    }
    if (samples.length < 4) {
      out.push(null);
      continue;
    }
    samples.sort((a, c) => a - c);
    // vật gần hơn nền: dùng percentile thấp làm mặt gần, trung vị làm mặt xa
    const zNear = samples[Math.floor(samples.length * 0.15)];
    const zFar = samples[Math.floor(samples.length * 0.6)];

    // Back-project 8 góc ở zNear và zFar
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const zs = [zNear, zFar];
    for (const z of zs) {
      for (const [px, py] of [
        [px0, py0], [px1, py0], [px1, py1], [px0, py1]
      ]) {
        const X = ((px - cx) * z) / focal;
        const Y = ((py - cy) * z) / focal;
        if (X < minX) minX = X;
        if (X > maxX) maxX = X;
        if (Y < minY) minY = Y;
        if (Y > maxY) maxY = Y;
      }
    }
    const wX = maxX - minX;
    const hY = maxY - minY;
    const lZ = Math.max(0, zFar - zNear);
    const cX = (minX + maxX) / 2;
    const cY = (minY + maxY) / 2;
    const cZ = (zNear + zFar) / 2;
    out.push({
      center: [cX, cY, cZ],
      dims: [wX, hY, lZ],
      bottomCenter: [cX, maxY, cZ], // Y xuống nên đáy là maxY
      distance: cZ
    });
  }
  return out;
}

/**
 * Xuất KITTI label. Mỗi dòng 15 trường:
 * type truncated occluded alpha bbox(x0 y0 x1 y1) dimensions(h w l) location(x y z) rotation_y
 * Box axis-aligned nên rotation_y=0, alpha=-10 (không xác định hướng).
 */
export function toKittiLines(boxes2d: Box2DNorm[], metric: Array<MetricBox3D | null>, imgW: number, imgH: number): string {
  const lines: string[] = [];
  boxes2d.forEach((b, i) => {
    const m = metric[i];
    if (!m) return;
    const type = b.label.replace(/\s+/g, '_');
    const x0 = (b.x0 * imgW).toFixed(2);
    const y0 = (b.y0 * imgH).toFixed(2);
    const x1 = (b.x1 * imgW).toFixed(2);
    const y1 = (b.y1 * imgH).toFixed(2);
    const [wX, hY, lZ] = m.dims;
    const [lx, ly, lz] = m.bottomCenter;
    lines.push(
      [
        type, '0.00', '0', '-10',
        x0, y0, x1, y1,
        hY.toFixed(2), wX.toFixed(2), lZ.toFixed(2),
        lx.toFixed(2), ly.toFixed(2), lz.toFixed(2),
        '0.00'
      ].join(' ')
    );
  });
  return lines.join('\n') + (lines.length ? '\n' : '');
}
