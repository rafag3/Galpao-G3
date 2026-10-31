// Validação do mapa Galpão: todas as áreas alcançáveis com os objetos no
// lugar, rotas com os comprimentos planejados e jogador nascendo livre.

import { beforeAll, describe, expect, it } from 'vitest';
import { emptyIntent } from '../src/input/InputIntents';
import { galpao, PROP_BLOCKS, WALKABLE } from '../src/level/galpao';
import { isWalkable, type PlanRect } from '../src/level/walkableGrid';
import { BODY, SIM_HZ } from '../src/sim/config';
import { GameSim } from '../src/sim/GameSim';
import { initPhysics, PhysicsWorld, RAPIER } from '../src/sim/PhysicsWorld';

beforeAll(async () => {
  await initPhysics();
});

const OX = 36;
const OZ = 32;
const CELL = 0.5;
const W = 72 / CELL;
const D = 64 / CELL;

/** Pegadas dos objetos (em planta), infladas pelo raio do jogador. */
const footprints = PROP_BLOCKS.filter((b) => b.position[1] - b.size[1] / 2 < BODY.stepHeight).map((b) => {
  const r = BODY.radius;
  const x = b.position[0] + OX;
  const y = b.position[2] + OZ;
  return [x - b.size[0] / 2 - r, y - b.size[2] / 2 - r, x + b.size[0] / 2 + r, y + b.size[2] / 2 + r] as PlanRect;
});

function passable(walk: readonly PlanRect[], cx: number, cy: number): boolean {
  const x = (cx + 0.5) * CELL;
  const y = (cy + 0.5) * CELL;
  // O centro do jogador precisa estar a pelo menos um raio das paredes
  const r = BODY.radius;
  const inside = [
    [x, y],
    [x - r, y],
    [x + r, y],
    [x, y - r],
    [x, y + r],
  ].every(([px, py]) => isWalkable(walk, px, py));
  if (!inside) return false;
  return !footprints.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1);
}

/** Menor distância (m) entre dois pontos da planta, andando em 8 direções. */
function shortestPath(walk: readonly PlanRect[], from: [number, number], to: [number, number]): number {
  const idx = (x: number, y: number) => y * W + x;
  const dist = new Float64Array(W * D).fill(Infinity);
  const sx = Math.floor(from[0] / CELL);
  const sy = Math.floor(from[1] / CELL);
  const tx = Math.floor(to[0] / CELL);
  const ty = Math.floor(to[1] / CELL);
  dist[idx(sx, sy)] = 0;
  // Dijkstra simples com fila ordenada (grid pequeno: 144 x 128)
  const open: [number, number, number][] = [[0, sx, sy]];
  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, x, y] = open.shift()!;
    if (x === tx && y === ty) return d * CELL;
    if (d > dist[idx(x, y)]) continue;
    for (const [dx, dy, c] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= D || !passable(walk, nx, ny)) continue;
      // Diagonal não corta quina
      if (dx && dy && (!passable(walk, x + dx, y) || !passable(walk, x, y + dy))) continue;
      const nd = d + c;
      if (nd < dist[idx(nx, ny)]) {
        dist[idx(nx, ny)] = nd;
        open.push([nd, nx, ny]);
      }
    }
  }
  return Infinity;
}

const ALL = Object.values(WALKABLE);
const without = (...names: (keyof typeof WALKABLE)[]) =>
  Object.entries(WALKABLE).filter(([k]) => !names.includes(k)).map(([, r]) => r);

const T_SPAWN: [number, number] = [36, 6];
const CT_SPAWN: [number, number] = [36, 58];
const SITE_A: [number, number] = [12, 53];
const SITE_B: [number, number] = [61, 51]; // ponto de plantio típico, atrás das caixas

