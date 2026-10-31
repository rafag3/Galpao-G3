// Formas para modelagem por código com aparência menos "caixa":
//   - roundedBox: caixa com quinas arredondadas e normais suaves (o reflexo
//     da luz corre pelas bordas, como numa peça usinada ou moldada)
//   - remapUV: encaixa a UV 0..1 de qualquer malha numa célula de atlas
//
// UV da roundedBox: em metros × `uvScale` (textura em escala de mundo, para
// peças com textura própria) ou dentro de um retângulo de atlas.

import type { Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

export interface RoundedBoxOptions {
  width: number;
  height: number;
  depth: number;
  /** Raio das quinas (limitado à metade da menor medida). */
  radius: number;
  /** Retângulo do atlas (u0, v0, u1, v1) para todas as faces. */
  atlas?: Vector4;
  /** Sem atlas: repetições da textura por metro. */
  uvScale?: number;
}

// Faces: eixo normal, sinal, eixos u e v (regra da mão esquerda do Babylon)
const FACES: [n: number, s: number, u: number, v: number][] = [
  [2, 1, 0, 1],
  [2, -1, 0, 1],
  [0, 1, 2, 1],
  [0, -1, 2, 1],
  [1, 1, 0, 2],
  [1, -1, 0, 2],
];

/** Posições ao longo de um eixo: densas na borda (chanfro), esparsas no meio. */
function stops(half: number, r: number): number[] {
  const k = [0, 0.35, 1];
  const a = k.map((t) => -half + r * t);
  const b = k.map((t) => half - r * t).reverse();
  return r > 1e-5 ? [...a, ...b] : [-half, half];
}

export function roundedBox(name: string, o: RoundedBoxOptions, scene: Scene): Mesh {
  const half = [o.width / 2, o.height / 2, o.depth / 2];
  const r = Math.min(o.radius, ...half.map((h) => h * 0.98));
  const inner = half.map((h) => h - r);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const scale = o.uvScale ?? 4;

  for (const [n, s, ua, va] of FACES) {
    const us = stops(half[ua], r);
    const vs = stops(half[va], r);
    const base = positions.length / 3;
    for (let j = 0; j < vs.length; j++) {
      for (let i = 0; i < us.length; i++) {
        const p = [0, 0, 0];
        p[n] = s * half[n];
        p[ua] = us[i];
        p[va] = vs[j];
        // Ponto da caixa interna mais próximo; a superfície fica a `r` dele
        const c = p.map((x, k) => Math.max(-inner[k], Math.min(inner[k], x)));
        let d = p.map((x, k) => x - c[k]);
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        d = d.map((x) => x / len);
        positions.push(c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r);
        normals.push(d[0], d[1], d[2]);
        const fu = (us[i] + half[ua]) / (2 * half[ua]);
        const fv = (vs[j] + half[va]) / (2 * half[va]);
        if (o.atlas) uvs.push(o.atlas.x + fu * (o.atlas.z - o.atlas.x), o.atlas.y + fv * (o.atlas.w - o.atlas.y));
        else uvs.push(us[i] * scale, vs[j] * scale);
      }
    }
    // Ordem dos triângulos: a frente da face aponta para fora. O Babylon usa a
    // ordem cujo produto vetorial fica oposto à normal; e_u × e_v decide.
    const cols = us.length;
    const eu = [0, 0, 0];
    const ev = [0, 0, 0];
    eu[ua] = 1;
    ev[va] = 1;
    const cross = [eu[1] * ev[2] - eu[2] * ev[1], eu[2] * ev[0] - eu[0] * ev[2], eu[0] * ev[1] - eu[1] * ev[0]];
    const flip = cross[n] * s > 0;
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = base + j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d2 = c + 1;
        if (flip) indices.push(a, c, b, b, c, d2);
        else indices.push(a, b, c, b, d2, c);
      }
    }
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  return mesh;
}

/** Encaixa a UV 0..1 de uma malha (cápsula, cilindro, esfera) numa célula do atlas. */
export function remapUV(mesh: Mesh, rect: Vector4): Mesh {
  const uv = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!uv) return mesh;
  for (let i = 0; i < uv.length; i += 2) {
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    uv[i] = rect.x + clamp01(uv[i]) * (rect.z - rect.x);
    uv[i + 1] = rect.y + clamp01(uv[i + 1]) * (rect.w - rect.y);
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv);
  return mesh;
}
