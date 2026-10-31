// Cérebro de um bot. Lê o mundo (visão por raycast, tiros ouvidos, informação
// da equipe) e produz o MESMO MoveIntent que o input do jogador produz.
//
// O "o quê" vem de fora: o comandante da equipe define um Objective (ir ao
// posto, ao site, plantar, desarmar, proteger a bomba). O cérebro decide o
// "como": caminhar, vigiar, perseguir, combater.
//
// Estados:
//   toGoal  → caminha até o ponto do objetivo
//   hold    → no ponto: vigia (varrendo o olhar) ou executa a ação (plantar/desarmar)
//   chase   → vai à última posição conhecida do inimigo
//   combat  → inimigo visível: mira com tempo de reação e erro, atira em rajadas

import { emptyIntent, type MoveIntent } from '../../input/InputIntents';
import type { BotPost } from '../../level/LevelData';
import type { Combatant } from '../Combatant';
import { BOT } from '../config';
import type { EntityId } from '../events';
import type { HitRegistry } from '../HitRegistry';
import { clamp, lerp, type Vec3 } from '../math';
import { NavGrid, type Point2 } from '../nav/NavGrid';
import { PhysicsWorld, RAPIER } from '../PhysicsWorld';
import type { Rng } from '../rng';

export type BotState = 'toGoal' | 'hold' | 'chase' | 'combat';

export interface Objective {
  point: Point2;
  /** Direção a vigiar ao chegar. */
  watchYaw: number;
  /** Ao chegar, segura o botão de ação (plantar/desarmar). */
  use?: boolean;
  /** Pode largar o objetivo para apoiar um colega (padrão: sim, se não for `use`). */
  canRespond?: boolean;
}

export const objectiveFromPost = (post: BotPost): Objective => ({
  point: { x: post.position[0], z: post.position[1] },
  watchYaw: post.watchYaw,
});

/** Informação compartilhada pela equipe (comportamento simples de equipe). */
export interface TeamMemory {
  lastKnown: Vec3 | null;
  at: number;
  spotter: EntityId | null;
  /** Bot designado para ir apoiar; os demais seguram seus postos. */
  responder: EntityId | null;
}

export interface Noise {
  origin: Vec3;
  source: EntityId;
}

export interface BotContext {
  time: number;
  dt: number;
  self: Combatant;
  enemies: readonly Combatant[];
  physics: PhysicsWorld;
  hits: HitRegistry;
  nav: NavGrid;
  team: TeamMemory;
  noises: readonly Noise[];
  rng: Rng;
}

const wrap = (a: number) => {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
};
const dist2 = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.z - b.z);

export class BotBrain {
  state: BotState = 'toGoal';
  /** Visão atual do bot (o que vai no intent). */
  yaw = 0;
  pitch = 0;

  private path: Point2[] = [];
  private pathGoal: Point2 | null = null;
  private repathAt = 0;

  private visionTimer: number;
  private target: Combatant | null = null;
  private aimPoint: Vec3 | null = null;
  private visible = false;
  private firstSeenAt = 0;
  private lastKnown: Vec3 | null = null;
  private chaseUntil = 0;
  private lookAroundUntil = 0;

  private aimNoiseYaw = 0;
  private aimNoisePitch = 0;
  private firing = false;
  private phaseUntil = 0;
  private strafe = 0;

  private stuckCheckAt = 0;
  private stuckFrom: Point2 = { x: 0, z: 0 };
  private wantJump = false;
  private readonly sweepPhase: number;

  constructor(
    public objective: Objective,
    index: number,
  ) {
    this.visionTimer = index * 0.05; // escalona os raycasts entre bots
    this.sweepPhase = index * 2.1;
  }

  /** Troca o objetivo; ignora mudanças pequenas para não ficar recalculando. */
  setObjective(o: Objective): void {
    const cur = this.objective;
    const changed = dist2(cur.point, o.point) > 1 || !!cur.use !== !!o.use;
    this.objective = o;
    if (!changed) return;
    if (this.state === 'hold' || (o.use && this.state === 'chase')) this.state = 'toGoal';
  }