describe('mapa Galpão', () => {
  it('relatório de distâncias', () => {
    const r = (a: [number, number], b: [number, number], w = ALL) => shortestPath(w, a, b).toFixed(1);
    console.log('T→A', r(T_SPAWN, SITE_A), 'T→B trucks', r(T_SPAWN, SITE_B, without('passagemEstreita')), 'T→B narrow', r(T_SPAWN, SITE_B, without('caminhoes')), 'CT→A', r(CT_SPAWN, SITE_A), 'CT→B', r(CT_SPAWN, SITE_B));
  });

  it('ataque chega ao A pelo corredor oeste em ~11 s', () => {
    const d = shortestPath(ALL, T_SPAWN, SITE_A);
    expect(d).toBeGreaterThan(55);
    expect(d).toBeLessThan(85);
  });

  it('ataque chega ao B pelos caminhões em ~10 s', () => {
    const d = shortestPath(without('passagemEstreita'), T_SPAWN, SITE_B);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(75);
  });

  it('a rota estreita pelo galpão é passável e é o caminho mais curto até o B', () => {
    const narrow = shortestPath(without('caminhoes'), T_SPAWN, SITE_B);
    const trucks = shortestPath(without('passagemEstreita'), T_SPAWN, SITE_B);
    expect(narrow).toBeLessThan(Infinity);
    expect(narrow).toBeLessThan(trucks);
  });

  it('defesa chega aos dois bombsites bem antes do ataque', () => {
    const ctA = shortestPath(ALL, CT_SPAWN, SITE_A);
    const ctB = shortestPath(ALL, CT_SPAWN, SITE_B);
    const tA = shortestPath(ALL, T_SPAWN, SITE_A);
    const tB = shortestPath(ALL, T_SPAWN, SITE_B);
    expect(ctA).toBeLessThan(35);
    expect(ctB).toBeLessThan(35);
    expect(ctA).toBeLessThan(tA * 0.6);
    expect(ctB).toBeLessThan(tB * 0.6);
  });

  it('mid conecta galpão e defesa', () => {
    expect(shortestPath(without('conectorCtA', 'conectorCtB'), T_SPAWN, CT_SPAWN)).toBeLessThan(Infinity);
  });

  it('todos os alvos estão em áreas alcançáveis', () => {
    for (const t of galpao.targets) {
      const p: [number, number] = [t.position[0] + OX, t.position[1] + OZ];
      expect(shortestPath(ALL, T_SPAWN, p), `alvo em ${p}`).toBeLessThan(Infinity);
    }
  });

  it('bombsites ficam dentro de áreas caminháveis', () => {
    for (const s of galpao.bombsites ?? []) {
      const cx = (s.min[0] + s.max[0]) / 2 + OX;
      const cy = (s.min[1] + s.max[1]) / 2 + OZ;
      expect(isWalkable(ALL, cx, cy)).toBe(true);
    }
  });

  it('nenhum ponto de um spawn enxerga o outro', () => {
    const physics = new PhysicsWorld(galpao);
    physics.step(1 / 60);
    const { attack, defense } = galpao.spawnZones!;
    const pts = (a: typeof attack) => {
      const out: { x: number; y: number; z: number }[] = [];
      for (let x = a.min[0] + 0.5; x < a.max[0]; x += 1)
        for (let z = a.min[1] + 0.5; z < a.max[1]; z += 1) out.push({ x, y: 1.68, z });
      return out;
    };
    const exposed: string[] = [];
    for (const a of pts(attack)) {
      for (const d of pts(defense)) {
        const v = { x: d.x - a.x, y: 0, z: d.z - a.z };
        const len = Math.hypot(v.x, v.z);
        const hit = physics.world.castRay(new RAPIER.Ray(a, { x: v.x / len, y: 0, z: v.z / len }), len, true);
        if (!hit) exposed.push(`${a.x},${a.z} → ${d.x},${d.z}`);
      }
    }
    expect(exposed.slice(0, 5)).toEqual([]);
  });

  it('jogador nasce no chão, livre, e consegue andar', () => {
    const sim = new GameSim(galpao, 1, { bots: false, rounds: false });
    for (let i = 0; i < SIM_HZ; i++) sim.tick(emptyIntent(galpao.spawnYaw));
    const s = sim.player.state;
    expect(s.grounded).toBe(true);
    expect(s.feet.y).toBeLessThan(0.1);
    const z0 = s.feet.z;
    for (let i = 0; i < SIM_HZ; i++) sim.tick({ ...emptyIntent(galpao.spawnYaw), moveZ: 1 });
    expect(sim.player.state.feet.z - z0).toBeGreaterThan(3.5);
  });
});
