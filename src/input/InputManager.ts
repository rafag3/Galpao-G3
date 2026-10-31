// Junta todas as fontes de input num único MoveIntent por tick.

import { emptyIntent, type InputSource, type MoveIntent } from './InputIntents';

export class InputManager {
  private readonly sources: InputSource[] = [];
  private jumpLatched = false;
  private reloadLatched = false;
  private fireLatched = false;

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
   * Coleta as ações de toque único a cada frame e as mantém até um tick
   * consumi-las. Sem isso, um toque rápido entre dois ticks se perderia.
   */
  pollFrame(): void {
    for (const s of this.sources) {
      const p = s.consumePressed();
      this.jumpLatched ||= p.jump;
      this.reloadLatched ||= p.reload;
      this.fireLatched ||= p.fire;
    }
  }

  /** Descarta ações pendentes (ao pausar, por exemplo). */
  clearLatched(): void {
    this.jumpLatched = this.reloadLatched = this.fireLatched = false;
  }

  /** Intent para UM tick de simulação, com a visão atual do jogador. */
  sampleTick(yaw: number, pitch: number): MoveIntent {
    const intent = emptyIntent(yaw, pitch);
    for (const s of this.sources) s.sample(intent);
    intent.moveX = Math.max(-1, Math.min(1, intent.moveX));
    intent.moveZ = Math.max(-1, Math.min(1, intent.moveZ));
    intent.jump = this.jumpLatched;
    intent.reload = this.reloadLatched;
    // Toque mais curto que um tick ainda dispara
    intent.fire ||= this.fireLatched;
    this.clearLatched();
    return intent;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
  }
}
