// Regras de rodada e da bomba: preparação, plantio, explosão, tempo,
// eliminação, queda/coleta da bomba, desarme pelos bots e fim de partida.

import { beforeAll, describe, expect, it } from 'vitest';
import { emptyIntent, type MoveIntent } from '../src/input/InputIntents';
import { galpao } from '../src/level/galpao';
import type { LevelData } from '../src/level/LevelData';
import { ROUND, SIM_HZ } from '../src/sim/config';
import type { SimEvent } from '../src/sim/events';
import { GameSim, type SimOptions } from '../src/sim/GameSim';
import { initPhysics } from '../src/sim/PhysicsWorld';

beforeAll(async () => {
  await initPhysics();
});

function run(sim: GameSim, seconds: number, intent: Partial<MoveIntent> = {}, events: SimEvent[] = []) {
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    const s = sim.player.state;
    sim.tick({ ...emptyIntent(s.yaw, s.pitch), ...intent });
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Roda até um evento aparecer (ou estourar o limite). */
function runUntil(sim: GameSim, pred: (e: SimEvent) => boolean, maxSeconds: number, intent: Partial<MoveIntent> = {}) {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSeconds * SIM_HZ; i++) {
    const s = sim.player.state;
    sim.tick({ ...emptyIntent(s.yaw, s.pitch), ...intent });
    const ev = sim.drainEvents();
    events.push(...ev);
    if (ev.some(pred)) return events;
  }
  return events;
}

const newSim = (opts: SimOptions = {}, level: LevelData = galpao) => {
  const sim = new GameSim(level, 3, opts);
  sim.drainEvents();
  return sim;
};
const siteSpot = (id: 'A' | 'B') => {
  const s = galpao.bombsites!.find((b) => b.id === id)!;
  return { x: s.plantSpot![0], y: 0.05, z: s.plantSpot![1] };
};
const skipFreeze = (sim: GameSim) => run(sim, ROUND.freezeSeconds + 0.05);

