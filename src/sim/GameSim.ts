// Estado completo da partida. Recebe o intent do jogador, gera os dos bots,
// avança ticks e emite eventos. Não conhece render, DOM ou dispositivo:
// roda no navegador ou no Node.
//
// Dois modos:
//   rodadas  → mapa com bombsites e zonas de spawn (Galpão): plantar/desarmar
//   treino   → sem rodadas (campo de testes): todos renascem sozinhos

import type { MoveIntent } from '../input/InputIntents';
import type { Area, LevelData } from '../level/LevelData';
import { BotBrain, type Noise, objectiveFromPost, type TeamMemory } from './ai/BotBrain';
import { TeamCommander } from './ai/TeamCommander';
import { type Combatant, type Team } from './Combatant';
import { COMBAT, type Difficulty, SIM_DT, SKILLS } from './config';
import { type EntityId, EventQueue, type HitPart, type SimEvent } from './events';
import { type HitInfo, HitRegistry } from './HitRegistry';
import type { Vec3 } from './math';
import { NavGrid } from './nav/NavGrid';
import { PhysicsWorld } from './PhysicsWorld';
import { PlayerController } from './PlayerController';
import { Rng } from './rng';
import { RoundSystem } from './RoundSystem';
import { TargetSystem } from './TargetSystem';
import { sightPoint } from './vision';
import { WeaponController } from './WeaponController';
import { RIFLE } from './weapons';

export interface Bot {
  combatant: Combatant;
  brain: BotBrain;
}

export interface SimOptions {
  /** false = sem nenhum bot. */
  bots?: boolean;
  /** Aliados bots do jogador (padrão 2: partida 3x3). */
  allies?: number;
  /** Lado em que o jogador humano começa (padrão: ataque). Troca no intervalo. */
  side?: Team;
  /** false = desliga rodadas mesmo em mapa competitivo. */
  rounds?: boolean;
  /**
   * Dificuldade de TODOS os bots, aliados e adversários (padrão: normal).
   * Simétrica de propósito: com aliados mais fortes que os adversários, a
   * defesa (que já espera posicionada) vencia sozinha 15 de 16 rodadas.
   */
  difficulty?: Difficulty;
}

const emptyMemory = (): TeamMemory => ({ lastKnown: null, at: -99, spotter: null, responder: null });
/** Avistamento pelo humano: metade do campo de visão horizontal da câmera na horizontal e alcance. */
const SPOT = { halfFov: 0.95, maxDistance: 60 };
const other = (t: Team): Team => (t === 'attack' ? 'defense' : 'attack');
const spawnYaw = (level: LevelData, t: Team) => (t === 'attack' ? level.spawnYaw : Math.PI);

export class GameSim {
  readonly physics: PhysicsWorld;
  readonly hits = new HitRegistry();
  readonly nav: NavGrid;
  readonly targets: TargetSystem;
  readonly human: Combatant;
  readonly bots: Bot[] = [];
  readonly rounds: RoundSystem | null = null;
  private readonly commander: TeamCommander | null = null;
  private readonly events = new EventQueue();
  private readonly rng: Rng;
  private teams: Record<Team, TeamMemory> = { attack: emptyMemory(), defense: emptyMemory() };
  private noises: Noise[] = [];
  private commanderTimer = 0;
  /** Lado inicial do humano; volta a ele ao recomeçar a partida. */
  private startSide: Team;
  tickCount = 0;

