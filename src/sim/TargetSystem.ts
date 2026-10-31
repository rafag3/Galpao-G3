// Alvos de treino com hitbox de corpo e de cabeça. Servem de base para o
// sistema de dano dos bots na Fase 4 (mesmo mapeamento collider → parte).

import type { LevelData } from '../level/LevelData';
import { TARGET } from './config';
import type { EventQueue, HitPart } from './events';
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

interface Hitbox {
  targetId: number;
  part: HitPart;
}

export class TargetSystem {
  readonly targets: TargetState[] = [];
  private readonly colliders = new Map<number, RAPIER.Collider[]>();
  /** handle do collider → alvo e parte atingida. */
  private readonly hitboxes = new Map<number, Hitbox>();

  constructor(physics: PhysicsWorld, level: LevelData, private readonly events: EventQueue) {
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

      this.hitboxes.set(bodyCol.handle, { targetId: id, part: 'body' });
      this.hitboxes.set(headCol.handle, { targetId: id, part: 'head' });
      this.colliders.set(id, [bodyCol, headCol]);
      this.targets.push({ id, x, z, yaw: spawn.yaw, health: TARGET.health, down: false, downAt: 0 });
    });
  }

  /** Retorna a hitbox de um collider, ou undefined se não for de um alvo. */
  hitboxOf(collider: RAPIER.Collider): Hitbox | undefined {
    return this.hitboxes.get(collider.handle);
  }

  applyDamage(hit: Hitbox, damage: number, time: number): void {
    const t = this.targets[hit.targetId];
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
    this.events.push({ type: 'hit', targetId: t.id, part: hit.part, damage, killed });
  }

  update(time: number): void {
    for (const t of this.targets) {
      if (t.down && time - t.downAt >= TARGET.respawnSeconds) {
        t.down = false;
        t.health = TARGET.health;
        for (const c of this.colliders.get(t.id) ?? []) c.setEnabled(true);
        this.events.push({ type: 'targetRespawn', targetId: t.id });
      }
    }
  }
}