describe('rodadas', () => {
  it('ninguém se move durante a preparação', () => {
    const sim = newSim({ bots: false });
    const z0 = sim.player.state.feet.z;
    run(sim, ROUND.freezeSeconds - 0.2, { moveZ: 1 });
    expect(Math.abs(sim.player.state.feet.z - z0)).toBeLessThan(0.05);
    run(sim, 1, { moveZ: 1 });
    expect(sim.player.state.feet.z - z0).toBeGreaterThan(2);
  });

  it('plantar exige 3 s segurando a ação dentro do site', () => {
    const sim = newSim({ bots: false });
    skipFreeze(sim);
    sim.player.teleport(siteSpot('A'), 0);
    run(sim, 0.3);
    run(sim, 1.5, { use: true });
    run(sim, 0.1); // soltou: progresso zera
    expect(sim.rounds!.bomb.plantProgress).toBe(0);
    const ev = run(sim, ROUND.plantSeconds + 0.1, { use: true });
    expect(ev.find((e) => e.type === 'bombPlanted')).toMatchObject({ by: 'player', site: 'A' });
    expect(sim.rounds!.bomb.status).toBe('planted');
  });

  it('não planta fora do site', () => {
    const sim = newSim({ bots: false });
    skipFreeze(sim);
    run(sim, ROUND.plantSeconds + 1, { use: true }); // no spawn do ataque
    expect(sim.rounds!.bomb.status).toBe('carried');
  });

  it('bomba explode em 35 s: ataque pontua e a rodada seguinte recomeça', () => {
    const sim = newSim({ bots: false });
    skipFreeze(sim);
    sim.player.teleport(siteSpot('B'), 0);
    run(sim, 0.3);
    run(sim, ROUND.plantSeconds + 0.1, { use: true });
    sim.player.teleport(galpao.spawn, 0); // foge para longe
    const ev = run(sim, ROUND.bombSeconds + 0.2);
    expect(ev.find((e) => e.type === 'roundEnd')).toMatchObject({ winner: 'attack', reason: 'bomb' });
    expect(sim.rounds!.state.score.attack).toBe(1);
    const next = run(sim, ROUND.postRoundSeconds + 0.1);
    expect(next.find((e) => e.type === 'roundStart')).toMatchObject({ round: 2 });
    expect(sim.rounds!.bomb).toMatchObject({ status: 'carried', carrier: 'player' });
  });

  it('quem fica perto da explosão morre', () => {
    const sim = newSim({ bots: false });
    skipFreeze(sim);
    sim.player.teleport(siteSpot('A'), 0);
    run(sim, 0.3);
    run(sim, ROUND.plantSeconds + 0.1, { use: true });
    run(sim, ROUND.bombSeconds + 0.2);
    expect(sim.human.alive).toBe(false);
  });

  it('tempo esgotado sem plantio: vitória da defesa', () => {
    const sim = newSim({ bots: false });
    const ev = run(sim, ROUND.freezeSeconds + ROUND.roundSeconds + 0.2);
    expect(ev.find((e) => e.type === 'roundEnd')).toMatchObject({ winner: 'defense', reason: 'time' });
  });

  it('eliminar toda a defesa dá a rodada ao ataque', () => {
    const sim = newSim({ allies: 0 });
    skipFreeze(sim);
    for (const b of sim.bots) sim.kill(b.combatant, sim.human);
    const ev = run(sim, 0.1);
    expect(ev.find((e) => e.type === 'roundEnd')).toMatchObject({ winner: 'attack', reason: 'elimination' });
    expect(sim.human.kills).toBe(3);
  });

  it('portador morre: bomba cai e a defesa vence por eliminação se não houver ataque', () => {
    const sim = newSim({ allies: 0 });
    skipFreeze(sim);
    sim.kill(sim.human, null);
    const ev = run(sim, 0.1);
    expect(ev.some((e) => e.type === 'bombDropped')).toBe(true);
    expect(ev.find((e) => e.type === 'roundEnd')).toMatchObject({ winner: 'defense', reason: 'elimination' });
  });

  it('aliado bot busca a bomba caída e planta', () => {
    // Sem defensores: só o jogador e 2 aliados
    const noDefense: LevelData = { ...galpao, defensePosts: [] };
    const sim = newSim({ allies: 2 }, noDefense);
    skipFreeze(sim);
    run(sim, 2, { moveZ: 1 });
    sim.kill(sim.human, null);
    const ev = runUntil(sim, (e) => e.type === 'bombPlanted', 60);
    expect(ev.some((e) => e.type === 'bombPickup' && e.by.startsWith('bot:'))).toBe(true);
    const planted = ev.find((e) => e.type === 'bombPlanted');
    expect(planted).toBeDefined();
    expect(planted && planted.type === 'bombPlanted' && planted.by.startsWith('bot:')).toBe(true);
  });

  it('defesa vai até a bomba plantada e desarma', () => {
    const sim = newSim({ allies: 0 });
    skipFreeze(sim);
    // Jogador fica escondido no spawn do ataque; bomba plantada no B
    sim.rounds!.debugPlant('B', siteSpot('B'));
    const ev = runUntil(sim, (e) => e.type === 'roundEnd', 34);
    expect(ev.some((e) => e.type === 'bombDefused')).toBe(true);
    expect(ev.find((e) => e.type === 'roundEnd')).toMatchObject({ winner: 'defense', reason: 'defused' });
  });

  it('partida termina com 5 vitórias, com troca de lado no intervalo, e pode recomeçar', () => {
    // Sem bots, toda rodada acaba no tempo (vitória da defesa). Rodadas 1-4: o
    // time vazio defende e faz 4; após o intervalo o jogador defende e faz 5.
    const sim = newSim({ bots: false });
    const perRound = ROUND.freezeSeconds + ROUND.roundSeconds + ROUND.postRoundSeconds;
    const ev = runUntil(sim, (e) => e.type === 'matchEnd', perRound * 9 + 5);
    expect(ev.filter((e) => e.type === 'halftime')).toHaveLength(1);
    expect(ev.find((e) => e.type === 'matchEnd')).toMatchObject({ winner: 'defense' });
    expect(sim.human.team).toBe('defense');
    expect(sim.rounds!.state).toMatchObject({ phase: 'matchOver', round: 9, score: { attack: 4, defense: 5 } });
    sim.restartMatch();
    expect(sim.human.team).toBe('attack');
    expect(sim.rounds!.state).toMatchObject({ phase: 'freeze', round: 1, score: { attack: 0, defense: 0 } });
  });

  it('partida completa com bots termina sem travar (fumaça)', () => {
    const sim = newSim();
    let rounds = 0;
    for (let r = 0; r < 3; r++) {
      const ev = runUntil(sim, (e) => e.type === 'roundEnd', ROUND.freezeSeconds + ROUND.roundSeconds + ROUND.bombSeconds + 2);
      expect(ev.some((e) => e.type === 'roundEnd')).toBe(true);
      rounds++;
      run(sim, ROUND.postRoundSeconds + 0.1);
    }
    expect(rounds).toBe(3);
  });
});

