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
