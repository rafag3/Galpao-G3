// Carregamento de modelos .glb (soldados e armas) em AssetContainers.
//
// Os materiais do glTF chegam como PBR. Sem mapa de ambiente na cena, metal
// PBR fica quase preto, e PBR é mais caro no celular. Convertemos para
// StandardMaterial (o mesmo do resto do jogo): cor base, brilho a partir de
// metalness/roughness, e uma luz própria mínima para não sumir na sombra.

import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/loaders/glTF/2.0';

/** Tons por nome de material (cores do glTF são substituídas). */
export type Recolor = Record<string, string>;

export async function loadModel(scene: Scene, url: string, recolor: Recolor = {}, emissive = 0.04): Promise<AssetContainer> {
  const c = await LoadAssetContainerAsync(url, scene);
  const converted = new Map<string, StandardMaterial>();
  for (const mesh of c.meshes) {
    const src = mesh.material as PBRMaterial | null;
    if (!src || !('albedoColor' in src)) continue;
    let m = converted.get(src.uniqueId.toString());
    if (!m) {
      m = new StandardMaterial(src.name, scene);
      const hex = recolor[src.name.toLowerCase()];
      m.diffuseColor = hex ? Color3.FromHexString(hex) : src.albedoColor.toGammaSpace();
      if (src.albedoTexture) m.diffuseTexture = src.albedoTexture;
      const metal = src.metallic ?? 0;
      const rough = src.roughness ?? 1;
      const spec = metal > 0.5 ? 0.35 : 0.08 * (1 - rough) + 0.03;
      m.specularColor = new Color3(spec, spec, spec);
      m.specularPower = 8 + (1 - rough) * 56;
      m.emissiveColor = m.diffuseColor.scale(emissive);
      m.backFaceCulling = src.backFaceCulling;
      converted.set(src.uniqueId.toString(), m);
      c.materials.push(m);
    }
    mesh.material = m;
  }
  for (const mat of [...c.materials]) {
    if ('albedoColor' in mat) {
      c.materials.splice(c.materials.indexOf(mat), 1);
      mat.dispose(false, false);
    }
  }
  return c;
}
