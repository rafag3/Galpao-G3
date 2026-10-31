// Testes da simulação de movimento, rodando em Node (sem navegador e sem
// Babylon). Prova também que a simulação é independente do render.

import { beforeAll, describe, expect, it } from 'vitest';
import { emptyIntent, type MoveIntent } from '../src/input/InputIntents';
import { testRange } from '../src/level/testRange';
import type { LevelData } from '../src/level/LevelData';
import { BODY, MOVE, SIM_HZ } from '../src/sim/config';
import { GameSim } from '../src/sim/GameSim';
import { initPhysics } from '../src/sim/PhysicsWorld';

beforeAll(async () => {
  await initPhysics();
});

/** Intent que mantém a visão atual do jogador. */
function intentFor(sim: GameSim, partial: Partial<MoveIntent> = {}): MoveIntent {
  const s = sim.player.state;
  return { ...emptyIntent(s.yaw, s.pitch), ...partial };
}

function run(sim: GameSim, seconds: number, intent: Partial<MoveIntent> = {}) {
  const ticks = Math.round(seconds * SIM_HZ);
  for (let i = 0; i < ticks; i++) sim.tick(intentFor(sim, intent));
}

function levelWithSpawn(x: number, z: number, yaw = 0): LevelData {
  return { ...testRange, spawn: { x, y: 0.5, z }, spawnYaw: yaw };
}

describe('movimento do jogador', () => {
  it('cai e para no chão (y ≈ 0)', () => {
    const sim = new GameSim(levelWithSpawn(0, 0));
    run(sim, 1.5);
    expect(sim.player.state.grounded).toBe(true);
    expect(sim.player.state.feet.y).toBeGreaterThan(-0.05);
    expect(sim.player.state.feet.y).toBeLessThan(0.1);
  });

  it('anda para frente na velocidade de caminhada', () => {
    const sim = new GameSim(levelWithSpawn(0, 0));
    run(sim, 1);
    const z0 = sim.player.state.feet.z;
    run(sim, 1, { moveZ: 1 });
    const dz = sim.player.state.feet.z - z0;
    // ~4,6 m em 1 s, descontando a aceleração inicial
    expect(dz).toBeGreaterThan(MOVE.walkSpeed * 0.85);
    expect(dz).toBeLessThan(MOVE.walkSpeed * 1.02);
  });

  it('correr é mais rápido que andar e agachar é mais lento', () => {
    const dist = (intent: Partial<MoveIntent>) => {
      const sim = new GameSim(levelWithSpawn(0, -5, Math.PI / 2)); // olha para +X, espaço livre
      run(sim, 1, { crouch: intent.crouch });
      const x0 = sim.player.state.feet.x;
      run(sim, 1, intent);
      return sim.player.state.feet.x - x0;
    };
    const walk = dist({ moveZ: 1 });
    const runD = dist({ moveZ: 1, run: true });
    const crouch = dist({ moveZ: 1, crouch: true });
    expect(runD).toBeGreaterThan(walk * 1.2);
    expect(crouch).toBeLessThan(walk * 0.6);
  });

  it('pula ~0,9 m e volta ao chão', () => {
    const sim = new GameSim(levelWithSpawn(0, 0));
    run(sim, 1);
    sim.tick(intentFor(sim, { jump: true }));
    let peak = 0;
    for (let i = 0; i < SIM_HZ * 1.5; i++) {
      sim.tick(intentFor(sim));
      peak = Math.max(peak, sim.player.state.feet.y);
    }
    expect(peak).toBeGreaterThan(0.7);
    expect(peak).toBeLessThan(1.1);
    expect(sim.player.state.grounded).toBe(true);
  });

  it('não atravessa a parede externa', () => {
    const sim = new GameSim(levelWithSpawn(0, 15));
    run(sim, 4, { moveZ: 1, run: true }); // parede em z = 20
    expect(sim.player.state.feet.z).toBeLessThan(20 - 0.25 - BODY.radius + 0.05);
  });

  it('sobe a escada de degraus de 20 cm', () => {
    // escada em x = 12, subindo para -Z a partir de z = -4
    const sim = new GameSim(levelWithSpawn(12, -2, Math.PI));
    run(sim, 1);
    let top = 0;
    for (let i = 0; i < SIM_HZ * 2.5; i++) {
      sim.tick(intentFor(sim, { moveZ: 1 }));
      top = Math.max(top, sim.player.state.feet.y);
    }
    expect(top).toBeGreaterThan(1.3); // topo da escada: 1,4 m
  });

  it('sobe a rampa até a plataforma de 1,5 m', () => {
    const sim = new GameSim(levelWithSpawn(-10, 0, Math.PI));
    run(sim, 1);
    run(sim, 2.5, { moveZ: 1 });
    expect(sim.player.state.feet.y).toBeGreaterThan(1.4);
  });

  it('só passa no túnel baixo agachado e não levanta embaixo do teto', () => {
    // túnel em x ≈ 1,1, z de -10 a -14; vão de 1,4 m
    const standing = new GameSim(levelWithSpawn(1.1, -7, Math.PI));
    run(standing, 1);
    run(standing, 2, { moveZ: 1 });
    expect(standing.player.state.feet.z).toBeGreaterThan(-10.2); // bloqueado

    const crouched = new GameSim(levelWithSpawn(1.1, -7, Math.PI));
    run(crouched, 1, { crouch: true });
    run(crouched, 2.4, { moveZ: 1, crouch: true });
    expect(crouched.player.state.feet.z).toBeLessThan(-11); // entrou

    // Solta o agachar dentro do túnel: deve continuar agachado
    run(crouched, 0.5, { crouch: false });
    expect(crouched.player.state.crouching).toBe(true);
  });

  it('é determinístico: mesmos intents, mesmo resultado', () => {
    const a = new GameSim(levelWithSpawn(0, 0));
    const b = new GameSim(levelWithSpawn(0, 0));
    for (const sim of [a, b]) {
      run(sim, 1);
      run(sim, 0.7, { moveZ: 1, moveX: 0.4, run: true });
      sim.tick(intentFor(sim, { jump: true }));
      run(sim, 1, { moveX: -1 });
    }
    expect(a.player.state.feet).toEqual(b.player.state.feet);
  });
});
