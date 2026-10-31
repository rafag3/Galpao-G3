// Atlas de texturas dos soldados: todas as partes de um soldado usam UMA
// textura (e um material), cada peça mapeada para a sua célula. Assim cada
// peça custa um draw call sem trocar de material.

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Team } from '../../sim/Combatant';
import { fbm, hex, mix, render } from './ProceduralTextures';
import * as W from './WeaponTextures';

/** Células do atlas (4 colunas x 2 linhas). */
export type AtlasCell = 'uniform' | 'vest' | 'gear' | 'boots' | 'mask' | 'gun' | 'lens' | 'pack';

const LAYOUT: Record<AtlasCell, [col: number, row: number]> = {
  uniform: [0, 0],
  vest: [1, 0],
  gear: [2, 0],
  boots: [3, 0],
  mask: [0, 1],
  gun: [1, 1],
  lens: [2, 1],
  pack: [3, 1],
};
const COLS = 4;
const ROWS = 2;
const CELL = 128;

/** Tecido simples com ruído (colete, mochila, botas). */
function fabric(base: string, dark: string, seed: number) {
  return render((u, v) => {
    const n = fbm(u, v, 4, 3, seed);
    const weave = (Math.sin(u * 160) + Math.sin(v * 160)) * 0.25 + 0.5;
    // Fitas MOLLE horizontais
    const molle = ((v * 6) % 1) < 0.12 ? 1 : 0;
    return { c: mix(hex(base), hex(dark), n * 0.5 + weave * 0.15 + molle * 0.35), h: 0 };
  }, 1, CELL).color;
}

const solid = (base: string, dark: string, seed: number) =>
  render((u, v) => ({ c: mix(hex(base), hex(dark), fbm(u, v, 4, 3, seed) * 0.6), h: 0 }), 1, CELL).color;

function cells(team: Team): Record<AtlasCell, HTMLCanvasElement> {
  if (team === 'defense') {
    return {
      uniform: W.sleeveDefense().color,
      vest: fabric('#6e5a3e', '#4d3f2b', 301),
      gear: solid('#1d1f22', '#0f1012', 303), // capacete, luvas, joelheiras
      boots: solid('#1a1a1a', '#0c0c0c', 305),
      mask: solid('#151515', '#0a0a0a', 307),
      gun: W.parkerized().color,
      lens: solid('#c98a2a', '#8a5a18', 309), // óculos âmbar
      pack: fabric('#2e3f5c', '#1f2c42', 311),
    };
  }
  return {
    uniform: W.sleeveAttack().color,
    vest: fabric('#5d6142', '#40432c', 321),
    gear: solid('#2a2721', '#17150f', 323), // luvas, joelheiras
    boots: solid('#8a7656', '#5f5039', 325),
    mask: solid('#121212', '#080808', 327),
    gun: W.parkerized().color,
    lens: solid('#2a2e33', '#14171a', 329), // óculos escuros
    pack: fabric('#6b6a48', '#4a4930', 331), // mochila + capuz
  };
}

export function buildAtlas(scene: Scene, team: Team): DynamicTexture {
  const tex = new DynamicTexture(`soldier-atlas-${team}`, { width: COLS * CELL, height: ROWS * CELL }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  for (const [cell, canvas] of Object.entries(cells(team)) as [AtlasCell, HTMLCanvasElement][]) {
    const [c, r] = LAYOUT[cell];
    ctx.drawImage(canvas, c * CELL, r * CELL, CELL, CELL);
  }
  tex.update();
  return tex;
}

/**
 * Retângulo UV de uma célula, para `faceUV` das caixas. Margem interna evita
 * que o filtro da textura "vaze" a cor da célula vizinha.
 */
export function cellUV(cell: AtlasCell): Vector4 {
  const [c, r] = LAYOUT[cell];
  const m = 0.08;
  const u0 = (c + m) / COLS;
  const u1 = (c + 1 - m) / COLS;
  // Linha 0 do canvas fica no topo da textura (v alto)
  const v0 = 1 - (r + 1 - m) / ROWS;
  const v1 = 1 - (r + m) / ROWS;
  return new Vector4(u0, v0, u1, v1);
}
