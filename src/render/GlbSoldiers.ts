// Soldados animados a partir de .glb (Quaternius Toon Shooter Game Kit, CC0;
// ver public/models/LICENSES.md). TR e CT recoloridos nas cores do HUD.
//
// Animações do pacote, escolhidas pelo estado do combatente:
//   morto → Death (uma vez) · agachado → Duck · andando → Walk(_Shoot)
//   correndo → Run_Gun / Run_Shoot · parado → Idle_Shoot (quase parado = pose de mira)
// "_Shoot" vale por 0,4 s depois de cada tiro. Troca de animação com mistura
// de 0,15 s (só duas animações ativas por soldado).
//
// O pacote é cartoon, de cabeça grande: a cabeça é reduzida para o desenho
// bater com a linha de headshot da cápsula de colisão.

import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { CombatantView, Team } from '../sim/Combatant';
import { BODY } from '../sim/config';
import type { EntityId } from '../sim/events';
import { approach, type Vec3 } from '../sim/math';
import { loadModel } from './art/Models';

const MODELS: Record<Team, { url: string; bodyHeight: number; recolor: Record<string, string> }> = {
  // TR: o vermelho do pacote vira o laranja-terra do HUD
  attack: { url: 'models/soldier_t.glb', bodyHeight: 2.1358, recolor: { enemy_red: '#a8582a' } },
  // CT: o verde vira azul-marinho; a calça amarela, cinza-azulado
  defense: { url: 'models/soldier_ct.glb', bodyHeight: 2.2699, recolor: { character_main: '#2c4f86', pants: '#3b4452' } },
};
const HEAD_SCALE = 0.78;
const BLEND_SECONDS = 0.15;
const SHOOT_POSE_SECONDS = 0.4;
const HIDDEN_GUNS = ['Pistol', 'SMG', 'Sniper'];

interface Soldier {
  team: Team;
  root: TransformNode;
  groups: Map<string, AnimationGroup>;
  current: AnimationGroup | null;
  currentName: string;
  previous: AnimationGroup | null;
  blend: number;
  head: TransformNode | null;
  /** Escala que nós escrevemos na cabeça no último quadro (ver `shrinkHeads`). */
  headWritten: Vector3 | null;
  gun: AbstractMesh | null;
  gunTip: Vector3;
  materials: StandardMaterial[];
  baseEmissive: Color3[];
  skeletons: Skeleton[];
  flash: Mesh;
  lastFeet: Vector3 | null;
  speed: number;
  hitFlash: number;
  muzzle: number;
  lastShot: number;
}

