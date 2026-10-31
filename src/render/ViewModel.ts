// Arma em primeira pessoa (placeholder geométrico) com animação de recuo,
// recarga, balanço ao andar e clarão de disparo. Fica no grupo de render 1,
// desenhado por cima do cenário: não atravessa paredes ao encostar.

import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { WeaponState } from '../sim/WeaponController';

const BASE = new Vector3(0.17, -0.16, 0.36);

export class ViewModel {
  private readonly root: TransformNode;
  private readonly flash: Mesh;
  private kick = 0;
  private flashTimer = 0;
  private bobPhase = 0;

  constructor(scene: Scene, camera: FreeCamera) {
    this.root = new TransformNode('vm-root', scene);
    this.root.parent = camera;
    this.root.position.copyFrom(BASE);

    const dark = new StandardMaterial('vm-dark', scene);
    dark.diffuseColor = Color3.FromHexString('#2b2e33');
    dark.specularColor = new Color3(0.15, 0.15, 0.15);
    const metal = new StandardMaterial('vm-metal', scene);
    metal.diffuseColor = Color3.FromHexString('#4a4f57');
    metal.specularColor = new Color3(0.3, 0.3, 0.3);

    const parts: [string, [number, number, number], [number, number, number], StandardMaterial][] = [
      ['body', [0.06, 0.08, 0.32], [0, 0, 0], dark],
      ['barrel', [0.025, 0.025, 0.18], [0, 0.015, 0.24], metal],
      ['mag', [0.04, 0.1, 0.05], [0, -0.08, 0.05], metal],
      ['grip', [0.045, 0.1, 0.05], [0, -0.07, -0.09], dark],
      ['sight', [0.02, 0.025, 0.06], [0, 0.052, -0.02], metal],
    ];
    for (const [name, [w, h, d], [x, y, z], mat] of parts) {
      const m = CreateBox(`vm-${name}`, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      this.prep(m, mat);
    }

    const flashMat = new StandardMaterial('vm-flash', scene);
    flashMat.emissiveColor = Color3.FromHexString('#ffd27a');
    flashMat.disableLighting = true;
    flashMat.alpha = 0.9;
    flashMat.backFaceCulling = false;
    this.flash = CreatePlane('vm-flash', { size: 0.11 }, scene);
    this.flash.position.set(0, 0.015, 0.36);
    this.prep(this.flash, flashMat);
    this.flash.isVisible = false;
  }

  private prep(m: Mesh, mat: StandardMaterial) {
    m.parent = this.root;
    m.material = mat;
    m.renderingGroupId = 1;
    m.isPickable = false;
  }

  onShot(): void {
    this.kick = 1;
    this.flashTimer = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scaling.setAll(0.8 + Math.random() * 0.5);
  }

  /** @param speedNorm velocidade horizontal / velocidade de corrida (0..1) */
  update(dt: number, weapon: WeaponState, speedNorm: number, grounded: boolean): void {
    this.kick *= Math.exp(-dt * 16);
    if (this.flashTimer > 0) this.flashTimer -= dt;
    this.flash.isVisible = this.flashTimer > 0;

    if (grounded) this.bobPhase += dt * (6 + 6 * speedNorm) * Math.min(1, speedNorm * 3);
    const bobAmt = grounded ? speedNorm : 0;
    const dip = weapon.reloading ? Math.sin(weapon.reloadProgress * Math.PI) : 0;

    this.root.position.set(
      BASE.x + Math.sin(this.bobPhase) * 0.012 * bobAmt,
      BASE.y - Math.abs(Math.cos(this.bobPhase)) * 0.01 * bobAmt - 0.13 * dip,
      BASE.z - 0.045 * this.kick,
    );
    this.root.rotation.set(-0.09 * this.kick + 0.7 * dip, 0, 0.35 * dip);
  }
}
