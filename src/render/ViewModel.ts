// Arma em primeira pessoa: fuzil original montado em partes, mãos e mangas
// do uniforme, recarga animada por etapas, cápsulas ejetadas e clarão.
//
// Fica no grupo de render 1 (desenhado por cima do cenário): não atravessa
// paredes ao encostar. As peças estáticas são fundidas por material:
// ~8 draw calls para arma + mãos.

import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Team } from '../sim/Combatant';
import type { WeaponState } from '../sim/WeaponController';
import type { TexturePair } from './art/ProceduralTextures';
import * as W from './art/WeaponTextures';

/** Camada exclusiva da arma: desenhada só pela câmera da arma. */
export const VIEWMODEL_LAYER = 0x10000000;

/** Posição da arma em relação à câmera (direita, abaixo, à frente). */
const BASE = new Vector3(0.16, -0.12, 0.24);
/** Leve giro para dentro e para cima: o cano aponta para perto da mira. */
const BASE_YAW = -0.09;
const BASE_PITCH = 0.01;
const MAG_POS = new Vector3(0, -0.085, 0.075);
const LEFT_HAND_POS = new Vector3(-0.005, -0.045, 0.3);
const MUZZLE_Z = 0.66;

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

interface Shell {
  mesh: Mesh;
  vel: Vector3;
  life: number;
}

type Part = [w: number, h: number, d: number, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number];

export class ViewModel {
  private readonly root: TransformNode;
  private readonly gun: TransformNode;
  private readonly mag: Mesh;
  private readonly leftHand: TransformNode;
  private readonly flash: Mesh;
  private readonly shells: Shell[] = [];
  private nextShell = 0;
  private kick = 0;
  private flashTimer = 0;
  private bobPhase = 0;
  private time = 0;

