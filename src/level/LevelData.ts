// O nível é DADO, não código de render. A física e o render leem a mesma
// descrição, então o que se vê é exatamente o que colide.

import type { Vec3 } from '../sim/math';

export type BlockKind = 'floor' | 'wall' | 'crate' | 'container' | 'ramp' | 'ceiling' | 'target';

export interface Block {
  kind: BlockKind;
  /** Centro do bloco, em metros. */
  position: [number, number, number];
  /** Dimensões totais (largura X, altura Y, profundidade Z), em metros. */
  size: [number, number, number];
  /** Rotação Euler em radianos (ordem Y → X → Z). */
  rotation?: [number, number, number];
}

export interface LevelData {
  name: string;
  blocks: Block[];
  spawn: Vec3;
  /** Yaw inicial do jogador, em radianos. */
  spawnYaw: number;
}
