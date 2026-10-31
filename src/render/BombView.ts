// A bomba no mundo (caída ou plantada) com luz piscando cada vez mais rápido,
// e a bola de fogo da explosão. Placeholders geométricos.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import { ROUND } from '../sim/config';
import type { BombState } from '../sim/RoundSystem';

export class BombView {
  private readonly body: Mesh;
  private readonly led: Mesh;
  private readonly ledMat: StandardMaterial;
  private readonly fireball: Mesh;
  private readonly fireMat: StandardMaterial;
  private boom = 0;
  private blinkPhase = 0;

  constructor(scene: Scene) {
    const mat = new StandardMaterial('bomb-mat', scene);
    mat.diffuseColor = Color3.FromHexString('#3a3f2c');
    this.body = CreateBox('bomb', { width: 0.42, height: 0.14, depth: 0.28 }, scene);
    this.body.material = mat;

    this.ledMat = new StandardMaterial('bomb-led', scene);
    this.ledMat.disableLighting = true;
    this.led = CreateBox('bomb-led', { size: 0.06 }, scene);
    this.led.material = this.ledMat;
    this.led.parent = this.body;
    this.led.position.set(0.12, 0.09, 0);

    this.fireMat = new StandardMaterial('fireball', scene);
    this.fireMat.emissiveColor = Color3.FromHexString('#ffb347');
    this.fireMat.disableLighting = true;
    this.fireball = CreateSphere('fireball', { diameter: 1, segments: 12 }, scene);
    this.fireball.material = this.fireMat;

    for (const m of [this.body, this.led, this.fireball]) m.isPickable = false;
    this.body.setEnabled(false);
    this.fireball.setEnabled(false);
  }

  explode(): void {
    this.boom = 1;
  }

  /** @returns true no frame em que a luz acende (para o bipe). */
  update(dt: number, bomb: BombState): boolean {
    const visible = bomb.status === 'dropped' || bomb.status === 'planted' || bomb.status === 'defused';
    this.body.setEnabled(visible);
    let beep = false;
    if (visible) {
      this.body.position.set(bomb.position.x, bomb.position.y + 0.07, bomb.position.z);
      if (bomb.status === 'planted') {
        // Bipe acelera: de 1 por segundo até ~6 por segundo no fim
        const urgency = 1 - bomb.timeLeft / ROUND.bombSeconds;
        const hz = 1 + urgency * urgency * 5;
        const prev = this.blinkPhase;
        this.blinkPhase = (this.blinkPhase + dt * hz) % 1;
        beep = this.blinkPhase < prev;
        const on = this.blinkPhase < 0.25;
        this.ledMat.emissiveColor.set(on ? 1 : 0.2, 0.05, 0.05);
      } else {
        this.ledMat.emissiveColor.set(bomb.status === 'defused' ? 0.1 : 0.3, bomb.status === 'defused' ? 0.8 : 0.05, 0.05);
      }
    }

    // Bola de fogo: cresce e some em ~0,8 s
    if (this.boom > 0) {
      this.boom = Math.max(0, this.boom - dt * 1.25);
      const t = 1 - this.boom;
      this.fireball.setEnabled(this.boom > 0);
      this.fireball.position.copyFrom(this.body.position);
      this.fireball.scaling.setAll(2 + t * ROUND.explosionLethalRadius * 2);
      this.fireMat.alpha = this.boom;
    }
    return beep;
  }
}
