// Intenções do jogador, independentes do dispositivo. Teclado/mouse e touch
// produzem a MESMA estrutura; a simulação nunca sabe de onde veio o comando.
// No multiplayer, é isso que o cliente enviará ao servidor a cada tick.

export interface MoveIntent {
  /** Lateral: -1 esquerda, +1 direita. */
  moveX: number;
  /** Frente/trás: +1 frente, -1 trás. */
  moveZ: number;
  run: boolean;
  crouch: boolean;
  /** Pedido de pulo. É consumido pelo próximo tick da simulação. */
  jump: boolean;
}

export const emptyIntent = (): MoveIntent => ({
  moveX: 0,
  moveZ: 0,
  run: false,
  crouch: false,
  jump: false,
});

/** Fonte de input (teclado/mouse, touch, futuramente gamepad). */
export interface InputSource {
  /** Preenche o intent com o estado atual desta fonte (combina com os demais). */
  sample(into: MoveIntent): void;
  /** Retorna e zera o giro acumulado desde a última leitura, em radianos. */
  consumeLook(): { yaw: number; pitch: number };
  /** Retorna true uma vez por toque/tecla de pulo. */
  consumeJump(): boolean;
  dispose(): void;
}
