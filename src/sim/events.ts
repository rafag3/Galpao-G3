// Eventos emitidos pela simulação a cada tick. Render, áudio e HUD reagem a
// eles sem que a simulação saiba que existem.

import type { Vec3 } from './math';

export type HitPart = 'head' | 'body';

export type SimEvent =
  | { type: 'shot'; origin: Vec3; direction: Vec3 }
  | { type: 'impact'; point: Vec3; normal: Vec3; onTarget: boolean }
  | { type: 'hit'; targetId: number; part: HitPart; damage: number; killed: boolean }
  | { type: 'dryFire' }
  | { type: 'reloadStart'; duration: number }
  | { type: 'reloadEnd' }
  | { type: 'targetRespawn'; targetId: number };

export class EventQueue {
  private events: SimEvent[] = [];

  push(e: SimEvent): void {
    this.events.push(e);
  }

  /** Retorna e esvazia a fila. */
  drain(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
