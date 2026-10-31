// Render com Babylon.js. Só LÊ o estado da simulação; nunca o altera.
// Imports profundos (por arquivo) mantêm o bundle pequeno.

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';

import type { BlockKind, LevelData } from '../level/LevelData';
import { quatFromEuler, type Vec3 } from '../sim/math';

const PALETTE: Record<BlockKind, { main: string; line: string }> = {
  floor: { main: '#6b6f73', line: '#8a8f94' },
  wall: { main: '#7d8186', line: '#9a9fa4' },
  ceiling: { main: '#7d8186', line: '#9a9fa4' },
  crate: { main: '#8a7a62', line: '#a8977c' },
  container: { main: '#4f6a80', line: '#6b8aa3' },
  ramp: { main: '#757a6e', line: '#949a8b' },
  target: { main: '#b5652e', line: '#d9894f' },
};

/** Limite de resolução interna: telas de celular têm DPR 3, o que custa caro. */
const MAX_PIXEL_RATIO = 1.5;

export class GameRenderer {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: FreeCamera;

  constructor(canvas: HTMLCanvasElement, level: LevelData) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false,
      powerPreference: 'high-performance',
      antialias: true,
    }, false);
    this.applyPixelRatio();

    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = Color4.FromHexString('#a9b4bfff');
    scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    scene.skipPointerMovePicking = true; // não usamos picking do Babylon
    scene.autoClear = true;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.66, 0.7, 0.75);
    scene.fogStart = 25;
    scene.fogEnd = 70;

    this.camera = new FreeCamera('player-cam', Vector3.Zero(), scene);
    this.camera.minZ = 0.05;
    this.camera.maxZ = 200;
    this.camera.fov = 1.2; // ~69° vertical; amplo o bastante para tela larga
    this.camera.inputs.clear(); // a câmera é dirigida pela simulação

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.35, 0.35, 0.38);
    const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.3), scene);
    sun.intensity = 0.55;

    this.buildLevel(level);
    this.buildViewModel();
  }

  private buildLevel(level: LevelData): void {
    // Agrupa blocos por tipo e funde em uma malha por tipo: ~7 draw calls
    // para o cenário inteiro, em vez de um por bloco.
    const byKind = new Map<BlockKind, Mesh[]>();
    for (const [i, b] of level.blocks.entries()) {
      const mesh = CreateBox(`b${i}`, { width: b.size[0], height: b.size[1], depth: b.size[2] }, this.scene);
      mesh.position.set(...b.position);
      const [rx, ry, rz] = b.rotation ?? [0, 0, 0];
      const q = quatFromEuler(rx, ry, rz);
      mesh.rotationQuaternion = new Quaternion(q.x, q.y, q.z, q.w);
      const list = byKind.get(b.kind) ?? [];
      list.push(mesh);
      byKind.set(b.kind, list);
    }

    for (const [kind, meshes] of byKind) {
      const merged = Mesh.MergeMeshes(meshes, true, true);
      if (!merged) continue;
      merged.name = `level-${kind}`;
      merged.material = this.gridMaterial(kind);
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
    }
  }

  private gridMaterial(kind: BlockKind): GridMaterial {
    // Grade de 1 m em espaço de mundo: dá noção de escala no blockout
    const m = new GridMaterial(`mat-${kind}`, this.scene);
    const p = PALETTE[kind];
    m.mainColor = Color3.FromHexString(p.main);
    m.lineColor = Color3.FromHexString(p.line);
    m.gridRatio = 1;
    m.majorUnitFrequency = 4;
    m.minorUnitVisibility = 0.35;
    m.opacity = 0.99;
    m.backFaceCulling = true;
    m.freeze();
    return m;
  }

  private buildViewModel(): void {
    // Placeholder da arma em primeira pessoa. Grupo de render 1: desenha
    // por cima do cenário, então não atravessa paredes ao encostar.
    const mat = new StandardMaterial('vm-mat', this.scene);
    mat.diffuseColor = Color3.FromHexString('#2b2e33');
    mat.specularColor = new Color3(0.15, 0.15, 0.15);

    const body = CreateBox('vm-body', { width: 0.06, height: 0.08, depth: 0.32 }, this.scene);
    const grip = CreateBox('vm-grip', { width: 0.05, height: 0.12, depth: 0.06 }, this.scene);
    grip.position.set(0, -0.08, -0.08);
    grip.parent = body;
    for (const m of [body, grip]) {
      m.material = mat;
      m.renderingGroupId = 1;
      m.isPickable = false;
    }
    body.parent = this.camera;
    body.position.set(0.17, -0.16, 0.36);
    this.scene.setRenderingAutoClearDepthStencil(1, true);
  }

  /** Atualiza câmera e desenha um frame. */
  render(eye: Vec3, yaw: number, pitch: number): void {
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.scene.render();
  }

  applyPixelRatio(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
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
