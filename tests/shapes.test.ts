// Geometria gerada por código: orientação dos triângulos (face invertida some com o culling).
import { it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { roundedBox } from '../src/render/art/Shapes';

function windingSigns(m: Mesh) {
  const p = m.getVerticesData(VertexBuffer.PositionKind)!;
  const n = m.getVerticesData(VertexBuffer.NormalKind)!;
  const idx = m.getIndices()!;
  let pos = 0, neg = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const e1 = [p[b*3]-p[a*3], p[b*3+1]-p[a*3+1], p[b*3+2]-p[a*3+2]];
    const e2 = [p[c*3]-p[a*3], p[c*3+1]-p[a*3+1], p[c*3+2]-p[a*3+2]];
    const cr = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    const nn = [n[a*3]+n[b*3]+n[c*3], n[a*3+1]+n[b*3+1]+n[c*3+1], n[a*3+2]+n[b*3+2]+n[c*3+2]];
    const d = cr[0]*nn[0]+cr[1]*nn[1]+cr[2]*nn[2];
    if (Math.abs(d) < 1e-12) continue;
    d > 0 ? pos++ : neg++;
  }
  return { pos, neg };
}
it('caixa arredondada tem todas as faces viradas para fora (mesma ordem da caixa do Babylon)', () => {
  const scene = new Scene(new NullEngine());
  const ref = windingSigns(CreateBox('b', { size: 1 }, scene));
  const mine = windingSigns(roundedBox('r', { width: 0.3, height: 0.1, depth: 0.5, radius: 0.02 }, scene));
  expect(ref.pos === 0 || ref.neg === 0).toBe(true);
  const refSign = ref.pos > 0 ? 'pos' : 'neg';
  expect(mine[refSign === 'pos' ? 'neg' : 'pos']).toBe(0);
});
