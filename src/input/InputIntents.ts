// Intenções do jogador, independentes do dispositivo. Teclado/mouse e touch
// produzem a MESMA estrutura; a simulação nunca sabe de onde veio o comando.
// No multiplayer, é exatamente isto que o cliente enviará ao servidor a cada
// tick (por isso inclui os ângulos de visão absolutos).

export interface MoveIntent {
  /** Lateral: -1 esquerda, +1 direita. */
  moveX: number;
  /** Frente/trás: +1 frente, -1 trás. */
  moveZ: number;
  run: boolean;
  crouch: boolean;
  /** Pedido de pulo. Consumido pelo tick. */
  jump: boolean;
  /** Gatilho pressionado. */
  fire: boolean;
  /** Pedido de recarga. Consumido pelo tick. */
  reload: boolean;
  /** Ângulos de visão absolutos (radianos). */
  yaw: number;
  pitch: number;
}

export const emptyIntent = (yaw = 0, pitch = 0): MoveIntent => ({
  moveX: 0,
  moveZ: 0,
  run: false,
  crouch: false,
  jump: false,
  fire: false,
  reload: false,
  yaw,
  pitch,
});

/** Ações de toque único, que não podem se perder entre dois ticks. */
export interface PressedActions {
  jump: boolean;
  reload: boolean;
  /** Gatilho apertado neste intervalo, mesmo que já tenha sido solto. */
  fire: boolean;
}

export const noPressed = (): PressedActions => ({ jump: false, reload: false, fire: false });

/** Fonte de input (teclado/mouse, touch, futuramente gamepad). */
export interface InputSource {
  /** Preenche o intent com o estado contínuo desta fonte (combina com as demais). */
  sample(into: MoveIntent): void;
  /** Retorna e zera o giro acumulado desde a última leitura, em radianos. */
  consumeLook(): { yaw: number; pitch: number };
  /** Retorna e zera as ações de toque único. */
  consumePressed(): PressedActions;
  dispose(): void;
}