  constructor(private readonly scene: Scene, camera: FreeCamera, team: Team = 'attack') {
    this.root = new TransformNode('vm-root', scene);
    this.root.parent = camera;
    this.root.position.copyFrom(BASE);
    this.gun = new TransformNode('vm-gun', scene);
    this.gun.parent = this.root;

    const polymer = this.material('vm-polymer', W.polymer(), 0.08);
    const metal = this.material('vm-metal', W.parkerized(), 0.35);
    const rail = this.material('vm-rail', W.rail(), 0.3);
    const glove = this.material('vm-glove', W.glove(), 0.05);
    const sleeve = this.material('vm-sleeve', team === 'attack' ? W.sleeveAttack() : W.sleeveDefense(), 0.03);

    // ---- Fuzil (eixo +Z = cano). Medidas em metros.
    this.group(this.gun, polymer, [
      [0.052, 0.062, 0.25, 0, -0.012, 0.31], // guarda-mão
      [0.04, 0.1, 0.05, 0, -0.085, -0.075, -0.35], // empunhadura
      [0.042, 0.06, 0.17, 0, -0.012, -0.24], // coronha
      [0.046, 0.09, 0.03, 0, -0.02, -0.33], // soleira
      [0.03, 0.03, 0.08, 0, -0.045, -0.15, 0.25], // ligação coronha
    ]);
    this.group(this.gun, metal, [
      [0.056, 0.064, 0.24, 0, 0, 0.02], // caixa da culatra
      [0.05, 0.03, 0.1, 0, -0.045, 0.06], // poço do carregador
      [0.012, 0.012, 0.03, 0.03, 0.02, -0.05], // alavanca de manejo
      [0.006, 0.03, 0.05, 0, -0.06, -0.02], // guarda-mato
      [0.03, 0.032, 0.045, 0, 0.057, 0.045], // corpo da mira
      [0.016, 0.022, 0.03, 0, 0.042, 0.04], // base da mira
      [0.004, 0.026, 0.07, -0.03, 0.008, 0.05], // tampa da janela de ejeção (lado visível)
      [0.004, 0.014, 0.018, -0.03, -0.022, -0.04], // seletor de tiro
    ]);
    this.group(this.gun, rail, [
      [0.03, 0.012, 0.42, 0, 0.037, 0.18], // trilho superior
    ]);
    this.cylinders(this.gun, metal, [
      [0.017, 0.2, 0, 0, 0.53], // cano
      [0.028, 0.055, 0, 0, MUZZLE_Z - 0.03], // quebra-chamas
      [0.026, 0.03, 0, 0, 0.43], // bloco de gases
    ]);

    // Lente da mira: vidro escuro com ponto vermelho
    const lens = CreatePlane('vm-lens', { size: 0.024 }, scene);
    lens.position.set(0, 0.058, 0.0222);
    lens.rotation.y = Math.PI;
    lens.material = this.lensMaterial();
    this.attach(lens, this.gun);

    // Carregador (animado na recarga)
    this.mag = CreateBox('vm-mag', { width: 0.03, height: 0.13, depth: 0.065 }, scene);
    this.mag.material = metal;
    this.attach(this.mag, this.gun);

    // ---- Mão direita na empunhadura + antebraço (move com a arma)
    this.group(this.gun, glove, [
      [0.07, 0.085, 0.085, 0.012, -0.085, -0.075, -0.35], // mão
      [0.02, 0.02, 0.06, -0.018, -0.045, -0.02, 0, 0, 0.3], // dedo no gatilho
    ]);
    this.group(this.gun, sleeve, [this.forearm(new Vector3(0.015, -0.12, -0.11), new Vector3(0.09, -0.26, -0.42), 0.085)]);

    // ---- Mão esquerda no guarda-mão (vai buscar o carregador)
    this.leftHand = new TransformNode('vm-left', scene);
    this.leftHand.parent = this.gun;
    this.leftHand.position.copyFrom(LEFT_HAND_POS);
    this.group(this.leftHand, glove, [[0.085, 0.07, 0.11, 0, -0.01, 0]]);
    this.group(this.leftHand, sleeve, [this.forearm(new Vector3(-0.02, -0.04, -0.04), new Vector3(-0.22, -0.2, -0.3), 0.08)]);

    // ---- Clarão: três planos cruzados com textura em estrela, aditivos
    this.flash = this.buildFlash();
    this.attach(this.flash, this.gun);
    this.flash.position.set(0, 0, MUZZLE_Z + 0.06);
    this.flash.setEnabled(false);

    // ---- Cápsulas (pool reaproveitado)
    const brass = new StandardMaterial('vm-brass', scene);
    brass.diffuseColor = Color3.FromHexString('#c79a3c');
    brass.specularColor = new Color3(0.6, 0.5, 0.3);
    brass.emissiveColor = new Color3(0.15, 0.1, 0.03);
    for (let i = 0; i < 6; i++) {
      const m = CreateCylinder('vm-shell', { diameter: 0.008, height: 0.028, tessellation: 6 }, scene);
      m.material = brass;
      this.attach(m, this.root);
      m.setEnabled(false);
      this.shells.push({ mesh: m, vel: Vector3.Zero(), life: 0 });
    }
  }

  // ------------------------------------------------------------ construção

