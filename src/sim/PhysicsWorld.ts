// Mundo físico (Rapier). Rapier foi escolhido em vez do Havok porque roda
// igual no navegador e no Node: a mesma simulação servirá para um servidor
// autoritativo quando o multiplayer entrar.

import RAPIER from '@dimforge/rapier3d-compat';
import type { LevelData } from '../level/LevelData';
import { quatFromEuler } from './math';

let rapierReady: Promise<void> | null = null;

/** Inicializa o WASM do Rapier uma única vez. */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;

  constructor(level: LevelData) {
    // Gravidade é aplicada manualmente no controlador do jogador
    // (personagem cinemático). O vetor aqui vale para corpos dinâmicos futuros.
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    for (const block of level.blocks) {
      if (block.collide === false) continue; // só visual
      const [hx, hy, hz] = block.size.map((s) => s / 2);
      const [rx, ry, rz] = block.rotation ?? [0, 0, 0];
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(...block.position)
        .setRotation(quatFromEuler(rx, ry, rz))
        .setFriction(0);
      this.world.createCollider(desc);
    }
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}

export { RAPIER };