  /** Chamado ao (re)nascer. */
  reset(yaw: number): void {
    this.state = 'toGoal';
    this.yaw = yaw;
    this.pitch = 0;
    this.path = [];
    this.pathGoal = null;
    this.visible = false;
    this.target = null;
    this.lastKnown = null;
    this.firing = false;
  }

  /** Para testes e diagnóstico. */
  get canSeeEnemy(): boolean {
    return this.visible;
  }

  think(ctx: BotContext): MoveIntent {
    this.perceive(ctx);
    this.decide(ctx);
    return this.act(ctx);
  }

  // ---------------------------------------------------------------- percepção

  private perceive(ctx: BotContext): void {
    const { time, dt, team, self } = ctx;
    this.visionTimer -= dt;

    if (this.visionTimer <= 0) {
      this.visionTimer = BOT.visionInterval;
      const wasVisible = this.visible;
      this.visible = false;
      let bestD = Infinity;
      for (const e of ctx.enemies) {
        if (!e.alive) continue;
        const seen = this.lineOfSight(ctx, e);
        if (!seen) continue;
        const d = Math.hypot(e.controller.state.feet.x - self.controller.state.feet.x, e.controller.state.feet.z - self.controller.state.feet.z);
        if (d < bestD) {
          bestD = d;
          this.visible = true;
          this.target = e;
          this.aimPoint = seen;
        }
      }
      if (this.visible && this.target) {
        if (!wasVisible) {
          this.firstSeenAt = time;
          this.aimNoiseYaw = (ctx.rng.next() * 2 - 1) * BOT.aimErrorStart;
          this.aimNoisePitch = (ctx.rng.next() * 2 - 1) * BOT.aimErrorStart * 0.5;
        }
        this.lastKnown = { ...this.target.controller.state.feet };
        team.lastKnown = this.lastKnown;
        team.at = time;
        team.spotter = self.id;
      }
    } else if (this.visible && this.target?.alive) {
      // Entre checagens, segue o alvo que já está visível
      const t = this.target.controller;
      this.aimPoint = { x: t.state.feet.x, y: this.aimPoint && this.aimPoint.y > t.chestY() + 0.2 ? t.headLineY() + 0.12 : t.chestY(), z: t.state.feet.z };
      this.lastKnown = { ...t.state.feet };
    }
    if (this.target && !this.target.alive) this.visible = false;

    // Audição: tiro inimigo por perto revela a posição
    if (!this.visible) {
      for (const n of ctx.noises) {
        const enemy = ctx.enemies.some((e) => e.id === n.source);
        const feet = self.controller.state.feet;
        if (enemy && Math.hypot(n.origin.x - feet.x, n.origin.z - feet.z) < BOT.hearingDistance) {
          this.lastKnown = { x: n.origin.x, y: 0, z: n.origin.z };
          team.lastKnown = this.lastKnown;
          team.at = time;
          team.spotter = self.id;
          this.startChase(time);
        }
      }
    }
  }

  /** Retorna o ponto visível do inimigo (peito ou cabeça), ou null. */
  private lineOfSight(ctx: BotContext, enemy: Combatant): Vec3 | null {
    const me = ctx.self.controller;
    const eye = me.eyePosition();
    const ef = enemy.controller.state.feet;
    const dx = ef.x - eye.x;
    const dz = ef.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d > BOT.viewDistance) return null;
    const off = Math.abs(wrap(Math.atan2(dx, dz) - this.yaw));
    if (off > BOT.halfFov && d > BOT.proximitySense) return null;

