// Mapa "Galpão" — primeiro mapa competitivo (blockout).
//
// Autoria em coordenadas de PLANTA (metros, origem no canto sudoeste,
// y da planta = norte). A conversão para o mundo centraliza o mapa:
// mundo.x = planta.x - 36, mundo.z = planta.y - 32. Norte = +Z.
//
// Rotas do ataque (corrida a 6,4 m/s):
//   1. Rota A, corredor oeste ........ ~71 m, ~11 s
//   2. Rota B, pátio de caminhões .... ~62 m, ~10 s
//   3. Estreita, galpão → B .......... ~51 m, ~8 s (passagem de 2 m)
// Defesa chega a qualquer bombsite em ~4 s.

import type { Area, Block, BlockKind, BotPost, LevelData } from './LevelData';
import { solidBlocks, type PlanRect } from './walkableGrid';

const W = 72;
const D = 64;
const OX = -W / 2;
const OZ = -D / 2;
const WALL_H = 8;

/** Áreas onde se pode andar, nomeadas para facilitar a manutenção. */
export const WALKABLE: Record<string, PlanRect> = {
  patioSul: [4, 2, 70, 16],
  corredorOeste: [4, 16, 10, 44],
  bombsiteA: [2, 44, 22, 62],
  conectorCtA: [22, 52, 30, 58],
  spawnDefesa: [30, 54, 42, 62],
  conectorCtB: [42, 52, 52, 58],
  bombsiteB: [52, 36, 70, 60],
  caminhoes: [54, 16, 70, 36],
  galpao: [22, 22, 50, 42],
  // Fora do eixo do mid: evita linha de visão direta entre os spawns
  portaSulGalpao: [40, 16, 46, 22],
  midNorte: [33, 42, 39, 54],
  passagemEstreita: [50, 38, 52, 40],
};

/** Caixa com centro na planta (px, py), base apoiada em `base`. */
function box(kind: BlockKind, px: number, py: number, w: number, d: number, h: number, base = 0, yaw = 0): Block {
  return {
    kind,
    position: [px + OX, base + h / 2, py + OZ],
    size: [w, h, d],
    rotation: yaw ? [0, yaw, 0] : undefined,
  };
}

const crate = (px: number, py: number, stack = 0) => box('crate', px, py, 1.2, 1.2, 1.2, stack * 1.2);
const containerEW = (px: number, py: number) => box('container', px, py, 6, 2.4, 2.6);
const containerNS = (px: number, py: number) => box('container', px, py, 2.4, 6, 2.6);
const pillar = (px: number, py: number, h: number) => box('pillar', px, py, 0.6, 0.6, h);
/** Mureta de 1,1 m: protege quem está agachado. */
const lowWall = (px: number, py: number, w: number, d: number) => box('crate', px, py, w, d, 1.1);

function roof(r: PlanRect, height: number): Block {
  const [x0, y0, x1, y1] = r;
  return box('roof', (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0.4, height);
}

function marking(r: PlanRect): Block {
  const [x0, y0, x1, y1] = r;
  return { ...box('siteMarking', (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0.02, 0.002), collide: false };
}

const toArea = ([x0, y0, x1, y1]: PlanRect): Area => ({ min: [x0 + OX, y0 + OZ], max: [x1 + OX, y1 + OZ] });
const post = (px: number, py: number, watchYaw: number): BotPost => ({ position: [px + OX, py + OZ], watchYaw });

const SITE_A: PlanRect = [4, 46, 20, 60];
const SITE_B: PlanRect = [54, 38, 68, 58];

const props: Block[] = [
  // Pátio sul (saída do ataque)
  containerEW(16, 9),
  crate(26, 12),
  crate(27.2, 12),
  crate(26.6, 12, 1),
  crate(48, 6),
  crate(49.2, 6),
  crate(58, 12),
  lowWall(40, 14, 4, 0.4),

  // Corredor oeste (rota A)
  crate(8.5, 28),
  crate(5.5, 38),

  // Bombsite A (pátio aberto)
  containerEW(8, 49),
  crate(16, 55),
  crate(17.2, 55),
  crate(16.6, 55, 1),
  crate(11, 58),
  lowWall(18, 47, 3, 0.4),

  // Galpão central
  containerEW(28, 27),
  containerNS(44, 35),
  crate(36, 31),
  crate(37.2, 31),
  crate(36.6, 31, 1),
  crate(31, 37),
  pillar(29, 34, WALL_H),
  // Contêiner logo após a porta sul: quebra a linha de visão até o mid
  containerEW(42, 26),
  pillar(47, 31, WALL_H),
  pillar(36, 38, WALL_H),

  // Mid norte (conexão galpão ↔ defesa)
  crate(34, 48),

  // Pátio de caminhões (rota B)
  box('truck', 60, 26, 2.6, 8, 3.2),
  crate(66, 20),
  crate(67.2, 20),
  crate(66, 31),

  // Bombsite B (doca coberta)
  pillar(57, 44, 5),
  pillar(65, 44, 5),
  pillar(57, 52, 5),
  pillar(65, 52, 5),
  crate(60, 48),
  crate(61.2, 48),
  crate(60.6, 48, 1),
  crate(67, 56),
  crate(55, 40),
  containerNS(68, 46),
];

/** Pegadas dos objetos sólidos, em planta, para o teste de conectividade. */
export const PROP_BLOCKS = props;

export const galpao: LevelData = {
  name: 'Galpão',
  blocks: [
    { kind: 'floor', position: [0, -0.25, 0], size: [W, 0.5, D] },
    ...solidBlocks(Object.values(WALKABLE), { width: W, depth: D, offsetX: OX, offsetZ: OZ }, WALL_H),
    roof(WALKABLE.galpao, WALL_H),
    roof(WALKABLE.bombsiteB, 5),
    marking(SITE_A),
    marking(SITE_B),
    ...props,
  ],
  // No mapa de competição os bots da defesa ocupam o lugar dos alvos
  targets: [],
  // Defesa: um no A, um no B e um no mid. Saem do spawn e caminham até o posto.
  defensePosts: [
    post(13, 54, Math.PI), // A: vigia a saída do corredor oeste
    post(62, 51, Math.PI), // B: vigia a entrada dos caminhões e a passagem estreita
    post(36, 47, Math.PI), // mid: vigia a porta norte do galpão
  ],
  spawn: { x: 36 + OX, y: 0.5, z: 6 + OZ },
  spawnYaw: 0,
  bombsites: [
    { id: 'A', ...toArea(SITE_A) },
    { id: 'B', ...toArea(SITE_B) },
  ],
  spawnZones: { attack: toArea([30, 2, 42, 10]), defense: toArea([30, 54, 42, 62]) },
};
