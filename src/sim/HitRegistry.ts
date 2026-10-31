// Registro de hitboxes: liga um collider do Rapier à entidade que ele
// representa e decide qual parte foi atingida a partir do ponto de impacto.
// A arma não sabe se acertou um alvo, um bot ou o jogador: só consulta aqui.

import type { EntityId, HitPart } from './events';
import type { Vec3 } from './math';
import type { RAPIER } from './PhysicsWorld';

export interface HitInfo {
  victim: EntityId;
  part: HitPart;
}

type Resolver = (point: Vec3) => HitPart;

export class HitRegistry {
  private readonly byHandle = new Map<number, { victim: EntityId; resolve: Resolver }>();

  register(collider: RAPIER.Collider, victim: EntityId, resolve: Resolver): void {
    this.byHandle.set(collider.handle, { victim, resolve });
  }

  resolve(collider: RAPIER.Collider, point: Vec3): HitInfo | undefined {
    const e = this.byHandle.get(collider.handle);
    return e && { victim: e.victim, part: e.resolve(point) };
  }

  /** Id da entidade dona do collider (usado pela visão dos bots). */
  ownerOf(collider: RAPIER.Collider): EntityId | undefined {
    return this.byHandle.get(collider.handle)?.victim;
  }
}
