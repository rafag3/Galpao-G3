// Alvos de treino estáticos com hitbox de corpo e de cabeça. No mapa de
// competição os bots ocupam esse papel; no campo de testes eles continuam.

import type { LevelData } from '../level/LevelData';
import { TARGET } from './config';
import type { EntityId, EventQueue, HitPart } from './events';
import type { HitRegistry } from './HitRegistry';
import { quatFromEuler } from './math';
import { PhysicsWorld, RAPIER } from './PhysicsWorld';

export interface TargetState {
  id: number;
  x: number;
  z: number;
  yaw: number;
  health: number;
  down: boolean;
  /** Tempo de simulação em que caiu (para animação e respawn). */
  downAt: number;
}

export const targetEntityId = (i: number): EntityId => `target:${i}`;

export class TargetSystem {
  readonly targets: TargetState[] = [];
  private readonly colliders = new Map<number, RAPIER.Collider[]>();

  constructor(physics: PhysicsWorld, level: LevelData, hits: HitRegistry, private readonly events: EventQueue) {
    const world = physics.world;
    level.targets.forEach((spawn, id) => {
      const [x, z] = spawn.position;
      const rot = quatFromEuler(0, spawn.yaw, 0);
      const { body, head } = TARGET;

      const bodyCol = world.createCollider(
        RAPIER.ColliderDesc.cuboid(body.width / 2, body.height / 2, body.depth / 2)
          .setTranslation(x, body.height / 2, z)
          .setRotation(rot),
      );
      const headCol = world.createCollider(
        RAPIER.ColliderDesc.cuboid(head.size / 2, head.size / 2, head.size / 2)
          .setTranslation(x, head.centerY, z)
          .setRotation(rot),
      );

      hits.register(bodyCol, targetEntityId(id), () => 'body');
      hits.register(headCol, targetEntityId(id), () => 'head');
      this.colliders.set(id, [bodyCol, headCol]);
      this.targets.push({ id, x, z, yaw: spawn.yaw, health: TARGET.health, down: false, downAt: 0 });
    });
  }

  applyDamage(index: number, part: HitPart, damage: number, attacker: EntityId, time: number): void {
    const t = this.targets[index];
    if (!t || t.down) return;
    t.health -= damage;
    const killed = t.health <= 0;
    if (killed) {
      t.health = 0;
      t.down = true;
      t.downAt = time;
      // Alvo caído não bloqueia tiros nem movimento
      for (const c of this.colliders.get(t.id) ?? []) c.setEnabled(false);
    }
    this.events.push({ type: 'hit', attacker, victim: targetEntityId(t.id), part, damage, killed });
  }

  update(time: number): void {
    for (const t of this.targets) {
      if (t.down && time - t.downAt >= TARGET.respawnSeconds) {
        t.down = false;
        t.health = TARGET.health;
        for (const c of this.colliders.get(t.id) ?? []) c.setEnabled(true);
        this.events.push({ type: 'respawn', id: targetEntityId(t.id) });
      }
    }
  }
}