describe('troca de lado', () => {
  const zoneHas = (zone: { min: [number, number]; max: [number, number] }, p: { x: number; z: number }) =>
    p.x >= zone.min[0] && p.x <= zone.max[0] && p.z >= zone.min[1] && p.z <= zone.max[1];

  it('começando na defesa: jogador nasce no spawn da defesa e um bot do ataque leva a bomba', () => {
    const sim = newSim({ side: 'defense' });
    expect(sim.human.team).toBe('defense');
    expect(zoneHas(galpao.spawnZones!.defense, sim.player.state.feet)).toBe(true);
    expect(sim.bots.filter((b) => b.combatant.team === 'defense')).toHaveLength(2);
    expect(sim.bots.filter((b) => b.combatant.team === 'attack')).toHaveLength(3);
    const carrier = sim.find(sim.rounds!.bomb.carrier!);
    expect(carrier?.team).toBe('attack');
    expect(carrier?.id.startsWith('bot:')).toBe(true);
  });

  it('jogador na defesa desarma a bomba segurando a ação perto dela', () => {
    const sim = newSim({ side: 'defense', bots: false });
    skipFreeze(sim);
    sim.rounds!.debugPlant('A', siteSpot('A'));
    sim.player.teleport(siteSpot('A'), 0);
    run(sim, 0.3);
    run(sim, 2, { use: true });
    run(sim, 0.1); // soltou: progresso zera
    expect(sim.rounds!.bomb.defuseProgress).toBe(0);
    const ev = run(sim, ROUND.defuseSeconds + 0.1, { use: true });
    expect(ev.find((e) => e.type === 'bombDefused')).toMatchObject({ by: 'player' });
    expect(ev.find((e) => e.type === 'roundEnd')).toMatchObject({ winner: 'defense', reason: 'defused' });
  });

  it('no intervalo todos trocam de lado e o placar acompanha cada time', () => {
    const sim = newSim();
    const enemies = sim.bots.filter((b) => b.combatant.team === 'defense').map((b) => b.combatant);
    for (let r = 1; r <= ROUND.halftimeAfterRound; r++) {
      skipFreeze(sim);
      // Rodadas 1-3 para o time do jogador, a 4ª para o adversário
      if (r < ROUND.halftimeAfterRound) for (const c of enemies) sim.kill(c, sim.human);
      else for (const c of sim.combatants().filter((c) => c.team === 'attack')) sim.kill(c, null);
      run(sim, 0.1);
      expect(sim.rounds!.state.phase).toBe('over');
      run(sim, ROUND.postRoundSeconds);
    }
    expect(sim.rounds!.state.round).toBe(ROUND.halftimeAfterRound + 1);
    expect(sim.human.team).toBe('defense');
    expect(enemies.every((c) => c.team === 'attack')).toBe(true);
    // Time do jogador: 3 vitórias, agora contadas na defesa
    expect(sim.rounds!.state.score).toEqual({ attack: 1, defense: 3 });
    expect(zoneHas(galpao.spawnZones!.defense, sim.player.state.feet)).toBe(true);
    expect(sim.find(sim.rounds!.bomb.carrier!)?.team).toBe('attack');
  });

  it('bots do ataque levam a bomba ao site sozinhos', () => {
    // Jogador sozinho na defesa, escondido no spawn; o ataque (3 bots) avança
    const sim = newSim({ side: 'defense', allies: 0 });
    skipFreeze(sim);
    const ev = runUntil(sim, (e) => e.type === 'bombPlanted' || e.type === 'roundEnd', ROUND.roundSeconds);
    const planted = ev.find((e) => e.type === 'bombPlanted');
    const end = ev.find((e) => e.type === 'roundEnd');
    // Ou plantam, ou acharam e eliminaram o jogador no caminho
    expect(planted ?? end).toBeDefined();
    if (!planted) expect(end).toMatchObject({ winner: 'attack', reason: 'elimination' });
  });
});

describe('spawn', () => {
  it('ninguém nasce colado em outro', () => {
    const sim = newSim();
    const feet = sim.combatants().map((c) => c.controller.state.feet);
    for (let i = 0; i < feet.length; i++)
      for (let j = i + 1; j < feet.length; j++)
        expect(Math.hypot(feet[i].x - feet[j].x, feet[i].z - feet[j].z)).toBeGreaterThan(1.5);
  });
});
