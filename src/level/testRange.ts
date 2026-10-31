// Cenário de teste da Fase 0: área cinza com obstáculos que exercitam
// cada mecânica de movimento (degraus, rampa, cobertura, túnel baixo).

import type { Block, LevelData } from './LevelData';

const SIZE = 40; // área de 40 x 40 m
const WALL_H = 5;
const WALL_T = 0.5;

const blocks: Block[] = [
  // Piso (topo em y = 0)
  { kind: 'floor', position: [0, -0.25, 0], size: [SIZE, 0.5, SIZE] },

  // Paredes externas (limites do cenário)
  { kind: 'wall', position: [0, WALL_H / 2, SIZE / 2], size: [SIZE, WALL_H, WALL_T] },
  { kind: 'wall', position: [0, WALL_H / 2, -SIZE / 2], size: [SIZE, WALL_H, WALL_T] },
  { kind: 'wall', position: [SIZE / 2, WALL_H / 2, 0], size: [WALL_T, WALL_H, SIZE] },
  { kind: 'wall', position: [-SIZE / 2, WALL_H / 2, 0], size: [WALL_T, WALL_H, SIZE] },

  // Caixas de cobertura (1,2 m: dá para se esconder agachado)
  { kind: 'crate', position: [-4, 0.6, 6], size: [1.2, 1.2, 1.2] },
  { kind: 'crate', position: [-2.8, 0.6, 6], size: [1.2, 1.2, 1.2] },
  { kind: 'crate', position: [-3.4, 1.8, 6], size: [1.2, 1.2, 1.2] },
  { kind: 'crate', position: [5, 0.6, 4], size: [1.2, 1.2, 1.2], rotation: [0, 0.4, 0] },

  // Contêineres (escala real: 6 x 2,6 x 2,4 m)
  { kind: 'container', position: [8, 1.3, 12], size: [6, 2.6, 2.4] },
  { kind: 'container', position: [-10, 1.3, 12], size: [2.4, 2.6, 6] },

  // Escada: degraus de 20 cm (testa o autostep)
  ...[0, 1, 2, 3, 4, 5, 6].map<Block>((i) => ({
    kind: 'crate',
    position: [12, 0.1 + i * 0.1, -4 - i * 0.4],
    size: [3, 0.2 + i * 0.2, 0.4],
  })),

  // Rampa (~17°) até uma plataforma de 1,5 m
  { kind: 'ramp', position: [-10, 0.75, -4], size: [3, 0.2, 5.2], rotation: [0.29, 0, 0] },
  { kind: 'crate', position: [-10, 0.75, -9], size: [5, 1.5, 5] },

  // Túnel baixo (1,4 m de vão): só passa agachado
  { kind: 'wall', position: [0, 0.7, -12], size: [0.4, 1.4, 4] },
  { kind: 'wall', position: [2.2, 0.7, -12], size: [0.4, 1.4, 4] },
  { kind: 'ceiling', position: [1.1, 1.6, -12], size: [2.8, 0.4, 4] },

  // Alvos (usados a partir da Fase 2)
  { kind: 'target', position: [-6, 1.2, 17], size: [0.6, 2.4, 0.2] },
  { kind: 'target', position: [0, 1.2, 17], size: [0.6, 2.4, 0.2] },
  { kind: 'target', position: [6, 1.2, 17], size: [0.6, 2.4, 0.2] },
];

export const testRange: LevelData = {
  name: 'Campo de testes',
  blocks,
  spawn: { x: 0, y: 1, z: 0 },
  spawnYaw: 0,
};
