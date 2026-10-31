// Estado completo da partida. Recebe o intent do jogador, gera os dos bots,
// avança ticks e emite eventos. Não conhece render, DOM ou dispositivo:
// roda no navegador ou no Node.

import type { MoveIntent } from '../input/InputIntents';
import type { LevelData } from '../level/LevelData';
import { BotBrain, type Noise, type TeamMemory } from './ai/BotBrain';
import { type Combatant, type Team } from './Combatant';
import { COMBAT, SIM_DT } from './config';
import { type EntityId, EventQueue, type HitPart, type SimEvent } from './events';
import { type HitInfo, HitRegistry } from './HitRegistry';
import type { Vec3 } from './math';
import { NavGrid } from './nav/NavGrid';
import { PhysicsWorld } from './PhysicsWorld';
import { PlayerController } from './PlayerController';
import { Rng } from './rng';
import { TargetSystem } from './TargetSystem';
import { WeaponController } from './WeaponController';
import { RIFLE } from './weapons';

export interface Bot {
  combatant: Combatant;
  brain: BotBrain;
}

export class GameSim {
  readonly physics: PhysicsWorld;
  readonly hits = new HitRegistry();
  readonly nav: NavGrid;
  readonly targets: TargetSystem;
  readonly human: Combatant;
  readonly bots: Bot[] = [];
  private readonly events = new EventQueue();
  private readonly rng: Rng;
  private readonly teams: Record<Team, TeamMemory> = {
    attack: { lastKnown: null, at: -99, spotter: null, responder: null },
    defense: { lastKnown: null, at: -99, spotter: null, responder: null },
  };
  private noises: Noise[] = [];
  tickCount = 0;

  /** Requer `await initPhysics()` antes. */
  constructor(
    readonly level: LevelData,
    seed = 1,
    opts: { bots?: boolean } = {},
  ) {
    this.rng = new Rng(seed);
    this.physics = new PhysicsWorld(level);
    this.nav = new NavGrid(level);
    this.targets = new TargetSystem(this.physics, level, this.hits, this.events);

    this.human = this.createCombatant('player', 'attack', level.spawn, level.spawnYaw, COMBAT.playerHealth, COMBAT.playerRespawnSeconds);

    if (opts.bots !== false && level.defensePosts && level.spawnZones) {
      const z = level.spawnZones.defense;
      level.defensePosts.forEach((post, i) => {
        // Nascem espalhados no spawn da defesa e caminham até o posto
        const x = z.min[0] + ((i + 1) / (level.defensePosts!.length + 1)) * (z.max[0] - z.min[0]);
        const spawn = { x, y: 0.5, z: (z.min[1] + z.max[1]) / 2 };
        const c = this.createCombatant(`bot:${i}`, 'defense', spawn, Math.PI, COMBAT.botHealth, COMBAT.botRespawnSeconds, 9999);
        const brain = new BotBrain(post, i);
        brain.reset(Math.PI);
        this.bots.push({ combatant: c, brain });
      });
    }
    // Um step inicial para o broad-phase registrar os colliders estáticos
    this.physics.step(SIM_DT);
  }

  private createCombatant(
    id: EntityId,
    team: Team,
    spawn: Vec3,
    yaw: number,
    health: number,
    respawnSeconds: number,
    reserve?: number,
  ): Combatant {
    const controller = new PlayerController(this.physics, spawn, yaw);
    // Hitbox = a própria cápsula; a parte depende da altura do impacto
    this.hits.register(controller.collider, id, (p): HitPart => (p.y >= controller.headLineY() ? 'head' : 'body'));
    const weapon = new WeaponController(
      RIFLE,
      id,
      this.physics,
      this.hits,
      this.events,
      (hit, dmg) => this.applyDamage(id, hit, dmg),
      new Rng(this.rng.next() * 2 ** 32),
      reserve,
    );
    return {
      id,
      team,
      controller,
      weapon,
      health,
      maxHealth: health,
      alive: true,
      diedAt: -99,
      respawnAt: { ...spawn },
      respawnYaw: yaw,
      respawnSeconds,
      kills: 0,
      deaths: 0,
    };
  }

