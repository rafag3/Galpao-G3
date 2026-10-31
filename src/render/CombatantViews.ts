// Soldados procedurais: modelados por código em peças low-poly com uma
// textura-atlas por equipe e animados por articulações (quadril, joelhos,
// tronco, cabeça, braços+arma). Substituíveis por modelos .glb no futuro sem
// mudar a API usada pelo Game.
//
// Hierarquia (Y para cima, frente = +Z):
//   root (pés, yaw) → fall (tomba ao morrer) → hips (altura do quadril)
//     ├ torso (inclina) → torso mesh, aim (pitch: braços + fuzil), head (pitch)
//     └ coxa E/D → joelho E/D → canela + bota
//
// Custo: 8 draw calls por soldado (7 peças + sombra de contato), 1 material
// próprio; atlas e sombra compartilhados.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3, type Vector4 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { CombatantView, Team } from '../sim/Combatant';
import type { EntityId } from '../sim/events';
import { approach, type Vec3 } from '../sim/math';
import { buildAtlas, cellUV, type AtlasCell } from './art/SoldierAtlas';

/** Medidas do corpo (m). Somadas batem com a cápsula da simulação (1,8 m). */
const THIGH = 0.44;
const SHIN = 0.44;
const SOLE = 0.06;
const HIP_STAND = THIGH + SHIN + SOLE;
/** Ombros acima do quadril. */
const SHOULDER = 0.5;
/** Pescoço acima do quadril. */
const NECK = 0.6;
/** Pose agachada: coxa à frente, joelho dobrado, tronco inclinado. */
const CROUCH_THIGH = -1.25;
const CROUCH_KNEE = 2.3;
const CROUCH_LEAN = 0.35;
const CROUCH_HIP = THIGH * Math.cos(CROUCH_THIGH) + SHIN * Math.cos(CROUCH_THIGH + CROUCH_KNEE) + SOLE;
/** Velocidade de corrida da simulação, para normalizar a passada. */
const RUN_SPEED = 6.4;
/** Ponta do cano no espaço do nó `aim`. */
const MUZZLE = new Vector3(0.1, -0.04, 0.86);

type V3 = [number, number, number];

interface View {
  root: TransformNode;
  fall: TransformNode;
  hips: TransformNode;
  torso: TransformNode;
  aim: TransformNode;
  head: TransformNode;
  thighs: [TransformNode, TransformNode];
  knees: [TransformNode, TransformNode];
  material: StandardMaterial;
  flash: Mesh;
  lastFeet: Vector3 | null;
  speed: number;
  phase: number;
  crouch: number;
  hitFlash: number;
  muzzle: number;
  fallAngle: number;
}

/** Monta peças (caixas texturizadas pelo atlas) e as funde em uma malha. */
class PartBuilder {
  private readonly parts: Mesh[] = [];
  constructor(private readonly scene: Scene) {}

  box(size: V3, pos: V3, cell: AtlasCell, rot: V3 = [0, 0, 0]): this {
    const uv = cellUV(cell);
    const faceUV: Vector4[] = [uv, uv, uv, uv, uv, uv];
    const m = CreateBox('sp', { width: size[0], height: size[1], depth: size[2], faceUV }, this.scene);
    m.position.set(...pos);
    m.rotation.set(...rot);
    this.parts.push(m);
    return this;
  }

  /** Caixa alongada ligando dois pontos (braços). */
  limb(a: V3, b: V3, thick: number, cell: AtlasCell): this {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    // Caixa ao longo de +Z: pitch positivo aponta para baixo (mão esquerda do Babylon)
    return this.box([thick, thick, len], mid, cell, [Math.asin(-d[1] / len), Math.atan2(d[0], d[2]), 0]);
  }

  build(name: string, parent: TransformNode, material: StandardMaterial): Mesh {
    const mesh = Mesh.MergeMeshes(this.parts, true)!;
    mesh.name = name;
    mesh.parent = parent;
    mesh.material = material;
    mesh.isPickable = false;
    // O corpo não usa normal map nem sombras dinâmicas: barato no celular
    mesh.freezeNormals();
    return mesh;
  }
}

