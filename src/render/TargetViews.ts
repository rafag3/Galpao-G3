// Representação visual dos alvos: mesma silhueta da hitbox, pisca ao ser
// atingido e tomba ao ser derrubado.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import { TARGET } from '../sim/config';
import { approach } from '../sim/math';
import type { TargetState } from '../sim/TargetSystem';

interface View {
  pivot: TransformNode;
  material: StandardMaterial;
  flash: number;
}

const BASE_COLOR = Color3.FromHexString('#c4652a');

export class TargetViews {
  private readonly views: View[] = [];

  constructor(scene: Scene, targets: readonly TargetState[]) {
    const { body, head } = TARGET;
    for (const t of targets) {
      const pivot = new TransformNode(`target-${t.id}`, scene);
      pivot.position.set(t.x, 0, t.z);
      pivot.rotation.y = t.yaw;

      const b = CreateBox('tb', { width: body.width, height: body.height, depth: body.depth }, scene);
      b.position.y = body.height / 2;
      const h = CreateBox('th', { size: head.size }, scene);
      h.position.y = head.centerY;
      // Corpo + cabeça numa malha só: 1 draw call por alvo
      const mesh = Mesh.MergeMeshes([b, h], true)!;
      mesh.name = `target-mesh-${t.id}`;
      mesh.parent = pivot;
      mesh.isPickable = false;

      const material = new StandardMaterial(`target-mat-${t.id}`, scene);
      material.diffuseColor = BASE_COLOR.clone();
      material.specularColor = new Color3(0.1, 0.1, 0.1);
      mesh.material = material;
      this.views.push({ pivot, material, flash: 0 });
    }
  }

  onHit(targetId: number): void {
    const v = this.views[targetId];
    if (v) v.flash = 1;
  }

  update(dt: number, targets: readonly TargetState[]): void {
    for (const t of targets) {
      const v = this.views[t.id];
      if (!v) continue;
      // Tomba para trás (para longe de quem atirou), levanta mais devagar
      const target = t.down ? -Math.PI / 2 : 0;
      v.pivot.rotation.x = approach(v.pivot.rotation.x, target, (t.down ? 7 : 3) * dt);

      v.flash = Math.max(0, v.flash - dt * 8);
      v.material.emissiveColor.set(v.flash * 0.9, v.flash * 0.9, v.flash * 0.9);
    }
  }
}