  private material(name: string, pair: TexturePair, specular: number): StandardMaterial {
    const tex = (n: string, c: HTMLCanvasElement) => {
      const t = new DynamicTexture(n, c, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
      t.update();
      return t;
    };
    const m = new StandardMaterial(name, this.scene);
    m.diffuseTexture = tex(`${name}-c`, pair.color);
    m.bumpTexture = tex(`${name}-n`, pair.normal);
    m.specularColor = new Color3(specular, specular, specular);
    m.specularPower = 48;
    // A arma não recebe sombra do cenário: um pouco de luz própria evita que fique preta
    m.emissiveColor = new Color3(0.06, 0.06, 0.07);
    return m;
  }

  private attach(m: Mesh, parent: TransformNode) {
    m.parent = parent;
    m.layerMask = VIEWMODEL_LAYER;
    m.renderingGroupId = 1;
    m.isPickable = false;
  }

  /** Funde várias caixas numa malha só (1 draw call) presa a `parent`. */
  private group(parent: TransformNode, mat: StandardMaterial, parts: Part[]): void {
    const meshes = parts.map(([w, h, d, x, y, z, rx = 0, ry = 0, rz = 0]) => {
      const b = CreateBox('p', { width: w, height: h, depth: d }, this.scene);
      b.position.set(x, y, z);
      b.rotation.set(rx, ry, rz);
      return b;
    });
    const merged = Mesh.MergeMeshes(meshes, true)!;
    merged.material = mat;
    this.attach(merged, parent);
  }

  /** Cilindros ao longo de +Z: [diâmetro, comprimento, x, y, z]. */
  private cylinders(parent: TransformNode, mat: StandardMaterial, parts: [number, number, number, number, number][]) {
    const meshes = parts.map(([dia, len, x, y, z]) => {
      const c = CreateCylinder('c', { diameter: dia, height: len, tessellation: 10 }, this.scene);
      c.rotation.x = Math.PI / 2;
      c.position.set(x, y, z);
      return c;
    });
    const merged = Mesh.MergeMeshes(meshes, true)!;
    merged.material = mat;
    this.attach(merged, parent);
  }

  /** Antebraço como caixa alongada entre dois pontos. */
  private forearm(from: Vector3, to: Vector3, thickness: number): Part {
    const d = to.subtract(from);
    const len = d.length();
    const mid = from.add(d.scale(0.5));
    const ry = Math.atan2(d.x, d.z);
    const rx = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    return [thickness, thickness, len, mid.x, mid.y, mid.z, rx, ry, 0];
  }

  private lensMaterial(): StandardMaterial {
    const t = new DynamicTexture('vm-lens-tex', { width: 64, height: 64 }, this.scene, false);
    const ctx = t.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#10161a';
    ctx.fillRect(0, 0, 64, 64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 6);
    g.addColorStop(0, '#ff5a4a');
    g.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    t.update();
    const m = new StandardMaterial('vm-lens', this.scene);
    m.emissiveTexture = t;
    m.diffuseColor = Color3.Black();
    m.specularColor = new Color3(0.5, 0.5, 0.5);
    m.disableLighting = true;
    return m;
  }

  private buildFlash(): Mesh {
    const t = new DynamicTexture('vm-flash-tex', { width: 128, height: 128 }, this.scene, true);
    const ctx = t.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    g.addColorStop(0, 'rgba(255,255,230,1)');
    g.addColorStop(0.25, 'rgba(255,200,90,0.9)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    // Estrela de 4 pontas: dois losangos cruzados
    ctx.beginPath();
    for (const [a, r] of [[0, 62], [Math.PI / 4, 18], [Math.PI / 2, 46], [(3 * Math.PI) / 4, 18], [Math.PI, 62], [(5 * Math.PI) / 4, 18], [(3 * Math.PI) / 2, 46], [(7 * Math.PI) / 4, 18]] as const)
      ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    ctx.closePath();
    ctx.fill();
    t.hasAlpha = true;
    t.update();

    const m = new StandardMaterial('vm-flash', this.scene);
    m.emissiveTexture = t;
    m.opacityTexture = t;
    m.diffuseColor = Color3.Black();
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.alphaMode = Constants.ALPHA_ADD;

    const planes = [0, Math.PI / 2].map((ry) => {
      const p = CreatePlane('f', { width: 0.07, height: 0.16 }, this.scene);
      p.rotation.set(Math.PI / 2, ry, 0); // planos ao longo do cano
      return p;
    });
    const front = CreatePlane('f', { size: 0.12 }, this.scene); // virado para a câmera
    const merged = Mesh.MergeMeshes([...planes, front], true)!;
    merged.material = m;
    return merged;
  }

  // ------------------------------------------------------------------ uso

  setVisible(v: boolean): void {
    this.root.setEnabled(v);
  }

  onShot(): void {
    this.kick = 1;
    this.flashTimer = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scaling.setAll(0.75 + Math.random() * 0.5);

    // Cápsula sai pela direita, para cima e um pouco para trás
    const s = this.shells[this.nextShell];
    this.nextShell = (this.nextShell + 1) % this.shells.length;
    s.mesh.setEnabled(true);
    s.mesh.position.set(0.035, 0.02, 0.06);
    s.mesh.rotation.set(Math.random(), Math.random(), Math.PI / 2);
    s.vel.set(1.1 + Math.random() * 0.4, 0.9 + Math.random() * 0.4, -0.2 - Math.random() * 0.3);
    s.life = 0.7;
  }

  /** @param speedNorm velocidade horizontal / velocidade de corrida (0..1) */
  update(dt: number, weapon: WeaponState, speedNorm: number, grounded: boolean): void {
    this.time += dt;
    this.kick *= Math.exp(-dt * 16);
    this.flashTimer -= dt;
    this.flash.setEnabled(this.flashTimer > 0);

    // Balanço ao andar + respiração parado
    if (grounded) this.bobPhase += dt * (6 + 6 * speedNorm) * Math.min(1, speedNorm * 3);
    const bob = grounded ? speedNorm : 0;
    const breathe = Math.sin(this.time * 1.6) * 0.0025;
    this.root.position.set(
      BASE.x + Math.sin(this.bobPhase) * 0.012 * bob,
      BASE.y - Math.abs(Math.cos(this.bobPhase)) * 0.01 * bob + breathe,
      BASE.z - 0.04 * this.kick,
    );
    this.root.rotation.set(BASE_PITCH - 0.08 * this.kick, BASE_YAW + Math.sin(this.bobPhase) * 0.01 * bob, 0);

    this.animateReload(weapon.reloading ? weapon.reloadProgress : 0);

    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 4 * dt;
      s.mesh.position.addInPlace(s.vel.scale(dt));
      s.mesh.rotation.x += dt * 20;
      if (s.life <= 0) s.mesh.setEnabled(false);
    }
  }

  /**
   * Recarga em etapas (p de 0 a 1):
   * inclina → solta o pente → mão busca outro → encaixa → volta.
   */
  private animateReload(p: number): void {
    const tilt = smooth(0, 0.14, p) * (1 - smooth(0.82, 1, p));
    const drop = smooth(0.12, 0.3, p);
    const bring = smooth(0.36, 0.6, p);
    const seat = smooth(0.6, 0.7, p);
    const jolt = p > 0.7 && p < 0.78 ? Math.sin(((p - 0.7) / 0.08) * Math.PI) : 0;

    this.gun.rotation.set(0.12 * tilt - 0.04 * jolt, -0.1 * tilt, 0.32 * tilt);
    this.gun.position.set(-0.02 * tilt, 0.01 * tilt, 0);

    // Pente velho cai; o novo sobe de baixo até quase encaixar e então trava
    const off = p === 0 ? 0 : p < 0.33 ? -0.4 * drop : -0.3 * (1 - bring) - 0.035 * (1 - seat);
    this.mag.position.set(MAG_POS.x, MAG_POS.y + off, MAG_POS.z);
    this.mag.rotation.x = 0.1 + (p < 0.33 ? 0.5 * drop : 0.3 * (1 - bring));
    this.mag.setEnabled(!(p > 0.3 && p < 0.38)); // troca de pente fora da tela

    // Mão esquerda acompanha o pente entre soltar e encaixar
    const reach = smooth(0.1, 0.22, p) * (1 - smooth(0.7, 0.84, p));
    const target = new Vector3(MAG_POS.x - 0.01, this.mag.position.y - 0.05, MAG_POS.z - 0.01);
    Vector3.LerpToRef(LEFT_HAND_POS, target, reach, this.leftHand.position);
    this.leftHand.rotation.set(0.6 * reach, 0, 0.4 * reach);
  }
}
