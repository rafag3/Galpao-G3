// Render com Babylon.js. Só LÊ o estado da simulação; nunca o altera.
// Imports profundos (por arquivo) mantêm o bundle pequeno.

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';

import type { LevelData } from '../level/LevelData';
import { MapMaterials, type MaterialKey } from './art/MapMaterials';
import { buildSky } from './art/Sky';
import { quatFromEuler, type Vec3 } from '../sim/math';
import type { TargetState } from '../sim/TargetSystem';
import { BombView } from './BombView';
import { CombatantViews } from './CombatantViews';
import { ImpactDecals } from './ImpactDecals';
import { buildSiteSigns } from './SiteSigns';
import { TargetViews } from './TargetViews';
import { VIEWMODEL_LAYER, ViewModel } from './ViewModel';

/** Limite de resolução interna: telas de celular têm DPR 3, o que custa caro. */
const MAX_PIXEL_RATIO = 1.5;

/**
 * alta: sombras, relevo e resolução até 1,5x.
 * leve: sem sombras e sem relevo, resolução 1x (aparelhos fracos).
 */
export type GraphicsQuality = 'high' | 'low';

export class GameRenderer {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: FreeCamera;
  readonly viewModel: ViewModel;
  readonly targets: TargetViews;
  readonly impacts: ImpactDecals;
  readonly combatants: CombatantViews;
  readonly bomb: BombView;
  private readonly shadows: ShadowGenerator | null;

  /**
   * @param lowEnd celular: sombra em resolução menor e filtro mais barato
   * @param quality 'low' desliga sombras e relevo
   */
  constructor(
    canvas: HTMLCanvasElement,
    level: LevelData,
    targets: readonly TargetState[],
    lowEnd = false,
    private readonly quality: GraphicsQuality = 'high',
  ) {
    this.engine = new Engine(
      canvas,
      true,
      { preserveDrawingBuffer: false, stencil: false, powerPreference: 'high-performance', antialias: true },
      false,
    );
    this.applyPixelRatio();

    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = Color4.FromHexString('#a9b4bfff');
    scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    scene.skipPointerMovePicking = true; // não usamos picking do Babylon
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.66, 0.7, 0.75);
    scene.fogStart = 45;
    scene.fogEnd = 140;

    this.camera = new FreeCamera('player-cam', Vector3.Zero(), scene);
    this.camera.minZ = 0.05;
    this.camera.maxZ = 200;
    this.camera.fov = 1.2; // ~69° vertical; amplo o bastante para tela larga
    this.camera.inputs.clear(); // a câmera é dirigida pela simulação
    this.camera.layerMask = ~VIEWMODEL_LAYER & 0x0fffffff;

    // Câmera da arma: segue a principal com campo de visão mais fechado, para
    // a arma ter proporção natural sem estreitar a visão do jogo
    const vmCam = new FreeCamera('viewmodel-cam', Vector3.Zero(), scene);
    vmCam.parent = this.camera;
    vmCam.fov = 0.82;
    vmCam.minZ = 0.01;
    vmCam.maxZ = 5;
    vmCam.inputs.clear();
    vmCam.layerMask = VIEWMODEL_LAYER;
    scene.activeCameras = [this.camera, vmCam];

