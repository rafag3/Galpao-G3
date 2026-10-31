// Junta todas as fontes de input num único MoveIntent por tick.

import { emptyIntent, type InputSource, type MoveIntent } from './InputIntents';

export class InputManager {
  private readonly sources: InputSource[] = [];
  private jumpLatched = false;

  add(source: InputSource): void {
    this.sources.push(source);
  }

  /** Giro acumulado desde o último frame (todas as fontes somadas). */
  consumeLook(): { yaw: number; pitch: number } {
    let yaw = 0;
    let pitch = 0;
    for (const s of this.sources) {
      const l = s.consumeLook();
      yaw += l.yaw;
      pitch += l.pitch;
    }
    return { yaw, pitch };
  }

  /**
   * Coleta o pulo a cada frame e o mantém até um tick consumi-lo. Sem isso,
   * um toque rápido entre dois ticks poderia se perder.
   */
  pollFrame(): void {
    for (const s of this.sources) if (s.consumeJump()) this.jumpLatched = true;
  }

  /** Intent para UM tick de simulação. */
  sampleTick(): MoveIntent {
    const intent = emptyIntent();
    for (const s of this.sources) s.sample(intent);
    intent.moveX = Math.max(-1, Math.min(1, intent.moveX));
    intent.moveZ = Math.max(-1, Math.min(1, intent.moveZ));
    intent.jump = this.jumpLatched;
    this.jumpLatched = false;
    return intent;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
  }
}
