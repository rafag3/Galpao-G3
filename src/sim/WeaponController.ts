// Disparo por raycast (hitscan), munição, recarga, dispersão e recuo.
// Sem dependência de render: tudo que o jogador vê sai dos eventos.

import { MOVE } from './config';
import type { EntityId, EventQueue } from './events';
import type { HitInfo, HitRegistry } from './HitRegistry';
import { approach, clamp, type Vec3 } from './math';
import { PhysicsWorld, RAPIER } from './PhysicsWorld';
import type { PlayerState } from './PlayerController';
import { Rng } from './rng';
import type { WeaponDef } from './weapons';

export interface WeaponState {
  def: WeaponDef;
  mag: number;
  reserve: number;
  reloading: boolean;
  /** 0 → 1 durante a recarga. */
  reloadProgress: number;
  /** Recuo atual somado à mira (pitch negativo = para cima). */
  recoilPitch: number;
  recoilYaw: number;
  /** Tempo desde o último tiro (para animações e retorno do recuo). */
  sinceLastShot: number;
  shotsFired: number;
}

/** Direção de visão a partir de yaw/pitch (pitch positivo = para baixo). */
export function viewDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: -Math.sin(pitch), z: Math.cos(yaw) * cp };
}

export class WeaponController {
  readonly state: WeaponState;
  private cooldown = 0;
  private reloadTimer = 0;
  private triggerWasDown = false;

  /**
   * @param owner entidade que segura a arma (vai nos eventos)
   * @param applyDamage aplica o dano na entidade atingida (decidido pela GameSim)
   */
  constructor(
    def: WeaponDef,
    private readonly owner: EntityId,
    private readonly physics: PhysicsWorld,
    private readonly hits: HitRegistry,
    private readonly events: EventQueue,
    private readonly applyDamage: (hit: HitInfo, damage: number) => void,
    private readonly rng = new Rng(),
    reserve = def.reserve,
  ) {
    this.state = {
      def,
      mag: def.magSize,
      reserve,
      reloading: false,
      reloadProgress: 0,
      recoilPitch: 0,
      recoilYaw: 0,
      sinceLastShot: 99,
      shotsFired: 0,
    };
  }

  step(
    input: { fire: boolean; reload: boolean },
    player: PlayerState,
    eye: Vec3,
    exclude: RAPIER.Collider,
    dt: number,
  ): void {
    const s = this.state;
    const def = s.def;
    this.cooldown = Math.max(0, this.cooldown - dt);
    s.sinceLastShot += dt;

    // Recarga
    if (s.reloading) {
      this.reloadTimer -= dt;
      s.reloadProgress = clamp(1 - this.reloadTimer / def.reloadTime, 0, 1);
      if (this.reloadTimer <= 0) {
        const take = Math.min(def.magSize - s.mag, s.reserve);
        s.mag += take;
        s.reserve -= take;
        s.reloading = false;
        s.reloadProgress = 0;
        this.events.push({ type: 'reloadEnd', shooter: this.owner });
      }
    } else if (input.reload) {
      this.startReload();
    }

    // Disparo
    const triggerPressed = input.fire && (def.automatic || !this.triggerWasDown);
    // Tolerância: somas de 1/60 acumulam erro de ponto flutuante
    if (triggerPressed && !s.reloading && this.cooldown <= 1e-6) {
      if (s.mag > 0) {
        this.fire(player, eye, exclude);
        this.cooldown += def.fireInterval;
      } else if (!this.triggerWasDown) {
        this.events.push({ type: 'dryFire', shooter: this.owner });
        this.startReload(); // recarga automática ao tentar atirar sem bala
      }
    }
    this.triggerWasDown = input.fire;

    // Retorno do recuo ao centro
    if (s.sinceLastShot > def.recoil.recoveryDelay) {
      const r = def.recoil.recoveryPerSec * dt;
      s.recoilPitch = approach(s.recoilPitch, 0, r);
      s.recoilYaw = approach(s.recoilYaw, 0, r * 0.5);
    }
    if (!input.fire && s.sinceLastShot > def.recoil.recoveryDelay) s.shotsFired = 0;
  }

  /** Nova rodada: pente e reserva cheios, sem recarga ou recuo pendente. */
  refill(): void {
    const s = this.state;
    s.mag = s.def.magSize;
    s.reserve = Math.max(s.reserve, s.def.reserve);
    s.reloading = false;
    s.reloadProgress = 0;
    s.recoilPitch = s.recoilYaw = 0;
    this.reloadTimer = 0;
    this.cooldown = 0;
  }

  /** Dispersão atual em radianos (exposta para a mira dinâmica do HUD). */
  currentSpread(player: PlayerState): number {
    const sp = this.state.def.spread;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    let spread = sp.base + sp.moving * clamp(speed / MOVE.runSpeed, 0, 1);
    if (!player.grounded) spread += sp.air;
    if (player.crouching) spread *= sp.crouchMultiplier;
    return spread + Math.abs(this.state.recoilPitch) * sp.fromRecoil;
  }

  private startReload(): void {
    const s = this.state;
    if (s.reloading || s.mag >= s.def.magSize || s.reserve <= 0) return;
    s.reloading = true;
    s.reloadProgress = 0;
    this.reloadTimer = s.def.reloadTime;
    this.events.push({ type: 'reloadStart', shooter: this.owner, duration: s.def.reloadTime });
  }

  private fire(player: PlayerState, eye: Vec3, exclude: RAPIER.Collider): void {
    const s = this.state;
    const def = s.def;

    // Dispersão: ponto aleatório num disco com raio = spread
    const spread = this.currentSpread(player);
    const r = Math.sqrt(this.rng.next()) * spread;
    const a = this.rng.next() * Math.PI * 2;
    const yaw = player.yaw + s.recoilYaw + Math.cos(a) * r;
    const pitch = player.pitch + s.recoilPitch + Math.sin(a) * r;
    const dir = viewDirection(yaw, pitch);

    s.mag--;
    s.shotsFired++;
    s.sinceLastShot = 0;
    this.events.push({ type: 'shot', shooter: this.owner, origin: eye, direction: dir });

    // Recuo aplicado DEPOIS do tiro: o primeiro tiro é preciso
    s.recoilPitch = Math.max(s.recoilPitch - def.recoil.pitchPerShot, -def.recoil.maxPitch);
    s.recoilYaw += (this.rng.next() * 2 - 1) * def.recoil.yawJitter;

    const ray = new RAPIER.Ray(eye, dir);
    const hit = this.physics.world.castRayAndGetNormal(
      ray,
      def.range,
      true,
      undefined,
      undefined,
      exclude,
    );
    if (!hit) return;

    const t = hit.timeOfImpact;
    const point = { x: eye.x + dir.x * t, y: eye.y + dir.y * t, z: eye.z + dir.z * t };
    const info = this.hits.resolve(hit.collider, point);
    this.events.push({ type: 'impact', point, normal: { ...hit.normal }, onEntity: !!info });
    if (info) {
      const damage = info.part === 'head' ? def.damage * def.headshotMultiplier : def.damage;
      this.applyDamage(info, damage);
    }
  }
}
