// Um participante da partida (jogador humano ou bot): corpo, arma, vida e
// equipe. Humano e bot são a MESMA estrutura; só muda de onde vem o intent.

import type { EntityId } from './events';
import type { Vec3 } from './math';
import type { PlayerController } from './PlayerController';
import type { WeaponController } from './WeaponController';

export type Team = 'attack' | 'defense';

export interface Combatant {
  id: EntityId;
  team: Team;
  controller: PlayerController;
  weapon: WeaponController;
  health: number;
  maxHealth: number;
  alive: boolean;
  diedAt: number;
  /** Onde renasce (até o sistema de rodadas da Fase 5). */
  respawnAt: Vec3;
  respawnYaw: number;
  respawnSeconds: number;
  kills: number;
  deaths: number;
}

export interface CombatantView {
  id: EntityId;
  team: Team;
  alive: boolean;
  health: number;
  feet: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  diedAt: number;
}

export function viewOf(c: Combatant): CombatantView {
  const s = c.controller.state;
  return {
    id: c.id,
    team: c.team,
    alive: c.alive,
    health: c.health,
    feet: { ...s.feet },
    yaw: s.yaw,
    pitch: s.pitch,
    crouching: s.crouching,
    diedAt: c.diedAt,
  };
}
