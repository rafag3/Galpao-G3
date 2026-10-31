// Autoria de mapa por áreas caminháveis: o mapa é descrito como uma lista de
// retângulos onde se pode andar, e as paredes são geradas para todo o resto.
// Isso elimina frestas e paredes sobrepostas, comuns ao posicionar paredes à mão.

import type { Block } from './LevelData';

/** Retângulo em metros na planta: [x0, y0, x1, y1] (y da planta = z do mundo). */
export type PlanRect = [number, number, number, number];

export interface GridSpec {
  width: number; // metros
  depth: number; // metros
  /** Deslocamento planta → mundo (o centro do mapa vira a origem). */
  offsetX: number;
  offsetZ: number;
}

export function isWalkable(walk: readonly PlanRect[], x: number, y: number): boolean {
  return walk.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
}

/**
 * Gera blocos sólidos para todas as células de 1 m que não são caminháveis,
 * fundindo células vizinhas em retângulos grandes (greedy meshing). Poucos
 * blocos grandes = poucos colliders e geometria leve.
 */
export function solidBlocks(walk: readonly PlanRect[], grid: GridSpec, height: number): Block[] {
  const { width: W, depth: D } = grid;
  const solid = (x: number, y: number) => !isWalkable(walk, x + 0.5, y + 0.5);
  const used = Array.from({ length: W }, () => new Array<boolean>(D).fill(false));
  const blocks: Block[] = [];

  for (let y = 0; y < D; y++) {
    for (let x = 0; x < W; x++) {
      if (used[x][y] || !solid(x, y)) continue;
      // Estende em x
      let x1 = x + 1;
      while (x1 < W && !used[x1][y] && solid(x1, y)) x1++;
      // Estende em y enquanto a faixa inteira for sólida e livre
      let y1 = y + 1;
      outer: while (y1 < D) {
        for (let i = x; i < x1; i++) if (used[i][y1] || !solid(i, y1)) break outer;
        y1++;
      }
      for (let i = x; i < x1; i++) for (let j = y; j < y1; j++) used[i][j] = true;

      const w = x1 - x;
      const d = y1 - y;
      blocks.push({
        kind: 'wall',
        position: [x + w / 2 + grid.offsetX, height / 2, y + d / 2 + grid.offsetZ],
        size: [w, height, d],
      });
    }
  }
  return blocks;
}
