// Silhuetas dos bots (placeholder geométrico até a arte final). Cor por
// equipe, agacha, pisca ao ser atingido, tomba ao morrer e mostra o clarão
// do tiro para o jogador localizar de onde vem o fogo.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { CombatantView } from '../sim/Combatant';
import type { EntityId } from '../sim/events';
import { approach, type Vec3 } from '../sim/math';

const TEAM_COLOR = { defense: '#3b5f8f', attack: '#b06a3a' } as const;

interface View {
  root: TransformNode;
  body: TransformNode;
  material: StandardMaterial;
  flash: Mesh;
  hitFlash: number;
  muzzle: number;
  fall: number;
}

export class CombatantViews {
  private readonly views = new Map<EntityId, View>();

  constructor(private readonly scene: Scene) {}

  private create(c: CombatantView): View {
    const scene = this.scene;
    const root = new TransformNode(`cv-${c.id}`, scene);
    const body = new TransformNode(`cv-body-${c.id}`, scene);
    body.parent = root;

    const parts: [number, number, number, number, number, number][] = [
      // w, h, d, x, y, z
      [0.34, 0.86, 0.24, 0, 0.43, 0], // pernas
      [0.52, 0.6, 0.3, 0, 1.16, 0], // tronco + colete
      [0.26, 0.26, 0.26, 0, 1.62, 0.01], // cabeça
      [0.22, 0.12, 0.28, 0, 1.79, 0], // capacete
      [0.06, 0.08, 0.55, 0.16, 1.3, 0.3], // fuzil
    ];
    const meshes = parts.map(([w, h, d, x, y, z], i) => {
      const m = CreateBox(`cvp${i}`, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      return m;
    });
    const mesh = Mesh.MergeMeshes(meshes, true)!;
    mesh.name = `cv-mesh-${c.id}`;
    mesh.parent = body;
    mesh.isPickable = false;

    const material = new StandardMaterial(`cv-mat-${c.id}`, scene);
    material.diffuseColor = Color3.FromHexString(TEAM_COLOR[c.team]);
    material.specularColor = new Color3(0.08, 0.08, 0.08);
    mesh.material = material;

    const flashMat = new StandardMaterial(`cv-flash-${c.id}`, scene);
    flashMat.emissiveColor = Color3.FromHexString('#ffd27a');
    flashMat.disableLighting = true;
    const flash = CreateBox(`cv-flash-${c.id}`, { size: 0.18 }, scene);
    flash.material = flashMat;
    flash.parent = body;
    flash.position.set(0.16, 1.3, 0.62);
    flash.isPickable = false;
    flash.isVisible = false;

    const v = { root, body, material, flash, hitFlash: 0, muzzle: 0, fall: 0 };
    this.views.set(c.id, v);
    return v;
  }

  onShot(id: EntityId): void {
    const v = this.views.get(id);
    if (v) v.muzzle = 0.06;
  }

  onHit(id: EntityId): void {
    const v = this.views.get(id);
    if (v) v.hitFlash = 1;
  }

  /** @param feetOf posição interpolada dos pés de cada combatente */
  update(dt: number, list: readonly CombatantView[], feetOf: (id: EntityId) => Vec3): void {
    for (const c of list) {
      const v = this.views.get(c.id) ?? this.create(c);
      const f = feetOf(c.id);
      v.root.position.set(f.x, f.y, f.z);
      v.root.rotation.y = c.yaw;
      v.body.scaling.y = approach(v.body.scaling.y, c.crouching ? 0.66 : 1, dt * 6);

      // Tomba para trás ao morrer; volta instantâneo ao renascer
      v.fall = c.alive ? 0 : approach(v.fall, Math.PI / 2, dt * 5);
      v.body.rotation.x = -v.fall;

      v.hitFlash = Math.max(0, v.hitFlash - dt * 8);
      v.material.emissiveColor.set(v.hitFlash, v.hitFlash * 0.5, v.hitFlash * 0.5);
      v.muzzle -= dt;
      v.flash.isVisible = c.alive && v.muzzle > 0;
    }
  }
}