export class GlbSoldiers {
  private readonly containers = new Map<Team, AssetContainer>();
  private readonly soldiers = new Map<EntityId, Soldier>();
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly makeFlash: (id: EntityId) => Mesh,
    private readonly makeBlob: (id: EntityId, parent: TransformNode) => void,
  ) {
    scene.onAfterAnimationsObservable.add(() => this.shrinkHeads());
  }

  /** Carrega os dois modelos; rejeita se algum faltar (quem chama mantém os soldados de código). */
  async load(): Promise<void> {
    for (const team of ['attack', 'defense'] as const) {
      const m = MODELS[team];
      const c = await loadModel(this.scene, m.url, m.recolor, 0.06);
      this.containers.set(team, c);
    }
  }

  get ready(): boolean {
    return this.containers.size === 2;
  }

  private create(c: CombatantView): Soldier {
    const container = this.containers.get(c.team)!;
    const prefix = `${c.id}|`;
    const inst = container.instantiateModelsToScene((n) => prefix + n, true, { doNotInstantiate: true });

    const root = new TransformNode(`glb-${c.id}`, this.scene);
    const body = new TransformNode(`glb-body-${c.id}`, this.scene);
    body.parent = root;
    body.scaling.setAll(BODY.standHeight / MODELS[c.team].bodyHeight);
    for (const r of inst.rootNodes) r.parent = body;
    this.makeBlob(c.id, root);

    // Armas do pacote: só o fuzil fica visível. Nós com várias partes viram
    // "Nome" (nó) + "Nome_primitiveN" (malhas): casa pelo nome base.
    const baseName = (n: string) => n.slice(prefix.length).replace(/_primitive\d+$/, '');
    let gun: AbstractMesh | null = null;
    for (const n of root.getDescendants(false)) {
      const name = baseName(n.name);
      if (HIDDEN_GUNS.includes(name)) n.setEnabled(false);
      if (name === 'AK' && !gun && 'getTotalVertices' in n && (n as AbstractMesh).getTotalVertices() > 0) gun = n as AbstractMesh;
    }
    const meshes = root.getChildMeshes(false);
    for (const m of meshes) m.isPickable = false;
    // Ponta do cano: o fuzil do pacote corre ao longo do X local
    let gunTip = Vector3.Zero();
    if (gun) {
      const bb = gun.getBoundingInfo().boundingBox;
      gunTip = new Vector3(bb.maximum.x, bb.center.y, bb.center.z);
    }

    const materials = [...new Set(meshes.map((m) => m.material).filter((m): m is StandardMaterial => !!m && 'emissiveColor' in m))];
    const head = inst.skeletons[0]?.bones.find((b) => b.name === 'Head')?.getTransformNode() ?? null;

    const groups = new Map<string, AnimationGroup>();
    for (const g of inst.animationGroups) {
      g.stop();
      groups.set(g.name.slice(prefix.length), g);
    }

    const s: Soldier = {
      team: c.team,
      root,
      groups,
      current: null,
      currentName: '',
      previous: null,
      blend: 1,
      head,
      headWritten: null,
      gun,
      gunTip,
      materials,
      baseEmissive: materials.map((m) => m.emissiveColor.clone()),
      skeletons: inst.skeletons,
      flash: this.makeFlash(c.id),
      lastFeet: null,
      speed: 0,
      hitFlash: 0,
      muzzle: 0,
      lastShot: -99,
    };
    this.soldiers.set(c.id, s);
    return s;
  }

  private dispose(s: Soldier): void {
    for (const g of s.groups.values()) g.dispose();
    for (const k of s.skeletons) k.dispose();
    for (const m of s.materials) m.dispose();
    s.flash.dispose();
    s.root.dispose(false, false);
  }

  onShot(id: EntityId): void {
    const s = this.soldiers.get(id);
    if (!s) return;
    s.muzzle = 0.06;
    s.lastShot = this.time;
  }

  onHit(id: EntityId): void {
    const s = this.soldiers.get(id);
    if (s) s.hitFlash = 1;
  }

  update(dt: number, list: readonly CombatantView[], feetOf: (id: EntityId) => Vec3): void {
    this.time += dt;
    for (const c of list) {
      let s = this.soldiers.get(c.id);
      // Trocou de lado (intervalo): outro modelo
      if (s && s.team !== c.team) {
        this.dispose(s);
        this.soldiers.delete(c.id);
        s = undefined;
      }
      s ??= this.create(c);

      const f = feetOf(c.id);
      s.root.position.set(f.x, f.y, f.z);
      s.root.rotation.y = c.yaw;
      if (s.lastFeet && dt > 0) {
        const d = Math.hypot(f.x - s.lastFeet.x, f.z - s.lastFeet.z);
        s.speed = approach(s.speed, c.alive && d < 2 ? d / dt : 0, dt * 30);
      }
      (s.lastFeet ??= new Vector3()).set(f.x, f.y, f.z);

      this.animate(s, c, dt);

      s.hitFlash = Math.max(0, s.hitFlash - dt * 8);
      s.materials.forEach((m, i) => {
        const b = s.baseEmissive[i];
        m.emissiveColor.set(b.r + s.hitFlash, b.g + s.hitFlash * 0.4, b.b + s.hitFlash * 0.4);
      });

      s.muzzle -= dt;
      const showFlash = c.alive && s.muzzle > 0 && !!s.gun;
      s.flash.isVisible = showFlash;
      if (showFlash) Vector3.TransformCoordinatesToRef(s.gunTip, s.gun!.getWorldMatrix(), s.flash.position);
    }
  }

  private animate(s: Soldier, c: CombatantView, dt: number): void {
    const shooting = this.time - s.lastShot < SHOOT_POSE_SECONDS;
    let want: string;
    let speedRatio = 1;
    if (!c.alive) want = 'Death';
    else if (c.crouching) want = 'Duck';
    else if (s.speed > 3.6) {
      want = shooting ? 'Run_Shoot' : 'Run_Gun';
      speedRatio = Math.min(1.4, Math.max(0.7, s.speed / 5));
    } else if (s.speed > 0.3) {
      want = shooting ? 'Walk_Shoot' : 'Walk';
      speedRatio = Math.min(1.5, Math.max(0.6, s.speed / 2.2));
    } else {
      // Parado: postura de mira (o "Idle" do pacote abaixa a arma). Sem tiro,
      // a animação de disparo roda quase parada e vira só a pose.
      want = 'Idle_Shoot';
      speedRatio = shooting ? 1 : 0.02;
    }

    if (want !== s.currentName) {
      const next = s.groups.get(want);
      if (next) {
        s.previous?.stop();
        // Renascer: sem mistura com a pose de morte
        const instant = s.currentName === 'Death' || !s.current;
        s.previous = instant ? null : s.current;
        if (instant) s.current?.stop();
        s.current = next;
        s.currentName = want;
        next.start(want !== 'Death', 1, next.from, next.to);
        s.blend = instant ? 1 : 0;
      }
    }
    if (s.current) s.current.speedRatio = speedRatio;

    if (s.blend < 1) {
      s.blend = Math.min(1, s.blend + dt / BLEND_SECONDS);
      s.current?.setWeightForAllAnimatables(s.blend);
      s.previous?.setWeightForAllAnimatables(1 - s.blend);
      if (s.blend >= 1) {
        s.previous?.stop();
        s.previous = null;
      }
    } else s.current?.setWeightForAllAnimatables(1);
  }

  /**
   * Reduz a cabeça depois que as animações escrevem a escala dos ossos. Se a
   * animação não reescreveu neste quadro (morte terminada), não reduz de novo.
   */
  private shrinkHeads(): void {
    for (const s of this.soldiers.values()) {
      const h = s.head;
      if (!h) continue;
      if (s.headWritten && h.scaling.equalsWithEpsilon(s.headWritten, 1e-6)) continue;
      h.scaling.scaleInPlace(HEAD_SCALE);
      s.headWritten = h.scaling.clone();
    }
  }
}
