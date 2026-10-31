// Eventos emitidos pela simulação a cada tick. Render, áudio e HUD reagem a
// eles sem que a simulação saiba que existem.
//
// Ids de entidade: 'player', 'bot:0', 'bot:1'…, 'target:0'…

import type { Vec3 } from './math';

export type HitPart = 'head' | 'body';
export type EntityId = string;

export type SimEvent =
  | { type: 'shot'; shooter: EntityId; origin: Vec3; direction: Vec3 }
  | { type: 'impact'; point: Vec3; normal: Vec3; onEntity: boolean }
  | { type: 'hit'; attacker: EntityId; victim: EntityId; part: HitPart; damage: number; killed: boolean }
  | { type: 'dryFire'; shooter: EntityId }
  | { type: 'reloadStart'; shooter: EntityId; duration: number }
  | { type: 'reloadEnd'; shooter: EntityId }
  | { type: 'respawn'; id: EntityId }
  | { type: 'roundStart'; round: number }
  | { type: 'freezeEnd' }
  | { type: 'bombPickup'; by: EntityId }
  | { type: 'bombDropped'; position: Vec3 }
  | { type: 'bombPlanted'; by: EntityId; site: 'A' | 'B'; position: Vec3 }
  | { type: 'bombDefused'; by: EntityId }
  | { type: 'bombExploded'; position: Vec3 }
  | { type: 'roundEnd'; winner: 'attack' | 'defense'; reason: RoundEndReason }
  | { type: 'matchEnd'; winner: 'attack' | 'defense' };

export type RoundEndReason = 'elimination' | 'bomb' | 'defused' | 'time';

export class EventQueue {
  private events: SimEvent[] = [];

  push(e: SimEvent): void {
    this.events.push(e);
  }

  /** Eventos do tick atual, sem consumir (usado pela IA para "ouvir" tiros). */
  peek(): readonly SimEvent[] {
    return this.events;
  }

  /** Retorna e esvazia a fila. */
  drain(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
