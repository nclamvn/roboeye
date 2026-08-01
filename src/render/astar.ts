// A* 8 hướng trên grid NxN với binary heap.
// cost: ô free 1, ô unknown (ngoài quạt FOV) phạt nhẹ — robot ưu tiên vùng đã thấy
// nhưng vẫn đi qua được vùng chưa biết (optimistic unknown, đúng thói quen robotics).
// Ô blocked (occupied đã inflate) tuyệt đối không đi.

export const COST_FREE = 0;
export const COST_UNKNOWN = 1;
export const COST_BLOCKED = 255;

const SQRT2 = Math.SQRT2;

/** heap nhị phân tối giản cho (score, index) */
class Heap {
  private score: number[] = [];
  private item: number[] = [];
  get size() {
    return this.item.length;
  }
  push(s: number, i: number) {
    this.score.push(s);
    this.item.push(i);
    let c = this.item.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.score[p] <= this.score[c]) break;
      this.swap(p, c);
      c = p;
    }
  }
  pop(): number {
    const top = this.item[0];
    const lastS = this.score.pop()!;
    const lastI = this.item.pop()!;
    if (this.item.length > 0) {
      this.score[0] = lastS;
      this.item[0] = lastI;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < this.item.length && this.score[l] < this.score[m]) m = l;
        if (r < this.item.length && this.score[r] < this.score[m]) m = r;
        if (m === p) break;
        this.swap(p, m);
        p = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.score[a], this.score[b]] = [this.score[b], this.score[a]];
    [this.item[a], this.item[b]] = [this.item[b], this.item[a]];
  }
}

/**
 * Tìm đường từ start tới goal trên costMap (COST_FREE/COST_UNKNOWN/COST_BLOCKED).
 * Trả về mảng ô [ci, cj] gồm cả start và goal, hoặc null khi không có đường.
 */
export function astar(
  costMap: Uint8Array,
  N: number,
  start: [number, number],
  goal: [number, number]
): Array<[number, number]> | null {
  const idx = (ci: number, cj: number) => cj * N + ci;
  const [sci, scj] = start;
  const [gci, gcj] = goal;
  if (costMap[idx(gci, gcj)] === COST_BLOCKED || costMap[idx(sci, scj)] === COST_BLOCKED) return null;

  const g = new Float32Array(N * N).fill(Infinity);
  const parent = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const open = new Heap();

  const h = (ci: number, cj: number) => {
    // octile heuristic, admissible với chi phí chéo SQRT2
    const dx = Math.abs(ci - gci);
    const dy = Math.abs(cj - gcj);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };

  const s = idx(sci, scj);
  g[s] = 0;
  open.push(h(sci, scj), s);

  const goalIdx = idx(gci, gcj);

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goalIdx) break;
    closed[cur] = 1;
    const ci = cur % N;
    const cj = (cur / N) | 0;

    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;
        const nIdx = idx(ni, nj);
        if (closed[nIdx]) continue;
        const cellCost = costMap[nIdx];
        if (cellCost === COST_BLOCKED) continue;
        // chặn lách chéo qua khe giữa hai ô blocked
        if (di !== 0 && dj !== 0) {
          if (costMap[idx(ci + di, cj)] === COST_BLOCKED || costMap[idx(ci, cj + dj)] === COST_BLOCKED) continue;
        }
        const step = (di !== 0 && dj !== 0 ? SQRT2 : 1) * (1 + cellCost * 0.8);
        const ng = g[cur] + step;
        if (ng < g[nIdx]) {
          g[nIdx] = ng;
          parent[nIdx] = cur;
          open.push(ng + h(ni, nj), nIdx);
        }
      }
    }
  }

  if (parent[goalIdx] === -1 && goalIdx !== s) return null;

  const path: Array<[number, number]> = [];
  let cur = goalIdx;
  while (cur !== -1) {
    path.push([cur % N, (cur / N) | 0]);
    if (cur === s) break;
    cur = parent[cur];
  }
  path.reverse();
  return path;
}
