// Bám mượt khung nhận diện (P1-B tuning). Detection chạy vài fps nên khung nhảy
// giật giữa các lần suy luận. Lớp này:
//   1) Ghép khung giữa các lần suy luận (IoU + cùng label) rồi NỘI SUY vị trí mỗi
//      frame render → khung TRÔI mượt theo vật thay vì nhảy phắt.
//   2) XÁC NHẬN: một khung phải xuất hiện >= minHits lần liên tiếp mới được vẽ →
//      loại box rác chớp-tắt (ví dụ giơ tay lóe thành "person" một nhịp).
//   3) GIỮ: khi vật tạm mất vài nhịp (<= maxMissed) vẫn giữ khung → bớt nhấp nháy.
// Thuần toán, không phụ thuộc DOM/three, để test độc lập trong Node.

import type { DetBox } from './detection-types';

interface Track {
  box: DetBox;    // vị trí ĐANG hiển thị (đã mượt)
  target: DetBox; // detection mới nhất khớp track này
  hits: number;   // số lần suy luận liên tiếp khớp được
  missed: number; // số lần suy luận không khớp
}

export interface SmootherOptions {
  iouMatch: number;    // ngưỡng IoU coi là cùng một vật giữa hai lần suy luận
  centerGate: number;  // hoặc khớp nếu tâm gần nhau <= ngưỡng này (bắt vật di chuyển nhanh, box không chồng)
  minHits: number;     // phải khớp đủ số lần này mới bắt đầu vẽ (chống box rác)
  maxMissed: number;   // giữ track thêm số lần suy luận khi tạm mất (chống nhấp nháy)
  tauMs: number;       // hằng số thời gian nội suy; nhỏ = bám nhanh, lớn = mượt hơn
}

const DEFAULTS: SmootherOptions = { iouMatch: 0.3, centerGate: 0.18, minHits: 2, maxMissed: 2, tauMs: 90 };

function iou(a: DetBox, b: DetBox): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const uni = areaA + areaB - inter;
  return uni > 0 ? inter / uni : 0;
}

function centerDist(a: DetBox, b: DetBox): number {
  const dx = (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2;
  const dy = (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2;
  return Math.hypot(dx, dy);
}

export class DetectionSmoother {
  private tracks: Track[] = [];
  private opt: SmootherOptions;

  constructor(opt: Partial<SmootherOptions> = {}) {
    this.opt = { ...DEFAULTS, ...opt };
  }

  reset(): void {
    this.tracks = [];
  }

  /** Gọi mỗi khi có kết quả detection mới (message 'det'). */
  observe(boxes: DetBox[]): void {
    const usedDet = new Array(boxes.length).fill(false);
    // Ghép tham lam từng track hiện có với detection cùng label, IoU cao nhất.
    for (const track of this.tracks) {
      let best = -1;
      let bestScore = -Infinity;
      for (let di = 0; di < boxes.length; di++) {
        if (usedDet[di] || boxes[di].label !== track.target.label) continue;
        const v = iou(track.box, boxes[di]);
        const cd = centerDist(track.box, boxes[di]);
        // Khớp nếu CHỒNG LẤN đủ (vật chậm) HOẶC tâm đủ gần (vật nhanh, box không chồng).
        if (v < this.opt.iouMatch && cd > this.opt.centerGate) continue;
        // Ưu tiên chồng lấn nhiều / tâm gần.
        const score = v - cd;
        if (score > bestScore) { bestScore = score; best = di; }
      }
      if (best >= 0) {
        usedDet[best] = true;
        track.target = boxes[best];
        track.hits++;
        track.missed = 0;
      } else {
        track.missed++;
      }
    }
    // Detection chưa khớp track nào → track mới, chờ đủ minHits mới được vẽ.
    for (let di = 0; di < boxes.length; di++) {
      if (usedDet[di]) continue;
      this.tracks.push({ box: { ...boxes[di] }, target: { ...boxes[di] }, hits: 1, missed: 0 });
    }
    // Bỏ track quá hạn không thấy lại.
    this.tracks = this.tracks.filter((t) => t.missed <= this.opt.maxMissed);
  }

  /** Gọi mỗi frame render với dt (ms). Trả về khung đã mượt, đủ điều kiện vẽ. */
  advance(dtMs: number): DetBox[] {
    const k = 1 - Math.exp(-Math.max(0, dtMs) / this.opt.tauMs);
    const out: DetBox[] = [];
    for (const t of this.tracks) {
      t.box = {
        label: t.target.label,
        score: t.target.score,
        x0: t.box.x0 + (t.target.x0 - t.box.x0) * k,
        y0: t.box.y0 + (t.target.y0 - t.box.y0) * k,
        x1: t.box.x1 + (t.target.x1 - t.box.x1) * k,
        y1: t.box.y1 + (t.target.y1 - t.box.y1) * k
      };
      // track quá hạn đã bị loại trong observe(); ở đây chỉ cần đủ minHits là vẽ.
      if (t.hits >= this.opt.minHits) out.push(t.box);
    }
    return out;
  }
}