export class CombatantViews {
  private readonly views = new Map<EntityId, View>();
  private readonly atlas = new Map<Team, DynamicTexture>();
  private flashMat: StandardMaterial | null = null;
  private blobMat: StandardMaterial | null = null;

  constructor(private readonly scene: Scene) {}

  private atlasFor(team: Team): DynamicTexture {
    let t = this.atlas.get(team);
    if (!t) {
      t = buildAtlas(this.scene, team);
      this.atlas.set(team, t);
    }
    return t;
  }

  private create(c: CombatantView): View {
    const scene = this.scene;
    const node = (name: string, parent: TransformNode, pos: V3 = [0, 0, 0]) => {
      const n = new TransformNode(`${name}-${c.id}`, scene);
      n.parent = parent;
      n.position.set(...pos);
      return n;
    };
    const P = () => new PartBuilder(scene);
    const attack = c.team === 'attack';

    // Material próprio por soldado (o clarão de dano é por soldado); a
    // textura é compartilhada pela equipe.
    const material = new StandardMaterial(`sold-mat-${c.id}`, scene);
    material.diffuseTexture = this.atlasFor(c.team);
    material.specularColor = new Color3(0.06, 0.06, 0.06);
    material.emissiveColor = new Color3(0, 0, 0);

    const root = new TransformNode(`sold-${c.id}`, scene);
    const fall = node('sold-fall', root);
    const hips = node('sold-hips', fall, [0, HIP_STAND, 0]);
    const torso = node('sold-torso', hips);

    // Tronco: quadril, peito, colete com bolsos, mochila (ataque) ou rádio (defesa)
    const t = P()
      .box([0.36, 0.22, 0.22], [0, 0.02, 0], 'uniform')
      .box([0.4, 0.42, 0.24], [0, 0.32, 0], 'uniform')
      .box([0.44, 0.36, 0.3], [0, 0.32, 0.01], 'vest')
      .box([0.1, 0.12, 0.06], [-0.12, 0.2, 0.18], 'vest')
      .box([0.1, 0.12, 0.06], [0, 0.2, 0.18], 'vest')
      .box([0.1, 0.12, 0.06], [0.12, 0.2, 0.18], 'vest')
      .box([0.12, 0.14, 0.22], [0, 0.56, 0], 'uniform') // pescoço/gola
      .box([0.4, 0.05, 0.25], [0, -0.05, 0], 'gear'); // cinto
    if (attack) t.box([0.34, 0.42, 0.18], [0, 0.34, -0.23], 'pack').box([0.3, 0.1, 0.16], [0, 0.58, -0.22], 'pack');
    else t.box([0.1, 0.2, 0.08], [-0.12, 0.38, -0.19], 'gear').box([0.015, 0.25, 0.015], [-0.14, 0.6, -0.19], 'gear');
    t.build(`sold-torso-${c.id}`, torso, material);

    // Cabeça: balaclava; defesa com capacete e óculos âmbar, ataque com capuz e boné
    const head = node('sold-head', torso, [0, NECK, 0]);
    const h = P().box([0.21, 0.25, 0.23], [0, 0.13, 0.01], 'mask');
    if (attack) {
      h.box([0.27, 0.26, 0.24], [0, 0.15, -0.04], 'pack') // capuz
        .box([0.23, 0.07, 0.25], [0, 0.27, 0.01], 'vest') // boné
        .box([0.21, 0.025, 0.12], [0, 0.245, 0.16], 'vest') // aba
        .box([0.19, 0.05, 0.03], [0, 0.17, 0.125], 'lens');
    } else {
      h.box([0.27, 0.13, 0.29], [0, 0.26, 0], 'gear') // capacete
        .box([0.29, 0.04, 0.31], [0, 0.2, 0], 'gear') // aba do capacete
        .box([0.2, 0.06, 0.04], [0, 0.17, 0.13], 'lens')
        .box([0.04, 0.05, 0.06], [0, 0.32, 0.12], 'gear'); // suporte de visão noturna
    }
    h.build(`sold-head-${c.id}`, head, material);

    // Braços + fuzil seguem a mira (pitch)
    const aim = node('sold-aim', torso, [0, SHOULDER, 0]);
    const R_SH: V3 = [0.21, 0, 0];
    const R_EL: V3 = [0.2, -0.22, 0.12];
    const R_HD: V3 = [0.11, -0.1, 0.3];
    const L_SH: V3 = [-0.21, 0, 0];
    const L_EL: V3 = [-0.15, -0.2, 0.24];
    const L_HD: V3 = [0.08, -0.07, 0.52];
    P()
      .box([0.13, 0.12, 0.13], [0.21, -0.02, 0], 'uniform') // ombros
      .box([0.13, 0.12, 0.13], [-0.21, -0.02, 0], 'uniform')
      .limb(R_SH, R_EL, 0.1, 'uniform')
      .limb(R_EL, R_HD, 0.09, 'uniform')
      .limb(L_SH, L_EL, 0.1, 'uniform')
      .limb(L_EL, L_HD, 0.09, 'uniform')
      .box([0.08, 0.09, 0.09], R_HD, 'gear') // luvas
      .box([0.08, 0.09, 0.09], L_HD, 'gear')
      // Fuzil
      .box([0.055, 0.1, 0.42], [0.1, -0.06, 0.4], 'gun') // corpo
      .box([0.03, 0.03, 0.26], [0.1, -0.04, 0.73], 'gun') // cano
      .box([0.05, 0.08, 0.26], [0.13, -0.07, 0.07], 'gun') // coronha
      .box([0.045, 0.16, 0.07], [0.1, -0.18, 0.42], 'gun', [0.25, 0, 0]) // carregador
      .box([0.04, 0.05, 0.1], [0.1, 0.02, 0.36], 'gun') // mira
      .build(`sold-aim-${c.id}`, aim, material);

    // Pernas: coxa pendurada no quadril, canela no joelho
    const thighs: TransformNode[] = [];
    const knees: TransformNode[] = [];
    for (const side of [-1, 1]) {
      const thigh = node('sold-thigh', hips, [side * 0.1, 0, 0]);
      P()
        .box([0.15, THIGH, 0.17], [0, -THIGH / 2, 0], 'uniform')
        .box([0.06, 0.12, 0.12], [side * 0.08, -THIGH * 0.45, 0], attack ? 'uniform' : 'vest') // bolso lateral
        .build(`sold-thigh-${c.id}`, thigh, material);
      const knee = node('sold-knee', thigh, [0, -THIGH, 0]);
      P()
        .box([0.13, SHIN, 0.14], [0, -SHIN / 2, 0], 'uniform')
        .box([0.15, 0.12, 0.06], [0, -0.05, 0.08], 'gear') // joelheira
        .box([0.14, 0.14, 0.17], [0, -SHIN + 0.04, 0.01], 'boots') // cano da bota
        .box([0.14, SOLE, 0.26], [0, -SHIN - SOLE / 2, 0.05], 'boots') // sola
        .build(`sold-shin-${c.id}`, knee, material);
      thighs.push(thigh);
      knees.push(knee);
    }

    // Clarão do tiro na ponta do cano
    if (!this.flashMat) {
      this.flashMat = new StandardMaterial('sold-flash', scene);
      this.flashMat.emissiveColor = Color3.FromHexString('#ffd27a');
      this.flashMat.disableLighting = true;
    }
    const flash = CreateBox(`sold-flash-${c.id}`, { size: 0.16 }, scene);
    flash.material = this.flashMat;
    flash.parent = aim;
    flash.position.copyFrom(MUZZLE);
    flash.rotation.z = Math.PI / 4;
    flash.isPickable = false;
    flash.isVisible = false;

    // Sombra de contato: as sombras do sol são estáticas (desenhadas uma vez),
    // então um disco escuro sob os pés "assenta" o soldado no chão.
    const blob = CreateGround(`sold-blob-${c.id}`, { width: 1.1, height: 1.1 }, scene);
    blob.parent = root;
    blob.position.y = 0.015;
    blob.material = this.blobMaterial();
    blob.isPickable = false;

    const v: View = {
      root,
      fall,
      hips,
      torso,
      aim,
      head,
      thighs: thighs as [TransformNode, TransformNode],
      knees: knees as [TransformNode, TransformNode],
      material,
      flash,
      lastFeet: null,
      speed: 0,
      phase: 0,
      crouch: 0,
      hitFlash: 0,
      muzzle: 0,
      fallAngle: 0,
    };
    this.views.set(c.id, v);
    return v;
  }

