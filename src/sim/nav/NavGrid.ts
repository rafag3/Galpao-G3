// Navegação em grade (células de 0,5 m) gerada a partir do LevelData.
// A* em 8 direções, sem cortar quinas, com suavização por linha de visão.
// Roda no Node (servidor futuro) e é determinístico.

import type { LevelData } from '../../level/LevelData';
import { BODY } from '../config';

export type Point2 = { x: number; z: number };

const CELL = 0.5;
const SQRT2 = Math.SQRT2;

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  /** 1 = bloqueado. */
  private readonly blocked: Uint8Array;

  constructor(level: LevelData) {
    const floor = level.blocks.find((b) => b.kind === 'floor');
    if (!floor) throw new Error('Nível sem bloco de chão');
    this.minX = floor.position[0] - floor.size[0] / 2;
    this.minZ = floor.position[2] - floor.size[2] / 2;
    this.cols = Math.ceil(floor.size[0] / CELL);
    this.rows = Math.ceil(floor.size[2] / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);

    // Obstáculo = sólido que ocupa a altura de caminhada (acima de um degrau)
    const inflate = BODY.radius + 0.05;
    const obstacles = level.blocks.filter((b) => {
      if (b.collide === false || b.kind === 'floor') return false;
      const [rx, , rz] = b.rotation ?? [0, 0, 0];
      if (rx !== 0 || rz !== 0) return false; // rampas: caminháveis
      const bottom = b.position[1] - b.size[1] / 2;
      const top = b.position[1] + b.size[1] / 2;
      return bottom < BODY.standHeight && top > BODY.stepHeight;
    });

    for (const b of obstacles) {
      const yaw = b.rotation?.[1] ?? 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const hx = b.size[0] / 2 + inflate;
      const hz = b.size[2] / 2 + inflate;
      // Faixa de células candidatas: raio do retângulo girado
      const reach = Math.hypot(hx, hz);
      const c0 = this.col(b.position[0] - reach);
      const c1 = this.col(b.position[0] + reach);
      const r0 = this.row(b.position[2] - reach);
      const r1 = this.row(b.position[2] + reach);
      for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) {
          const p = this.center(c, r);
          const dx = p.x - b.position[0];
          const dz = p.z - b.position[2];
          // Para o espaço local do bloco (rotação inversa em Y)
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;
          if (Math.abs(lx) < hx && Math.abs(lz) < hz) this.blocked[r * this.cols + c] = 1;
        }
      }
    }
  }

  private col(x: number) {
    return Math.floor((x - this.minX) / CELL);
  }
  private row(z: number) {
    return Math.floor((z - this.minZ) / CELL);
  }
  private center(c: number, r: number): Point2 {
    return { x: this.minX + (c + 0.5) * CELL, z: this.minZ + (r + 0.5) * CELL };
  }

  isFree(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.blocked[r * this.cols + c] === 0;
  }

  isFreeAt(p: Point2): boolean {
    return this.isFree(this.col(p.x), this.row(p.z));
  }

  /** Célula livre mais próxima (busca em anéis). */
  nearestFree(p: Point2, maxRadius = 12): Point2 | null {
    const c0 = this.col(p.x);
    const r0 = this.row(p.z);
    if (this.isFree(c0, r0)) return this.center(c0, r0);
    for (let rad = 1; rad <= maxRadius; rad++) {
      let best: Point2 | null = null;
      let bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad || !this.isFree(c0 + dc, r0 + dr)) continue;
          const q = this.center(c0 + dc, r0 + dr);
          const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Linha reta livre entre dois pontos (amostrada a cada 1/4 de célula). */
  lineFree(a: Point2, b: Point2): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / (CELL / 4));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      if (!this.isFreeAt({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
    }
    return true;
  }

  /**
   * Caminho de `from` até `to` como lista de pontos (sem o ponto inicial).
   * Retorna null se não houver caminho.
   */
  findPath(from: Point2, to: Point2): Point2[] | null {
    const start = this.nearestFree(from);
    const goal = this.nearestFree(to);
    if (!start || !goal) return null;
    const sc = this.col(start.x);
    const sr = this.row(start.z);
    const gc = this.col(goal.x);
    const gr = this.row(goal.z);
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - gc);
      const dz = Math.abs(r - gr);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz); // distância octil
    };
    const s = sr * this.cols + sc;
    const goalIdx = gr * this.cols + gc;
    g[s] = 0;
    heap.push(s, h(sc, sr));

    while (heap.size) {
      const cur = heap.pop();
      if (cur === goalIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const c = cur % this.cols;
      const r = (cur - c) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (!this.isFree(nc, nr)) continue;
          if (dc && dr && (!this.isFree(c + dc, r) || !this.isFree(c, r + dr))) continue; // quina
          const ni = nr * this.cols + nc;
          if (closed[ni]) continue;
          const ng = g[cur] + (dc && dr ? SQRT2 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            parent[ni] = cur;
            heap.push(ni, ng + h(nc, nr));
          }
        }
      }
    }
    if (parent[goalIdx] === -1 && goalIdx !== s) return null;

    // Reconstrói e suaviza: pula pontos intermediários com linha de visão
    const raw: Point2[] = [];
    for (let i = goalIdx; i !== -1; i = parent[i]) raw.push(this.center(i % this.cols, Math.floor(i / this.cols)));
    raw.reverse();
    const smooth: Point2[] = [];
    let anchor = from;
    let i = 0;
    while (i < raw.length) {
      let j = raw.length - 1;
      while (j > i && !this.lineFree(anchor, raw[j])) j--;
      smooth.push(raw[j]);
      anchor = raw[j];
      i = j + 1;
    }
    return smooth;
  }

  /** Comprimento de um caminho em metros (para testes e decisões da IA). */
  static length(from: Point2, path: readonly Point2[]): number {
    let d = 0;
    let p = from;
    for (const q of path) {
      d += Math.hypot(q.x - p.x, q.z - p.z);
      p = q;
    }
    return d;
  }
}

/** Heap binário mínimo de índices com prioridade (A*). */
class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];

  get size() {
    return this.ids.length;
  }

  push(id: number, p: number) {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      ids[i] = ids[up];
      pri[i] = pri[up];
      i = up;
    }
    ids[i] = id;
    pri[i] = p;
  }

  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && pri[r] < pri[l] ? r : l;
        if (pri[m] >= lastP) break;
        ids[i] = ids[m];
        pri[i] = pri[m];
        i = m;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}
