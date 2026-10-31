// Testes de combate: disparo, cadência, dano por parte do corpo, morte e
// respawn de alvos, recarga, dispersão e oclusão por paredes.

import { beforeAll, describe, expect, it } from 'vitest';
import { emptyIntent, type MoveIntent } from '../src/input/InputIntents';
import { testRange } from '../src/level/testRange';
import { SIM_HZ, TARGET } from '../src/sim/config';
import type { SimEvent } from '../src/sim/events';
import { GameSim } from '../src/sim/GameSim';
import { initPhysics } from '../src/sim/PhysicsWorld';
import { RIFLE } from '../src/sim/weapons';

beforeAll(async () => {
  await initPhysics();
});

/** Mira no ponto (x, y, z) a partir do olho do jogador. */
function aimAt(sim: GameSim, x: number, y: number, z: number) {
  const eye = sim.player.eyePosition();
  const dx = x - eye.x;
  const dz = z - eye.z;
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(eye.y - y, Math.hypot(dx, dz)) };
}

function newSim() {
  const sim = new GameSim({ ...testRange, spawn: { x: 0, y: 0.5, z: 0 }, spawnYaw: 0 });
  // Cai até o chão antes de começar
  for (let i = 0; i < SIM_HZ; i++) sim.tick(emptyIntent());
  sim.drainEvents();
  return sim;
}

function ticks(sim: GameSim, n: number, intent: Partial<MoveIntent>, events: SimEvent[] = []) {
  for (let i = 0; i < n; i++) {
    sim.tick({ ...emptyIntent(), ...intent });
    events.push(...sim.drainEvents());
  }
  return events;
}

const seconds = (s: number) => Math.round(s * SIM_HZ);
const CENTER_TARGET = 1; // alvo em (0, 17)
const bodyAim = (sim: GameSim) => aimAt(sim, 0, 0.9, 17);
const headAim = (sim: GameSim) => aimAt(sim, 0, TARGET.head.centerY, 17);

/** Um toque no gatilho seguido de pausa para o recuo voltar. */
function tap(sim: GameSim, aim: { yaw: number; pitch: number }, events: SimEvent[]) {
  ticks(sim, 1, { ...aim, fire: true }, events);
  ticks(sim, seconds(0.6), { ...aim }, events);
}

describe('arma', () => {
  it('um tiro gasta uma bala e acerta o corpo do alvo à frente', () => {
    const sim = newSim();
    const ev = ticks(sim, 1, { ...bodyAim(sim), fire: true });
    expect(sim.weapon.state.mag).toBe(RIFLE.magSize - 1);
    const hit = ev.find((e) => e.type === 'hit');
    expect(hit).toMatchObject({ type: 'hit', targetId: CENTER_TARGET, part: 'body', damage: RIFLE.damage });
  });

  it('respeita a cadência de tiro (600/min)', () => {
    const sim = newSim();
    const ev = ticks(sim, seconds(1), { ...bodyAim(sim), fire: true });
    const shots = ev.filter((e) => e.type === 'shot').length;
    expect(shots).toBeGreaterThanOrEqual(10);
    expect(shots).toBeLessThanOrEqual(11);
  });

  it('três tiros no corpo derrubam o alvo, que volta depois', () => {
    const sim = newSim();
    const ev: SimEvent[] = [];
    for (let i = 0; i < 3; i++) tap(sim, bodyAim(sim), ev);
    const hits = ev.filter((e) => e.type === 'hit');
    expect(hits).toHaveLength(3);
    expect(hits.at(-1)).toMatchObject({ killed: true });
    expect(sim.targets.targets[CENTER_TARGET].down).toBe(true);

    // Caído, o alvo não recebe tiro: a bala passa e bate na parede do fundo
    const through = ticks(sim, 1, { ...bodyAim(sim), fire: true });
    expect(through.find((e) => e.type === 'hit')).toBeUndefined();

    ticks(sim, seconds(TARGET.respawnSeconds), {}, ev);
    expect(ev.some((e) => e.type === 'targetRespawn' && e.targetId === CENTER_TARGET)).toBe(true);
    expect(sim.targets.targets[CENTER_TARGET].health).toBe(TARGET.health);
  });

  it('tiro na cabeça derruba com um tiro', () => {
    const sim = newSim();
    const ev = ticks(sim, 1, { ...headAim(sim), fire: true });
    expect(ev.find((e) => e.type === 'hit')).toMatchObject({ part: 'head', killed: true });
  });

  it('recarrega do estoque no tempo certo e não atira durante a recarga', () => {
    const sim = newSim();
    const up = { yaw: 0, pitch: -0.8 }; // atira para o alto, longe dos alvos
    ticks(sim, seconds(3.2), { ...up, fire: true });
    expect(sim.weapon.state.mag).toBe(0);

    const ev = ticks(sim, 1, { ...up, reload: true });
    expect(ev.some((e) => e.type === 'reloadStart')).toBe(true);
    const during = ticks(sim, seconds(1), { ...up, fire: true });
    expect(during.some((e) => e.type === 'shot')).toBe(false);

    ticks(sim, seconds(RIFLE.reloadTime - 1 + 0.05), up);
    expect(sim.weapon.state.mag).toBe(RIFLE.magSize);
    expect(sim.weapon.state.reserve).toBe(RIFLE.reserve - RIFLE.magSize);
  });

  it('gatilho com pente vazio dá clique seco e recarrega sozinho', () => {
    const sim = newSim();
    const up = { yaw: 0, pitch: -0.8 };
    ticks(sim, seconds(3.2), { ...up, fire: true });
    ticks(sim, 2, up); // solta o gatilho
    const ev = ticks(sim, 1, { ...up, fire: true });
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['dryFire', 'reloadStart']));
  });

  it('dispersão é maior correndo do que parado e menor agachado', () => {
    const sim = newSim();
    const still = sim.weapon.currentSpread(sim.player.state);
    ticks(sim, seconds(0.5), { moveZ: 1, run: true });
    const running = sim.weapon.currentSpread(sim.player.state);
    ticks(sim, seconds(1), { crouch: true });
    const crouched = sim.weapon.currentSpread(sim.player.state);
    expect(running).toBeGreaterThan(still * 5);
    expect(crouched).toBeLessThan(still);
  });

  it('recuo sobe a mira durante a rajada e volta ao centro depois', () => {
    const sim = newSim();
    const up = { yaw: 0, pitch: -0.8 };
    ticks(sim, seconds(0.5), { ...up, fire: true });
    expect(sim.weapon.state.recoilPitch).toBeLessThan(-0.03);
    ticks(sim, seconds(1), up);
    expect(sim.weapon.state.recoilPitch).toBe(0);
  });

  it('caixas bloqueiam o tiro até o alvo escondido', () => {
    const sim = newSim();
    const ev = ticks(sim, 1, { ...aimAt(sim, -3.4, 0.6, 8.5), fire: true }); // alvo atrás das caixas
    expect(ev.find((e) => e.type === 'hit')).toBeUndefined();
    expect(ev.find((e) => e.type === 'impact')).toMatchObject({ onTarget: false });
  });
});