  private blobMaterial(): StandardMaterial {
    if (this.blobMat) return this.blobMat;
    const tex = new DynamicTexture('sold-blob-tex', 64, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    tex.hasAlpha = true;
    const m = new StandardMaterial('sold-blob', this.scene);
    m.diffuseColor = new Color3(0, 0, 0);
    m.specularColor = new Color3(0, 0, 0);
    m.disableLighting = true;
    m.opacityTexture = tex;
    m.opacityTexture.getAlphaFromRGB = false;
    m.zOffset = -2;
    this.blobMat = m;
    return m;
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

      // Velocidade horizontal a partir do deslocamento entre quadros; um salto
      // grande (teleporte, nova rodada) não conta como passada.
      if (v.lastFeet && dt > 0) {
        const d = Math.hypot(f.x - v.lastFeet.x, f.z - v.lastFeet.z);
        const s = d > 2 ? 0 : d / dt;
        v.speed = approach(v.speed, c.alive ? s : 0, dt * 30);
      }
      (v.lastFeet ??= new Vector3()).set(f.x, f.y, f.z);

      this.animate(v, c, dt);

      // Tomba para trás ao morrer; volta instantâneo ao renascer
      v.fallAngle = c.alive ? 0 : approach(v.fallAngle, Math.PI / 2, dt * 5);
      v.fall.rotation.x = -v.fallAngle;

      v.hitFlash = Math.max(0, v.hitFlash - dt * 8);
      v.material.emissiveColor.set(v.hitFlash, v.hitFlash * 0.4, v.hitFlash * 0.4);
      v.muzzle -= dt;
      v.flash.isVisible = c.alive && v.muzzle > 0;
    }
  }

