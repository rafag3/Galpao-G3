// Letras dos bombsites pintadas no chão. Só visual, gerado a partir de
// level.bombsites (os mesmos dados que a lógica da bomba vai usar).

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { Bombsite } from '../level/LevelData';

const LETTER_SIZE = 5; // metros

export function buildSiteSigns(scene: Scene, sites: readonly Bombsite[]): void {
  for (const site of sites) {
    const tex = new DynamicTexture(`site-${site.id}`, { width: 256, height: 256 }, scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 220px system-ui, sans-serif';
    (ctx as CanvasRenderingContext2D).textAlign = 'center';
    (ctx as CanvasRenderingContext2D).textBaseline = 'middle';
    ctx.fillText(site.id, 128, 140);
    tex.update();

    const mat = new StandardMaterial(`site-mat-${site.id}`, scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveColor = new Color3(0.35, 0.25, 0.1);
    mat.specularColor = Color3.Black();
    mat.zOffset = -3;

    const sign = CreateGround(`site-sign-${site.id}`, { width: LETTER_SIZE, height: LETTER_SIZE }, scene);
    sign.position.set((site.min[0] + site.max[0]) / 2, 0.03, (site.min[1] + site.max[1]) / 2);
    sign.material = mat;
    sign.isPickable = false;
    sign.freezeWorldMatrix();
  }
}
