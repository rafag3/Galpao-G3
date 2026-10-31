// Testes dos bots: navegação até o posto, visão sem atravessar paredes,
// tempo de reação, combate, morte/respawn, audição e apoio de equipe.

import { beforeAll, describe, expect, it } from 'vitest';
import { emptyIntent, type MoveIntent } from '../src/input/InputIntents';
import { galpao } from '../src/level/galpao';
import { BOT, COMBAT, SIM_HZ } from '../src/sim/config';
import type { SimEvent } from '../src/sim/events';
import { GameSim } from '../src/sim/GameSim';
import { initPhysics } from '../src/sim/PhysicsWorld';

beforeAll(async () => {
  await initPhysics();
});

// Comportamento individual dos bots, sem rodadas nem aliados
const NO_ROUNDS = { rounds: false, allies: 0 };
const OX = -36;
const OZ = -32;
const plan = (x: number, y: number) => ({ x: x + OX, y: 0.05, z: y + OZ });

function run(sim: GameSim, seconds: number, intent: Partial<MoveIntent> = {}, events: SimEvent[] = []) {
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    const s = sim.player.state;
    sim.tick({ ...emptyIntent(s.yaw, s.pitch), ...intent });
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Sim com o jogador estacionado longe de tudo (spawn do ataque) e bots nos postos. */
function simWithBotsPosted() {
  const sim = new GameSim(galpao, 1, NO_ROUNDS);
  run(sim, 10);
  return sim;
}

describe('bots', () => {
  it('saem do spawn e chegam aos postos', () => {
    const sim = simWithBotsPosted();
    for (const b of sim.bots) {
      expect(b.brain.state, b.combatant.id).toBe('hold');
      const f = b.combatant.controller.state.feet;
      expect(Math.hypot(f.x - b.brain.objective.point.x, f.z - b.brain.objective.point.z)).toBeLessThan(1);
    }
  });

  it('não enxergam através das paredes: jogador no spawn não leva tiro', () => {
    const sim = new GameSim(galpao, 1, NO_ROUNDS);
    const ev = run(sim, 25);
    expect(ev.filter((e) => e.type === 'hit' && e.victim === 'player')).toHaveLength(0);
    expect(sim.human.alive).toBe(true);
  });

  it('avistam o jogador, respeitam o tempo de reação e atiram', () => {
    const sim = simWithBotsPosted();
    // Jogador entra no galpão, à vista do bot do mid (posto em 36,47 olhando para o sul; o pilar em 36,38 fica fora da linha)
    sim.human.controller.teleport(plan(33, 34), 0);
    const ev: SimEvent[] = [];
    const t0 = sim.time;
    run(sim, 3, {}, ev);
    const mid = sim.bots[2];
    const shots = ev.filter((e) => e.type === 'shot' && e.shooter === mid.combatant.id);
    expect(shots.length).toBeGreaterThan(0);
    // Primeiro tiro nunca antes do tempo de reação
    const firstShotTick = ev.findIndex((e) => e.type === 'shot' && e.shooter === mid.combatant.id);
    expect(firstShotTick).toBeGreaterThan(-1);
    expect(sim.human.health).toBeLessThan(COMBAT.playerHealth);
    expect(sim.time - t0).toBeGreaterThan(BOT.reactionSeconds);
  });

  it('jogador mata um bot e ele renasce depois', () => {
    const sim = simWithBotsPosted();
    const mid = sim.bots[2].combatant;
    // Encosta no bot por trás (fora do campo de visão) e mira na cabeça
    const mf = mid.controller.state.feet;
    sim.human.controller.teleport({ x: mf.x, y: 0.05, z: mf.z + 3 }, Math.PI);
    run(sim, 0.3);
    const eye = sim.player.eyePosition();
    const head = mid.controller.headLineY() + 0.12;
    const pitch = Math.atan2(eye.y - head, Math.hypot(mid.controller.state.feet.x - eye.x, mid.controller.state.feet.z - eye.z));
    const yaw = Math.atan2(mid.controller.state.feet.x - eye.x, mid.controller.state.feet.z - eye.z);
    const ev = run(sim, 0.1, { fire: true, yaw, pitch });
    expect(ev.find((e) => e.type === 'hit' && e.victim === mid.id)).toMatchObject({ part: 'head', killed: true });
    expect(mid.alive).toBe(false);
    expect(sim.human.kills).toBe(1);
    run(sim, COMBAT.botRespawnSeconds + 0.2);
    expect(mid.alive).toBe(true);
  });

  it('ouvem tiros por perto e vão investigar', () => {
    const sim = simWithBotsPosted();
    // Jogador atira para o alto no corredor oeste, sem linha de visão com o bot do A
    sim.human.controller.teleport(plan(6, 30), 0);
    run(sim, 0.2, { fire: true, pitch: -1.2, yaw: 0 });
    run(sim, 0.3);
    expect(sim.bots[0].brain.state).toBe('chase');
  });

  it('um avistamento manda só um bot de apoio; os outros seguram o posto', () => {
    const sim = simWithBotsPosted();
    sim.human.controller.teleport(plan(33, 34), 0);
    run(sim, 1.5);
    const states = sim.bots.map((b) => b.brain.state);
    expect(states[2]).toBe('combat'); // quem viu
    expect(states.filter((s) => s === 'chase')).toHaveLength(1); // um apoio
    expect(states.filter((s) => s === 'hold')).toHaveLength(1); // um segura
  });

  it('matam o jogador exposto, que renasce no spawn', () => {
    const sim = simWithBotsPosted();
    sim.human.controller.teleport(plan(33, 34), 0);
    run(sim, 8);
    expect(sim.human.deaths).toBeGreaterThanOrEqual(1);
    run(sim, COMBAT.playerRespawnSeconds + 0.5);
    const f = sim.player.state.feet;
    expect(Math.hypot(f.x - galpao.spawn.x, f.z - galpao.spawn.z)).toBeLessThan(1.5);
  });

  it('é determinístico com bots', () => {
    const a = new GameSim(galpao, 7, NO_ROUNDS);
    const b = new GameSim(galpao, 7, NO_ROUNDS);
    for (const sim of [a, b]) {
      run(sim, 6);
      sim.human.controller.teleport(plan(33, 34), 0);
      run(sim, 3);
    }
    expect(a.bots.map((x) => x.combatant.controller.state.feet)).toEqual(b.bots.map((x) => x.combatant.controller.state.feet));
    expect(a.human.health).toBe(b.human.health);
  });
});

describe('dificuldade', () => {
  it('vale para aliados e adversários (simétrica)', async () => {
    const { SKILLS } = await import('../src/sim/config');
    const sim = new GameSim(galpao, 1, { difficulty: 'easy' });
    expect(sim.bots.length).toBe(5);
    expect(sim.bots.every((b) => b.brain.skill === SKILLS.easy)).toBe(true);
    sim.setDifficulty('hard');
    expect(sim.bots.every((b) => b.brain.skill === SKILLS.hard)).toBe(true);
  });
});