  private animate(v: View, c: CombatantView, dt: number): void {
    v.crouch = approach(v.crouch, c.crouching ? 1 : 0, dt * 6);
    const k = v.crouch;

    // Passada: frequência e amplitude crescem com a velocidade
    const run = Math.min(v.speed / RUN_SPEED, 1);
    const moving = v.speed > 0.3 ? 1 : 0;
    v.phase += dt * (5 + 6 * run) * moving;
    const amp = moving * (0.25 + 0.45 * run) * (1 - 0.6 * k);

    const crouchThigh = CROUCH_THIGH * k;
    const crouchKnee = CROUCH_KNEE * k;
    for (let i = 0; i < 2; i++) {
      const p = v.phase + i * Math.PI;
      const swing = Math.sin(p) * amp;
      // Joelho dobra na fase de recuperação (perna indo à frente)
      const bend = Math.max(0, Math.cos(p)) * amp * 1.6;
      v.thighs[i].rotation.x = crouchThigh - swing;
      v.knees[i].rotation.x = crouchKnee + bend;
    }

    // Quadril desce ao agachar e quica levemente ao andar
    const bob = moving * Math.abs(Math.sin(v.phase)) * 0.03 * (0.5 + run);
    v.hips.position.y = HIP_STAND + (CROUCH_HIP - HIP_STAND) * k - bob;

    // Tronco inclina ao agachar e ao correr; a mira compensa para manter a arma no alvo
    const lean = CROUCH_LEAN * k + 0.12 * run * moving;
    v.torso.rotation.x = lean;
    v.torso.rotation.y = Math.sin(v.phase) * 0.06 * amp;
    v.aim.rotation.x = c.pitch - lean;
    v.head.rotation.x = c.pitch * 0.6 - lean * 0.7;
  }
}
