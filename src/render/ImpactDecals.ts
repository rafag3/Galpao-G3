// Marcas de tiro nas superfícies. Uma única malha com thin instances:
// 64 marcas custam 1 draw call. As mais antigas são reaproveitadas.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Vec3 } from '../sim/math';

const POOL = 64;
const SIZE = 0.07;

export class ImpactDecals {
  private readonly mesh: Mesh;
  private next = 0;
  private readonly tmp = new Matrix();
  private readonly hidden = Matrix.Scaling(0, 0, 0);

  constructor(scene: Scene) {
    const mat = new StandardMaterial('decal-mat', scene);
    mat.diffuseColor = Color3.FromHexString('#1a1a1a');
    mat.specularColor = Color3.Black();
    mat.zOffset = -2; // evita z-fighting com a parede
    this.mesh = CreatePlane('decals', { size: SIZE }, scene);
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    for (let i = 0; i < POOL; i++) this.mesh.thinInstanceAdd(this.hidden, i === POOL - 1);
    this.mesh.alwaysSelectAsActiveMesh = true; // instâncias espalhadas pelo mapa
  }

  add(point: Vec3, normal: Vec3): void {
    const n = new Vector3(normal.x, normal.y, normal.z).normalize();
    // O plano é visível pelo lado -Z: aponta +Z para dentro da superfície
    const forward = n.negate();
    const up = Math.abs(n.y) > 0.9 ? Vector3.Right() : Vector3.Up();
    const rot = Quaternion.FromLookDirectionLH(forward, up);
    rot.multiplyInPlace(Quaternion.RotationAxis(Vector3.Forward(), Math.random() * Math.PI * 2));
    const s = 0.8 + Math.random() * 0.5;
    Matrix.ComposeToRef(
      new Vector3(s, s, s),
      rot,
      new Vector3(point.x + n.x * 0.004, point.y + n.y * 0.004, point.z + n.z * 0.004),
      this.tmp,
    );
    this.mesh.thinInstanceSetMatrixAt(this.next, this.tmp, true);
    this.next = (this.next + 1) % POOL;
  }
}