    // Luz de preenchimento (céu) fria e sol quente: o contraste dá volume
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.65;
    hemi.diffuse = new Color3(0.78, 0.84, 0.95);
    hemi.groundColor = new Color3(0.32, 0.3, 0.28);
    hemi.specular = Color3.Black();
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35).normalize(), scene);
    sun.position = new Vector3(40, 90, -30);
    sun.intensity = 1.05;
    sun.diffuse = new Color3(1, 0.93, 0.8);

    // Sombras do cenário: o mapa é estático, então o shadow map é desenhado
    // uma única vez (custo zero por frame depois disso).
    const shadows = quality === 'high' ? new ShadowGenerator(lowEnd ? 1024 : 2048, sun) : null;
    if (shadows) {
      shadows.usePercentageCloserFiltering = true;
      shadows.filteringQuality = lowEnd ? ShadowGenerator.QUALITY_LOW : ShadowGenerator.QUALITY_MEDIUM;
      shadows.bias = 0.0015;
      shadows.normalBias = 0.02;
      // Só congela depois que shaders e malhas estão prontos: congelar no
      // primeiro frame grava um shadow map vazio.
      scene.executeWhenReady(() => {
        const map = shadows.getShadowMap()!;
        map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        map.resetRefreshCounter();
      });
    }
    this.shadows = shadows;

    buildSky(scene);
    this.buildLevel(level);
    buildSiteSigns(scene, level.bombsites ?? []);
    this.targets = new TargetViews(scene, targets);
    this.impacts = new ImpactDecals(scene);
    this.combatants = new CombatantViews(scene, this.quality === 'high');
    this.bomb = new BombView(scene);
    this.viewModel = new ViewModel(scene, this.camera);
    scene.setRenderingAutoClearDepthStencil(1, true);
  }

  private buildLevel(level: LevelData): void {
    // Agrupa blocos por material e funde em uma malha por material: ~12 draw
    // calls para o cenário inteiro, em vez de um por bloco.
    const mats = new MapMaterials(this.scene, this.quality === 'high');
    const byKey = new Map<MaterialKey, Mesh[]>();
    for (const [i, b] of level.blocks.entries()) {
      const key = MapMaterials.keyFor(b);
      const mesh = mats.box(`b${i}`, b, key);
      mesh.position.set(...b.position);
      const [rx, ry, rz] = b.rotation ?? [0, 0, 0];
      const q = quatFromEuler(rx, ry, rz);
      mesh.rotationQuaternion = new Quaternion(q.x, q.y, q.z, q.w);
      const list = byKey.get(key) ?? [];
      list.push(mesh);
      byKey.set(key, list);
    }

    for (const [key, meshes] of byKey) {
      const merged = Mesh.MergeMeshes(meshes, true, true);
      if (!merged) continue;
      merged.name = `level-${key}`;
      merged.material = mats.get(key);
      merged.isPickable = false;
      merged.receiveShadows = !!this.shadows && key !== 'siteMarking';
      if (key !== 'floor' && key !== 'siteMarking') this.shadows?.addShadowCaster(merged, false);
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
    }
  }

  /** Atualiza câmera e desenha um frame. */
  render(eye: Vec3, yaw: number, pitch: number): void {
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.scene.render();
  }

  /**
   * Ponto do mundo → posição na tela em px CSS, usando a câmera do último
   * frame desenhado. null se estiver atrás da câmera ou fora da tela.
   */
  project(p: Vec3): { x: number; y: number } | null {
    const cam = this.camera;
    const to = this.tmpA.set(p.x - cam.position.x, p.y - cam.position.y, p.z - cam.position.z);
    cam.getDirectionToRef(Vector3.Forward(), this.tmpB);
    if (Vector3.Dot(to, this.tmpB) < 0.2) return null;
    const ndc = Vector3.TransformCoordinatesFromFloatsToRef(p.x, p.y, p.z, this.scene.getTransformMatrix(), this.tmpA);
    if (Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) return null;
    const s = this.engine.getHardwareScalingLevel();
    const w = this.engine.getRenderWidth(true) * s;
    const h = this.engine.getRenderHeight(true) * s;
    return { x: ((ndc.x + 1) / 2) * w, y: ((1 - ndc.y) / 2) * h };
  }
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

  /** Pixels de tela por radiano no centro da tela (para a mira dinâmica). */
  pixelsPerRadian(): number {
    const h = this.engine.getRenderHeight(true) * this.engine.getHardwareScalingLevel();
    return h / 2 / Math.tan(this.camera.fov / 2);
  }

  applyPixelRatio(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? MAX_PIXEL_RATIO : 1);
    this.engine.setHardwareScalingLevel(1 / dpr);
  }

  resize(): void {
    this.applyPixelRatio();
    this.engine.resize();
  }

  dispose(): void {
    this.engine.dispose();
  }
}
