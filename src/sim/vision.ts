// Linha de visão entre combatentes: raio do olho do observador até o peito e
// a cabeça do alvo. Usada pelos bots (para combater) e pelo radar (inimigos
// avistados pelo time).

import type { Combatant } from './Combatant';
import type { HitRegistry } from './HitRegistry';
import type { Vec3 } from './math';
import { type PhysicsWorld, RAPIER } from './PhysicsWorld';

/**
 * Ponto visível do alvo (peito ou cabeça) a partir do olho de `viewer`, ou
 * null se paredes e objetos bloqueiam os dois. Não checa distância nem campo
 * de visão: isso fica com quem chama.
 */
export function sightPoint(physics: PhysicsWorld, hits: HitRegistry, viewer: Combatant, target: Combatant): Vec3 | null {
  const me = viewer.controller;
  const eye = me.eyePosition();
  const tf = target.controller.state.feet;
  for (const y of [target.controller.chestY(), target.controller.headLineY() + 0.12]) {
    const p = { x: tf.x, y, z: tf.z };
    const v = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
    const len = Math.hypot(v.x, v.y, v.z);
    const dir = { x: v.x / len, y: v.y / len, z: v.z / len };
    const hit = physics.world.castRay(new RAPIER.Ray(eye, dir), len + 0.5, true, undefined, undefined, me.collider);
    if (hit && hits.ownerOf(hit.collider) === target.id) return p;
  }
  return null;
}
