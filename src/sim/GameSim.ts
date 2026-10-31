// Estado completo da partida. Recebe intents, avança ticks. Não conhece
// render, DOM ou dispositivo: pode rodar no navegador ou no Node.

import type { MoveIntent } from '../input/InputIntents';
import type { LevelData } from '../level/LevelData';
import { SIM_DT } from './config';
import { PhysicsWorld } from './PhysicsWorld';
import { PlayerController } from './PlayerController';

export class GameSim {
  readonly physics: PhysicsWorld;
  readonly player: PlayerController;
  tickCount = 0;

  /** Requer `await initPhysics()` antes. */
  constructor(readonly level: LevelData) {
    this.physics = new PhysicsWorld(level);
    this.player = new PlayerController(this.physics, level.spawn, level.spawnYaw);
    // Um step inicial para o broad-phase registrar os colliders estáticos
    this.physics.step(SIM_DT);
  }

  tick(intent: MoveIntent, dt = SIM_DT): void {
    this.player.step(intent, dt);
    this.physics.step(dt);
    this.tickCount++;
  }

  dispose(): void {
    this.physics.dispose();
  }
}