    for (const y of [enemy.controller.chestY(), enemy.controller.headLineY() + 0.12]) {
      const p = { x: ef.x, y, z: ef.z };
      const v = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
      const len = Math.hypot(v.x, v.y, v.z);
      const dir = { x: v.x / len, y: v.y / len, z: v.z / len };
      const hit = ctx.physics.world.castRay(new RAPIER.Ray(eye, dir), len + 0.5, true, undefined, undefined, me.collider);
      if (hit && ctx.hits.ownerOf(hit.collider) === enemy.id) return p;
    }
    return null;
  }

  // ------------------------------------------------------------------ decisão

  private startChase(time: number) {
    if (this.state !== 'combat') this.state = 'chase';
    this.chaseUntil = time + BOT.chaseSeconds;
    this.lookAroundUntil = 0;
  }

  private decide(ctx: BotContext): void {
    const { time, team, self } = ctx;
    const feet = self.controller.state.feet;

    if (this.visible) {
      this.state = 'combat';
      return;
    }
    if (this.state === 'combat') {
      this.startChase(time); // perdeu de vista: vai atrás
      this.state = 'chase';
    }

    // Apoio de equipe: só o bot designado larga o objetivo
    const canRespond = this.objective.canRespond ?? !this.objective.use;
    if (
      canRespond &&
      (this.state === 'hold' || this.state === 'toGoal') &&
      team.responder === self.id &&
      team.lastKnown &&
      time - team.at < BOT.teamInfoSeconds
    ) {
      this.lastKnown = team.lastKnown;
      this.startChase(time);
    }

    if (this.state === 'chase') {
      const arrived = this.lastKnown && dist2(feet, this.lastKnown) < 1.5;
      if (arrived && !this.lookAroundUntil) this.lookAroundUntil = time + 2;
      if (time > this.chaseUntil || (this.lookAroundUntil && time > this.lookAroundUntil)) {
        this.state = 'toGoal';
        this.lastKnown = null;
        if (team.responder === self.id) team.responder = null;
      }
    }

    if (this.state === 'toGoal' && dist2(feet, this.objective.point) < BOT.arriveRadius) this.state = 'hold';
    // Empurrado para fora do ponto (ou ponto mudou de lugar): volta
    if (this.state === 'hold' && dist2(feet, this.objective.point) > BOT.arriveRadius * 3) this.state = 'toGoal';
  }

  // ------------------------------------------------------------------- ação

  private act(ctx: BotContext): MoveIntent {
    const { time, dt, self } = ctx;
    const intent = emptyIntent(this.yaw, this.pitch);
    const weapon = self.weapon.state;
    let desiredYaw = this.yaw;
    let desiredPitch = 0;

    switch (this.state) {
      case 'combat': {
        const eye = self.controller.eyePosition();
        const p = this.aimPoint!;
        const dx = p.x - eye.x;
        const dz = p.z - eye.z;
        desiredYaw = Math.atan2(dx, dz);
        desiredPitch = Math.atan2(eye.y - p.y, Math.hypot(dx, dz));

        // Erro de mira: começa grande e assenta enquanto rastreia o alvo
        const settle = clamp((time - this.firstSeenAt) / BOT.aimSettleSeconds, 0, 1);
        const err = lerp(BOT.aimErrorStart, BOT.aimErrorEnd, settle);
        this.aimNoiseYaw = clamp(this.aimNoiseYaw + (ctx.rng.next() - 0.5) * err * 4 * dt, -err, err);
        this.aimNoisePitch = clamp(this.aimNoisePitch + (ctx.rng.next() - 0.5) * err * 2 * dt, -err * 0.5, err * 0.5);
        this.aimNoiseYaw *= 1 - (1 - err / BOT.aimErrorStart) * dt * 2;
        this.aimNoisePitch *= 1 - (1 - err / BOT.aimErrorStart) * dt * 2;
        desiredYaw += this.aimNoiseYaw;
        desiredPitch += this.aimNoisePitch;

        // Alterna rajada (parado, preciso) e pausa (se movendo de lado)
        if (time >= this.phaseUntil) {
          this.firing = !this.firing;
          const [a, b] = this.firing ? BOT.burstSeconds : BOT.pauseSeconds;
          this.phaseUntil = time + a + ctx.rng.next() * (b - a);
          if (!this.firing) this.strafe = ctx.rng.next() < 0.5 ? -1 : 1;
        }
        const reacted = time - this.firstSeenAt >= BOT.reactionSeconds;
        const onTarget =
          Math.abs(wrap(desiredYaw - this.yaw)) < BOT.fireCone && Math.abs(desiredPitch - this.pitch) < BOT.fireCone;
        if (weapon.mag === 0) {
          intent.reload = true;
          intent.moveX = this.strafe || 1;
        } else if (this.firing) {
          intent.fire = reacted && onTarget;
        } else {
          intent.moveX = this.strafe;
        }
        break;
      }
      case 'chase':
      case 'toGoal': {
        const goal =
          this.state === 'chase' && this.lastKnown ? { x: this.lastKnown.x, z: this.lastKnown.z } : this.objective.point;
        const dir = this.follow(ctx, goal);
        if (dir) {
          desiredYaw = Math.atan2(dir.x, dir.z);
          this.toLocal(intent, dir);
          intent.run = true;
        } else if (this.state === 'chase') {
          desiredYaw = this.yaw + dt * 2; // chegou: olha em volta
        }
        if (!this.visible && weapon.mag < weapon.def.magSize * 0.4) intent.reload = true;
        break;
      }
      case 'hold': {
        if (this.objective.use) {
          // Plantando/desarmando: parado, segurando a ação
          intent.use = true;
          desiredYaw = this.objective.watchYaw;
        } else {
          desiredYaw = this.objective.watchYaw + Math.sin(time * 0.6 + this.sweepPhase) * 0.55;
          if (weapon.mag < weapon.def.magSize) intent.reload = true;
        }
        break;
      }
    }

    // Giro com velocidade limitada: o bot não "teleporta" a mira
    const maxTurn = BOT.turnSpeed * dt;
    this.yaw = wrap(this.yaw + clamp(wrap(desiredYaw - this.yaw), -maxTurn, maxTurn));
    this.pitch += clamp(desiredPitch - this.pitch, -maxTurn, maxTurn);
    intent.yaw = this.yaw;
    intent.pitch = this.pitch;
    intent.jump = this.wantJump;
    this.wantJump = false;
    return intent;
  }

  /** Converte direção de mundo em movimento relativo ao yaw atual. */
  private toLocal(intent: MoveIntent, dir: Point2) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    intent.moveZ = dir.x * s + dir.z * c;
    intent.moveX = dir.x * c - dir.z * s;
  }

  /** Segue o caminho até `goal`; retorna a direção normalizada ou null se chegou. */
  private follow(ctx: BotContext, goal: Point2): Point2 | null {
    const { time, nav } = ctx;
    const feet = ctx.self.controller.state.feet;
    if (dist2(feet, goal) < BOT.arriveRadius) return null;

    const goalMoved = !this.pathGoal || dist2(this.pathGoal, goal) > 1;
    if (goalMoved || time >= this.repathAt || this.path.length === 0) {
      this.path = nav.findPath(feet, goal) ?? [];
      this.pathGoal = goal;
      this.repathAt = time + BOT.repathSeconds;
    }
    while (this.path.length > 1 && dist2(feet, this.path[0]) < 0.45) this.path.shift();
    const next = this.path[0];
    if (!next) return null;

    // Anti-travamento: se quase não andou em 1 s, recalcula e pula
    if (time >= this.stuckCheckAt) {
      if (dist2(feet, this.stuckFrom) < 0.3) {
        this.repathAt = 0;
        this.wantJump = true;
      }
      this.stuckFrom = { x: feet.x, z: feet.z };
      this.stuckCheckAt = time + 1;
    }

    const dx = next.x - feet.x;
    const dz = next.z - feet.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }
}