  /** Compatibilidade: controlador e arma do jogador humano. */
  get player(): PlayerController {
    return this.human.controller;
  }
  get weapon(): WeaponController {
    return this.human.weapon;
  }

  get time(): number {
    return this.tickCount * SIM_DT;
  }

  combatants(): Combatant[] {
    return [this.human, ...this.bots.map((b) => b.combatant)];
  }

  private find(id: EntityId): Combatant | undefined {
    return id === 'player' ? this.human : this.bots.find((b) => b.combatant.id === id)?.combatant;
  }

  private applyDamage(attacker: EntityId, hit: HitInfo, damage: number): void {
    if (hit.victim.startsWith('target:')) {
      this.targets.applyDamage(Number(hit.victim.slice(7)), hit.part, damage, attacker, this.time);
      return;
    }
    const victim = this.find(hit.victim);
    const killer = this.find(attacker);
    if (!victim?.alive) return;
    // Sem fogo amigo
    if (killer && killer.team === victim.team) return;
    victim.health = Math.max(0, victim.health - damage);
    const killed = victim.health === 0;
    this.events.push({ type: 'hit', attacker, victim: victim.id, part: hit.part, damage, killed });
    if (killed) {
      victim.alive = false;
      victim.diedAt = this.time;
      victim.deaths++;
      if (killer) killer.kills++;
      victim.controller.setActive(false);
    }
  }

  private respawn(c: Combatant): void {
    c.controller.teleport(c.respawnAt, c.respawnYaw);
    c.controller.setActive(true);
    c.health = c.maxHealth;
    c.alive = true;
    this.bots.find((b) => b.combatant === c)?.brain.reset(c.respawnYaw);
    this.events.push({ type: 'respawn', id: c.id });
  }

  tick(intent: MoveIntent, dt = SIM_DT): void {
    const time = this.time;
    const all = this.combatants();

    // Intents: humano vem de fora; bots pensam com o estado do tick anterior
    const intents = new Map<Combatant, MoveIntent>([[this.human, intent]]);
    this.updateResponders();
    for (const bot of this.bots) {
      if (!bot.combatant.alive) continue;
      const enemies = all.filter((c) => c.team !== bot.combatant.team);
      intents.set(
        bot.combatant,
        bot.brain.think({
          time,
          dt,
          self: bot.combatant,
          enemies,
          physics: this.physics,
          hits: this.hits,
          nav: this.nav,
          team: this.teams[bot.combatant.team],
          noises: this.noises,
          rng: this.rng,
        }),
      );
    }

    for (const c of all) {
      if (!c.alive) {
        if (time - c.diedAt >= c.respawnSeconds) this.respawn(c);
        continue;
      }
      const i = intents.get(c)!;
      c.controller.step(i, dt);
      c.weapon.step(i, c.controller.state, c.controller.eyePosition(), c.controller.collider, dt);
    }

    this.targets.update(time);
    this.physics.step(dt);

    // Tiros deste tick viram "barulho" que os bots ouvem no próximo
    this.noises = this.events
      .peek()
      .filter((e): e is Extract<SimEvent, { type: 'shot' }> => e.type === 'shot')
      .map((e) => ({ origin: e.origin, source: e.shooter }));
    this.tickCount++;
  }

  /** Escolhe o bot mais próximo do avistamento para ir apoiar. */
  private updateResponders(): void {
    for (const team of ['attack', 'defense'] as const) {
      const mem = this.teams[team];
      if (!mem.lastKnown || this.time - mem.at > 0.5 || mem.responder) continue;
      let best: Bot | null = null;
      let bestD = Infinity;
      for (const b of this.bots) {
        if (b.combatant.team !== team || !b.combatant.alive || b.combatant.id === mem.spotter) continue;
        const f = b.combatant.controller.state.feet;
        const d = Math.hypot(f.x - mem.lastKnown.x, f.z - mem.lastKnown.z);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      mem.responder = best?.combatant.id ?? null;
    }
  }

  drainEvents(): SimEvent[] {
    return this.events.drain();
  }

  dispose(): void {
    this.physics.dispose();
  }
}

