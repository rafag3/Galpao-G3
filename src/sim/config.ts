// Parâmetros de movimento. Ficam num lugar só para ajuste de "feel".
// Unidades: metros, segundos, radianos.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const MOVE = {
  walkSpeed: 4.6,
  runSpeed: 6.4,
  crouchSpeed: 2.2,
  groundAccel: 45, // m/s² para atingir a velocidade alvo no chão
  airAccel: 8, // controle no ar, propositalmente baixo
  gravity: 20,
  jumpSpeed: 6.0, // pulo de ~0,9 m
  maxFallSpeed: 30,
};

export const BODY = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.15,
  /** Distância do topo da cabeça até os olhos. */
  eyeFromTop: 0.12,
  /** Velocidade de transição da câmera ao agachar/levantar (m/s). */
  eyeLerpSpeed: 6,
  stepHeight: 0.35,
  maxSlopeDeg: 45,
};

export const LOOK = {
  maxPitch: (89 * Math.PI) / 180,
};

/** Silhueta dos alvos (também usada pelo render, para bater com a hitbox). */
export const TARGET = {
  health: 100,
  respawnSeconds: 3,
  body: { width: 0.5, height: 1.5, depth: 0.3 }, // de y = 0 a 1,5 m
  head: { size: 0.26, centerY: 1.66 },
};

export const COMBAT = {
  playerHealth: 100,
  botHealth: 100,
  playerRespawnSeconds: 3,
  botRespawnSeconds: 6,
};

/**
 * Parâmetros da IA (dificuldade "normal", calibrada para touch). Ângulos em radianos.
 * Referência medida: jogador parado a 13 m morre em ~2 s.
 * Os bots usam a MESMA arma do jogador: dispersão e recuo valem para eles.
 */
export const BOT = {
  /** Tempo entre ver o inimigo e o primeiro tiro. */
  reactionSeconds: 0.6,
  viewDistance: 45, // tela de celular: além disso o alvo vira poucos pixels
  /** Meio-ângulo do campo de visão. */
  halfFov: (60 * Math.PI) / 180,
  /** Perto assim, percebe mesmo de costas (passos). */
  proximitySense: 4,
  /** Ouve tiros até esta distância. */
  hearingDistance: 30,
  /** Intervalo entre checagens de visão (raycast é caro). */
  visionInterval: 0.15,
  /** Velocidade máxima de giro da mira. */
  turnSpeed: 4.5,
  /** Erro de mira ao avistar → erro após rastrear por `aimSettleSeconds`. */
  aimErrorStart: 0.1,
  aimErrorEnd: 0.016,
  aimSettleSeconds: 2,
  /** Só atira com a mira a menos disto do alvo. */
  fireCone: 0.05,
  burstSeconds: [0.2, 0.45] as const,
  pauseSeconds: [0.3, 0.65] as const,
  /** Tempo indo à última posição conhecida antes de desistir. */
  chaseSeconds: 8,
  /** Quanto tempo a informação de um avistamento vale para a equipe. */
  teamInfoSeconds: 6,
  repathSeconds: 1,
  arriveRadius: 0.7,
};

/** Regras de rodada (CS simplificado, tempos encurtados para celular). */
export const ROUND = {
  freezeSeconds: 3,
  roundSeconds: 90,
  bombSeconds: 35,
  plantSeconds: 3,
  defuseSeconds: 5,
  /** Distância máxima até a bomba para desarmar. */
  defuseRange: 1.6,
  /** Passar a menos disto de uma bomba caída a pega. */
  pickupRange: 1.2,
  postRoundSeconds: 5,
  winsToMatch: 5,
  /** Explosão: letal até `lethalRadius`, dano cai a zero em `maxRadius`. */
  explosionLethalRadius: 8,
  explosionMaxRadius: 20,
  /** Quem planta/desarma precisa estar quase parado. */
  maxUseSpeed: 0.6,
};

/** Parte da IA que muda com a dificuldade. */
export interface BotSkill {
  reactionSeconds: number;
  viewDistance: number;
  turnSpeed: number;
  aimErrorStart: number;
  aimErrorEnd: number;
  aimSettleSeconds: number;
  burstSeconds: readonly [number, number];
  pauseSeconds: readonly [number, number];
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Referência medida (jogador parado a 13 m, mediana do tempo até morrer):
 * fácil ~2,9 s · normal ~1,7 s · difícil ~1,0 s.
 */
export const SKILLS: Record<Difficulty, BotSkill> = {
  easy: {
    reactionSeconds: 0.95,
    viewDistance: 35,
    turnSpeed: 3,
    aimErrorStart: 0.16,
    aimErrorEnd: 0.035,
    aimSettleSeconds: 3,
    burstSeconds: [0.15, 0.3],
    pauseSeconds: [0.5, 0.9],
  },
  normal: {
    reactionSeconds: BOT.reactionSeconds,
    viewDistance: BOT.viewDistance,
    turnSpeed: BOT.turnSpeed,
    aimErrorStart: BOT.aimErrorStart,
    aimErrorEnd: BOT.aimErrorEnd,
    aimSettleSeconds: BOT.aimSettleSeconds,
    burstSeconds: BOT.burstSeconds,
    pauseSeconds: BOT.pauseSeconds,
  },
  hard: {
    reactionSeconds: 0.38,
    viewDistance: 55,
    turnSpeed: 6,
    aimErrorStart: 0.06,
    aimErrorEnd: 0.009,
    aimSettleSeconds: 1.2,
    burstSeconds: [0.25, 0.5],
    pauseSeconds: [0.25, 0.5],
  },
};
