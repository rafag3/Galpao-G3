// Materiais do mapa a partir das texturas procedurais, e caixas com UV em
// escala de mundo (a textura repete a cada N metros, sem esticar em paredes
// grandes nem encolher em caixas pequenas).

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Block, BlockKind } from '../../level/LevelData';
import * as T from './ProceduralTextures';

/** Variações de material: o contêiner tem três cores com a mesma textura. */
export type MaterialKey = BlockKind | 'container-red' | 'container-green';

interface Spec {
  tex: () => T.TexturePair;
  /** Metros por repetição da textura, ou 'fit' = uma vez por face. */
  scale: number | 'fit';
  tint?: string;
  specular?: number;
  /** Textura com recorte por transparência (pintura no chão). */
  cutout?: boolean;
}

const SPECS: Record<MaterialKey, Spec> = {
  floor: { tex: T.concreteFloor, scale: 4, specular: 0.04 },
  wall: { tex: T.concreteWall, scale: 4, specular: 0.03 },
  ceiling: { tex: T.concreteWall, scale: 4, specular: 0.03 },
  roof: { tex: T.corrugatedMetal, scale: 3, specular: 0.25 },
  crate: { tex: T.woodCrate, scale: 'fit', specular: 0.02 },
  container: { tex: T.shippingContainer, scale: 2.4, tint: '#4f7397', specular: 0.2 },
  'container-red': { tex: T.shippingContainer, scale: 2.4, tint: '#a0453a', specular: 0.2 },
  'container-green': { tex: T.shippingContainer, scale: 2.4, tint: '#4f7a4c', specular: 0.2 },
  pillar: { tex: T.steelPillar, scale: 'fit', specular: 0.3 },
  truck: { tex: T.truckPaint, scale: 4, specular: 0.35 },
  ramp: { tex: T.treadPlate, scale: 1.5, specular: 0.4 },
  siteMarking: { tex: T.siteHatch, scale: 3, cutout: true, specular: 0 },
};

/** Gera as texturas sob demanda e reaproveita entre materiais. */
export class MapMaterials {
  private readonly textures = new Map<() => T.TexturePair, T.TexturePair>();
  private readonly materials = new Map<MaterialKey, StandardMaterial>();

  /** @param relief false = sem normal map (modo leve) */
  constructor(
    private readonly scene: Scene,
    private readonly relief = true,
  ) {}

  /** Variante determinística por posição (mesma caixa, mesma cor sempre). */
  static keyFor(b: Block): MaterialKey {
    if (b.kind !== 'container') return b.kind;
    const h = Math.abs(Math.round(b.position[0] * 7 + b.position[2] * 13)) % 3;
    return h === 0 ? 'container' : h === 1 ? 'container-red' : 'container-green';
  }

  get(key: MaterialKey): StandardMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const spec = SPECS[key];
    let pair = this.textures.get(spec.tex);
    if (!pair) {
      pair = spec.tex();
      this.textures.set(spec.tex, pair);
    }

    const m = new StandardMaterial(`mat-${key}`, this.scene);
    m.diffuseTexture = this.toTexture(`${key}-c`, pair.color);
    if (this.relief) m.bumpTexture = this.toTexture(`${key}-n`, pair.normal);
    if (spec.tint) m.diffuseColor = Color3.FromHexString(spec.tint);
    const s = spec.specular ?? 0.05;
    m.specularColor = new Color3(s, s, s);
    m.specularPower = 32;
    if (spec.cutout) {
      m.diffuseTexture.hasAlpha = true;
      m.useAlphaFromDiffuseTexture = true;
      m.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
      m.alphaCutOff = 0.5;
      m.zOffset = -2;
    }
    this.materials.set(key, m);
    return m;
  }

  private toTexture(name: string, canvas: HTMLCanvasElement): DynamicTexture {
    const t = new DynamicTexture(name, canvas, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4; // chão em ângulo raso fica nítido
    t.update(); // update(false) inverteria a textura na vertical
    return t;
  }

  /** Caixa com UV em escala de mundo para o tipo do bloco. */
  box(name: string, b: Block, key: MaterialKey): Mesh {
    const [w, h, d] = b.size;
    const scale = SPECS[key].scale;
    const uv = (su: number, sv: number) =>
      scale === 'fit' ? new Vector4(0, 0, 1, 1) : new Vector4(0, 0, su / scale, sv / scale);
    // Ordem das faces no Babylon: frente, trás, direita, esquerda, topo, base
    const faceUV = [uv(w, h), uv(w, h), uv(d, h), uv(d, h), uv(w, d), uv(w, d)];
    return CreateBox(name, { width: w, height: h, depth: d, faceUV, wrap: true }, this.scene);
  }
}
