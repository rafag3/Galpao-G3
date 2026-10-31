// Estado completo da partida. Recebe intents, avança ticks, emite eventos.
// Não conhece render, DOM ou dispositivo: pode rodar no navegador ou no Node.

import type { MoveIntent } from '../input/InputIntents';
import type { LevelData } from '../level/LevelData';
import { SIM_DT } from './config';
import { EventQueue, type SimEvent } from './events';
import { PhysicsWorld } from './PhysicsWorld';
import { PlayerController } from './PlayerController';
import { Rng } from './rng';
import { TargetSystem } from './TargetSystem';
import { WeaponController } from './WeaponController';
import { RIFLE } from './weapons';

export class GameSim {
  readonly physics: PhysicsWorld;
  readonly player: PlayerController;
  readonly targets: TargetSystem;
  readonly weapon: WeaponController;
  private readonly events = new EventQueue();
  tickCount = 0;

  /** Requer `await initPhysics()` antes. */
  constructor(readonly level: LevelData, seed = 1) {
    this.physics = new PhysicsWorld(level);
    this.player = new PlayerController(this.physics, level.spawn, level.spawnYaw);
    this.targets = new TargetSystem(this.physics, level, this.events);
    this.weapon = new WeaponController(RIFLE, this.physics, this.targets, this.events, new Rng(seed));
    // Um step inicial para o broad-phase registrar os colliders estáticos
    this.physics.step(SIM_DT);
  }

  get time(): number {
    return this.tickCount * SIM_DT;
  }

  tick(intent: MoveIntent, dt = SIM_DT): void {
    this.player.step(intent, dt);
    // A arma dispara do olho na posição já atualizada deste tick
    this.weapon.step(intent, this.player.state, this.player.eyePosition(), this.player.collider, this.time, dt);
    this.targets.update(this.time);
    this.physics.step(dt);
    this.tickCount++;
  }

  drainEvents(): SimEvent[] {
    return this.events.drain();
  }

  dispose(): void {
    this.physics.dispose();
  }
}
