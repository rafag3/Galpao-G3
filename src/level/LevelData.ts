// O nível é DADO, não código de render. A física e o render leem a mesma
// descrição, então o que se vê é exatamente o que colide.

import type { Vec3 } from '../sim/math';

export type BlockKind =
  | 'floor'
  | 'wall'
  | 'crate'
  | 'container'
  | 'ramp'
  | 'ceiling'
  | 'roof'
  | 'pillar'
  | 'truck'
  | 'siteMarking';

export interface Block {
  kind: BlockKind;
  /** Centro do bloco, em metros. */
  position: [number, number, number];
  /** Dimensões totais (largura X, altura Y, profundidade Z), em metros. */
  size: [number, number, number];
  /** Rotação Euler em radianos (ordem Y → X → Z). */
  rotation?: [number, number, number];
  /** false = só visual (pintura de chão, por exemplo). Padrão: true. */
  collide?: boolean;
}

/** Alvo de treino com silhueta humana (corpo + cabeça). */
export interface TargetSpawn {
  /** Posição dos pés (x, z); fica sempre no chão em y = 0. */
  position: [number, number];
  /** Direção para onde o alvo olha (radianos; 0 = +Z). */
  yaw: number;
}

/** Retângulo no chão, em coordenadas de mundo (x, z). */
export interface Area {
  min: [number, number];
  max: [number, number];
}

export interface Bombsite extends Area {
  id: 'A' | 'B';
}

/** Posto de vigia de um bot: onde fica e para onde olha. */
export interface BotPost {
  position: [number, number];
  /** Direção vigiada (radianos; 0 = +Z). */
  watchYaw: number;
}

export interface LevelData {
  name: string;
  blocks: Block[];
  targets: TargetSpawn[];
  spawn: Vec3;
  /** Yaw inicial do jogador, em radianos. */
  spawnYaw: number;
  /** Áreas de plantio da bomba (usadas a partir da Fase 5). */
  bombsites?: Bombsite[];
  /** Zonas de nascimento das equipes (usadas a partir da Fase 5). */
  spawnZones?: { attack: Area; defense: Area };
  /** Postos dos bots da defesa. Sem isto, o nível não tem bots. */
  defensePosts?: BotPost[];
}
