// Painel de diagnóstico: FPS, draw calls e estado do jogador.
// Atualiza 4x por segundo para não pesar no frame.

import type { Engine } from '@babylonjs/core/Engines/engine';
import type { PlayerState } from '../sim/PlayerController';

export class DebugHud {
  private readonly el: HTMLDivElement;
  private acc = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-hud';
    parent.append(this.el);
  }

  update(dt: number, engine: Engine, p: PlayerState, drawCalls: number): void {
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const state = p.crouching ? 'agachado' : p.grounded ? 'no chão' : 'no ar';
    this.el.textContent =
      `${engine.getFps().toFixed(0)} fps · ${drawCalls} draws · ` +
      `${speed.toFixed(1)} m/s · ${state} · ` +
      `x ${p.feet.x.toFixed(1)}  y ${p.feet.y.toFixed(2)}  z ${p.feet.z.toFixed(1)}`;
  }
}