  /** Requer `await initPhysics()` antes. */
  constructor(
    readonly level: LevelData,
    seed = 1,
    opts: SimOptions = {},
  ) {
    this.rng = new Rng(seed);
    this.physics = new PhysicsWorld(level);
    this.nav = new NavGrid(level);
    this.targets = new TargetSystem(this.physics, level, this.hits, this.events);

    const side = opts.side ?? 'attack';
    this.startSide = side;
    this.human = this.createCombatant('player', side, level.spawn, level.spawnYaw, COMBAT.playerHealth, COMBAT.playerRespawnSeconds);

    // Dois times fixos (o do jogador e o adversário); o LADO de cada um troca
    // no intervalo. Adversários: um por posto de defesa (3). Aliados: `allies`.
    const zones = level.spawnZones;
    if (opts.bots !== false && level.defensePosts && zones) {
      let n = 0;
      const enemySide = other(side);
      level.defensePosts.forEach((post) => {
        const c = this.createCombatant(`bot:${n}`, enemySide, this.spawnPoint(zones[enemySide], n, level.defensePosts!.length), spawnYaw(level, enemySide), COMBAT.botHealth, COMBAT.botRespawnSeconds, 9999);
        // Sem rodadas não há comandante: a defesa vai direto ao posto
        const goal = enemySide === 'defense' ? objectiveFromPost(post) : { point: { x: c.respawnAt.x, z: c.respawnAt.z }, watchYaw: c.respawnYaw };
        const brain = new BotBrain(goal, n, SKILLS[opts.difficulty ?? 'normal']);
        brain.reset(c.respawnYaw);
        this.bots.push({ combatant: c, brain });
        n++;
      });
      const allies = opts.allies ?? 2;
      for (let i = 0; i < allies; i++) {
        const spawn = this.spawnPoint(zones[side], i + 1, allies + 1);
        const c = this.createCombatant(`bot:${n}`, side, spawn, spawnYaw(level, side), COMBAT.botHealth, COMBAT.botRespawnSeconds, 9999);
        const brain = new BotBrain({ point: { x: spawn.x, z: spawn.z }, watchYaw: c.respawnYaw }, n, SKILLS[opts.difficulty ?? 'normal']);
        brain.reset(c.respawnYaw);
        this.bots.push({ combatant: c, brain });
        n++;
      }
    }

    if (opts.rounds !== false && level.bombsites?.length && zones) {
      this.commander = new TeamCommander(level, this.nav);
      this.rounds = new RoundSystem(
        level,
        {
          combatants: () => this.combatants(),
          kill: (c) => this.kill(c, null),
          resetPositions: () => this.resetPositions(),
          swapSides: () => this.swapSides(),
        },
        this.events,
        () => this.bombCarrier(),
      );
      this.rounds.startRound();
      this.commander.onRoundStart(this.rng);
    }
    // Um step inicial para o broad-phase registrar os colliders estáticos
    this.physics.step(SIM_DT);
  }

