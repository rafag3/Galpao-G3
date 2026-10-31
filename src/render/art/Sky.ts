// Céu em degradê numa esfera gigante: 1 draw call, sem textura baixada.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Scene } from '@babylonjs/core/scene';

export function buildSky(scene: Scene): void {
  const tex = new DynamicTexture('sky', { width: 4, height: 256 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#5f8fc4'); // zênite
  g.addColorStop(0.42, '#a9c3dc');
  g.addColorStop(0.5, '#d9dcd6'); // horizonte enevoado
  g.addColorStop(1, '#8c8a84');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  tex.update();

  const mat = new StandardMaterial('sky-mat', scene);
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.fogEnabled = false;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();

  const sky = CreateSphere('sky', { diameter: 400, segments: 16 }, scene);
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false;
  sky.renderingGroupId = 0;
}