  /** Posição `i` de `n` espalhada ao longo da zona de spawn. */
  private spawnPoint(zone: Area, i: number, n: number): Vec3 {
    const x = zone.min[0] + ((i + 1) / (n + 1)) * (zone.max[0] - zone.min[0]);
    return { x, y: 0.05, z: (zone.min[1] + zone.max[1]) / 2 };
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

  find(id: EntityId): Combatant | undefined {
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
    if (killed) this.kill(victim, killer ?? null);
  }

  /** Mata um combatente (tiro ou explosão). */
  kill(victim: Combatant, killer: Combatant | null): void {
    if (!victim.alive) return;
    victim.health = 0;
    victim.alive = false;
    victim.diedAt = this.time;
    victim.deaths++;
    if (killer) killer.kills++;
    victim.controller.setActive(false);
  }

  private revive(c: Combatant, at: Vec3, yaw: number): void {
    c.controller.teleport(at, yaw);
    c.controller.setActive(true);
    c.health = c.maxHealth;
    c.alive = true;
    this.bots.find((b) => b.combatant === c)?.brain.reset(yaw);
    this.events.push({ type: 'respawn', id: c.id });
  }

  /** Quem começa a rodada com a bomba: o humano no ataque, senão um bot do ataque. */
  private bombCarrier(): EntityId | null {
    if (this.human.team === 'attack') return this.human.id;
    const attackers = this.bots.filter((b) => b.combatant.team === 'attack');
    if (!attackers.length) return null;
    return attackers[Math.floor(this.rng.next() * attackers.length)].combatant.id;
  }

  /** Intervalo: todos passam para o outro lado. */
  private swapSides(): void {
    for (const c of this.combatants()) {
      c.team = other(c.team);
      c.respawnYaw = spawnYaw(this.level, c.team);
    }
  }

  /** Início de rodada: cada equipe na sua zona, vida e munição cheias. */
  private resetPositions(): void {
    const zones = this.level.spawnZones!;
    for (const team of ['attack', 'defense'] as const) {
      const members = this.combatants().filter((c) => c.team === team);
      // O humano fica no centro; os bots ocupam as vagas em volta
      const bots = members.filter((c) => c !== this.human);
      const slots = members.length;
      const middle = Math.floor(slots / 2);
      const free = Array.from({ length: slots }, (_, k) => k).filter((k) => !members.includes(this.human) || k !== middle);
      members.forEach((c) => {
        const at = this.spawnPoint(zones[team], c === this.human ? middle : free[bots.indexOf(c)], slots);
        c.respawnAt = { ...at };
        this.revive(c, at, spawnYaw(this.level, team));
        c.weapon.refill();
      });
    }
    this.teams = { attack: emptyMemory(), defense: emptyMemory() };
  }

  /**
   * Inimigos que alguém do time `team` está vendo agora (radar). Bots contam
   * o alvo que estão combatendo; o humano conta quem está no campo de visão
   * da câmera e sem parede no caminho. Só lê o estado: não altera a partida.
   */
  spottedBy(team: Team): Set<EntityId> {
    const out = new Set<EntityId>();
    for (const b of this.bots) {
      const seen = b.combatant.alive && b.combatant.team === team ? b.brain.seenTarget : null;
      if (seen) out.add(seen);
    }
    const h = this.human;
    if (h.alive && h.team === team) {
      const eye = h.controller.eyePosition();
      for (const e of this.combatants()) {
        if (!e.alive || e.team === team || out.has(e.id)) continue;
        const f = e.controller.state.feet;
        const dx = f.x - eye.x;
        const dz = f.z - eye.z;
        if (Math.hypot(dx, dz) > SPOT.maxDistance) continue;
        let off = Math.atan2(dx, dz) - h.controller.state.yaw;
        off = Math.atan2(Math.sin(off), Math.cos(off));
        if (Math.abs(off) > SPOT.halfFov) continue;
        if (sightPoint(this.physics, this.hits, h, e)) out.add(e.id);
      }
    }
    return out;
  }

  /** Dificuldade de todos os bots (ver `SimOptions.difficulty`). */
  setDifficulty(d: Difficulty): void {
    for (const b of this.bots) b.brain.skill = SKILLS[d];
  }

  /**
   * Recomeça a partida (botão "Jogar de novo" ou troca de lado no menu).
   * @param side lado inicial do jogador; omitido mantém o da partida anterior
   */
  restartMatch(side: Team = this.startSide): void {
    if (!this.rounds) return;
    this.startSide = side;
    if (this.human.team !== side) this.swapSides();
    for (const c of this.combatants()) {
      c.kills = 0;
      c.deaths = 0;
    }
    this.rounds.restartMatch();
    this.commander?.onRoundStart(this.rng);
  }

  tick(intent: MoveIntent, dt = SIM_DT): void {
    const time = this.time;
    const all = this.combatants();
    const rounds = this.rounds;

    // Objetivos da equipe (2x por segundo basta)
    this.commanderTimer -= dt;
    if (this.commander && rounds && this.commanderTimer <= 0) {
      this.commanderTimer = 0.5;
      this.commander.update(this.bots, this.human, rounds.bomb);
    }

    // Intents: humano vem de fora; bots pensam com o estado do tick anterior
    const intents = new Map<Combatant, MoveIntent>([[this.human, { ...intent }]]);
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

    rounds?.preStep(intents, dt);

    for (const c of all) {
      if (!c.alive) {
        // Sem rodadas (treino): renasce sozinho
        if (!rounds && time - c.diedAt >= c.respawnSeconds) this.revive(c, c.respawnAt, c.respawnYaw);
        continue;
      }
      const i = intents.get(c)!;
      c.controller.step(i, dt);
      c.weapon.step(i, c.controller.state, c.controller.eyePosition(), c.controller.collider, dt);
    }

    this.targets.update(time);
    this.physics.step(dt);

    const before = rounds?.state.round;
    rounds?.postStep(dt);
    if (rounds && rounds.state.round !== before) this.commander?.onRoundStart(this.rng);

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
