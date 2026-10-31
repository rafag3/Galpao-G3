// Orquestra input → simulação (passo fixo) → eventos → render/áudio/HUD.

import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { SoundFx } from '../audio/SoundFx';
import { InputManager } from '../input/InputManager';
import { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { TouchInput } from '../input/TouchInput';
import type { LevelData } from '../level/LevelData';
import { GameRenderer } from '../render/GameRenderer';
import { LOOK, MOVE, ROUND, SIM_DT } from '../sim/config';
import { type Team, viewOf } from '../sim/Combatant';
import type { EntityId, SimEvent } from '../sim/events';
import { GameSim, type SimOptions } from '../sim/GameSim';
import { clamp, lerp, type Vec3 } from '../sim/math';
import { initPhysics } from '../sim/PhysicsWorld';
import { DebugHud } from '../ui/DebugHud';
import { Minimap } from '../ui/Minimap';
import { AllyTags } from '../ui/AllyTags';
import { KillFeed } from '../ui/KillFeed';
import { displayName } from '../ui/names';
import { Hud } from '../ui/Hud';
import { type BombAction, RoundHud } from '../ui/RoundHud';
import { inSite } from '../sim/RoundSystem';
import { StartOverlay } from '../ui/StartOverlay';
import { FixedStepLoop } from './FixedStepLoop';
import { settings } from './Settings';
import { trackViewport } from './viewport';

export const isTouchDevice = () =>
  window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

export class Game {
  private sim!: GameSim;
  private renderer!: GameRenderer;
  private readonly input = new InputManager();
  private readonly sound = new SoundFx();
  private loop!: FixedStepLoop;
  private keyboard?: KeyboardMouseInput;
  private touch?: TouchInput;
  private debug?: DebugHud;
  private hud?: Hud;
  private roundHud?: RoundHud;
  private minimap?: Minimap;
  private killFeed?: KillFeed;
  private allyTags?: AllyTags;
  /** Inimigos avistados pelo time (radar); recalculado algumas vezes por segundo. */
  private spotted = new Set<EntityId>();
  private spotTimer = 0;
  private instrumentation?: SceneInstrumentation;
  private running = false;
  /** Visão local do jogador: atualizada a cada frame, enviada à sim a cada tick. */
  private view = { yaw: 0, pitch: 0 };
  private prevEye: Vec3 = { x: 0, y: 0, z: 0 };
  private currEye: Vec3 = { x: 0, y: 0, z: 0 };
  private hits = 0;
  private kills = 0;
  /** Pés de cada combatente nos dois últimos ticks (interpolação do render). */
  private prevFeet = new Map<EntityId, Vec3>();
  private currFeet = new Map<EntityId, Vec3>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
  ) {}

  async init(level: LevelData, simOptions: SimOptions = {}): Promise<void> {
    await initPhysics();
    this.sim = new GameSim(level, Date.now() % 100000, { difficulty: settings.difficulty, side: settings.side, ...simOptions });
    // ?graficos=leve força o modo leve (aparelhos fracos e testes automatizados)
    const quality = new URLSearchParams(location.search).get('graficos') === 'leve' ? 'low' : settings.graphics;
    this.renderer = new GameRenderer(this.canvas, level, this.sim.targets.targets, isTouchDevice(), quality);
    this.resetView();

    const touch = isTouchDevice();
    if (touch) {
      document.body.classList.add('is-touch');
      this.touch = new TouchInput(this.uiRoot);
      this.input.add(this.touch);
    }
    // Teclado/mouse fica sempre ativo: tablets com teclado e PCs com tela touch
    this.keyboard = new KeyboardMouseInput(this.canvas);
    this.input.add(this.keyboard);

    this.captureFeet();
    this.prevFeet = new Map(this.currFeet);
    this.loop = new FixedStepLoop(SIM_DT, (dt) => {
      this.prevEye = this.currEye;
      this.prevFeet = this.currFeet;
      this.sim.tick(this.input.sampleTick(this.view.yaw, this.view.pitch), dt);
      this.currEye = this.sim.player.eyePosition();
      this.captureFeet();
      for (const e of this.sim.drainEvents()) this.onEvent(e);
    });

    this.hud = new Hud(this.uiRoot);
    this.minimap = new Minimap(this.uiRoot, level);
    this.killFeed = new KillFeed(this.uiRoot);
    this.allyTags = new AllyTags(this.uiRoot);
    if (this.sim.rounds) {
      this.roundHud = new RoundHud(this.uiRoot, () => {
        this.sim.restartMatch();
        this.input.clearLatched();
      });
    }
    this.debug = new DebugHud(this.uiRoot);
    this.instrumentation = new SceneInstrumentation(this.renderer.scene);

    const overlay = new StartOverlay(this.uiRoot, {
      isTouch: touch,
      onStart: () => {
        this.sound.unlock();
        this.input.clearLatched();
        this.running = true;
        if (!touch) this.keyboard?.requestLock();
      },
      onVolumeChange: (v) => this.sound.setVolume(v),
      onDifficultyChange: (d) => this.sim.setDifficulty(d),
      onSideChange: (side) => this.restart(side),
      onRestart: () => this.restart(),
    });

    const pause = () => {
      if (!this.running) return;
      this.running = false;
      overlay.show();
    };
    // Engrenagem ao lado do radar: abre o menu (no celular é a única pausa)
    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'hud-gear';
    gear.setAttribute('aria-label', 'Menu');
    gear.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.5 7.5 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.5 7.5 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.5 7.5 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.5 7.5 0 0 0 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';
    gear.addEventListener('click', () => {
      if (!touch) document.exitPointerLock?.();
      pause();
    });
    this.uiRoot.append(gear);
    // PC: soltar o mouse (Esc) pausa
    document.addEventListener('pointerlockchange', () => {
      if (!touch && document.pointerLockElement !== this.canvas) pause();
    });
    // Celular: app em segundo plano pausa
    document.addEventListener('visibilitychange', () => document.hidden && pause());
    // Clique no canvas recaptura o mouse se o lock tiver caído
    this.canvas.addEventListener('click', () => {
      if (this.running && !touch) this.keyboard?.requestLock();
    });

    trackViewport(this.canvas, () => this.renderer.resize());

    this.renderer.engine.runRenderLoop(() => this.frame());

    // Gancho de diagnóstico para testes automatizados (somente leitura)
    const game = this;
    (window as unknown as { __galpao: unknown }).__galpao = {
      get state() {
        return structuredClone(game.sim.player.state);
      },
      get weapon() {
        const { def: _def, ...w } = game.sim.weapon.state;
        return structuredClone(w);
      },
      get targets() {
        return structuredClone(game.sim.targets.targets);
      },
      get stats() {
        return { hits: game.hits, kills: game.kills, health: game.sim.human.health, alive: game.sim.human.alive };
      },
      get bots() {
        return game.sim.bots.map((b) => ({ id: b.combatant.id, state: b.brain.state, alive: b.combatant.alive, ...viewOf(b.combatant).feet }));
      },
      /** Só para testes automatizados: reposiciona o jogador. */
      teleport(x: number, z: number, yaw = 0) {
        game.sim.human.controller.teleport({ x, y: 0.05, z }, yaw);
        game.view = { yaw, pitch: 0 };
        game.currEye = game.prevEye = game.sim.player.eyePosition();
      },
      get round() {
        const r = game.sim.rounds;
        return r && { ...structuredClone(r.state), bomb: structuredClone(r.bomb) };
      },
      restartMatch() {
        game.sim.restartMatch();
      },
      /** Só para testes automatizados: planta a bomba direto no ponto do site. */
      plant(site: 'A' | 'B') {
        const r = game.sim.rounds;
        const s = game.sim.level.bombsites?.find((b) => b.id === site);
        if (r && s?.plantSpot) r.debugPlant(site, { x: s.plantSpot[0], y: 0.05, z: s.plantSpot[1] });
      },
      get team() {
        return game.sim.human.team;
      },
      get running() {
        return game.running;
      },
    };
  }

  /** Recomeça a partida pelo menu (troca de lado ou "Recomeçar partida"). */
  private restart(side?: Team): void {
    this.sim.restartMatch(side);
    this.sim.drainEvents();
    this.hits = this.kills = 0;
    this.input.clearLatched();
    this.roundHud?.reset();
    this.killFeed?.clear();
    this.resetView();
  }

  /** Câmera na posição e direção atuais do jogador (início e troca de lado). */
  private resetView(): void {
    this.view = { yaw: this.sim.human.controller.state.yaw, pitch: 0 };
    this.currEye = this.prevEye = this.sim.player.eyePosition();
    this.captureFeet();
    this.prevFeet = new Map(this.currFeet);
  }

  private reportKill(attacker: EntityId, victim: EntityId, head: boolean): void {
    const k = this.sim.find(attacker);
    const v = this.sim.find(victim);
    if (!v) return;
    const mine = attacker === 'player' || victim === 'player';
    this.killFeed?.add(k ? { name: displayName(k.id), team: k.team } : null, { name: displayName(v.id), team: v.team }, head, mine);
  }

  /** Nome e vida sobre os aliados vivos (projetados da posição 3D da cabeça). */
  private updateAllyTags(feetOf: (id: EntityId) => Vec3): void {
    if (!this.allyTags) return;
    const human = this.sim.human;
    const allies = this.sim.bots.map((b) => b.combatant).filter((c) => c.alive && c.team === human.team);
    this.allyTags.update(
      allies.map((c) => {
        const f = feetOf(c.id);
        const head = { x: f.x, y: f.y + (c.controller.state.crouching ? 1.45 : 2.05), z: f.z };
        return { id: c.id, name: displayName(c.id), health: c.health, screen: this.renderer.project(head) };
      }),
    );
  }

  private updateMinimap(dt: number, feetOf: (id: EntityId) => Vec3): void {
    if (!this.minimap) return;
    const human = this.sim.human;
    const team = human.team;
    // Raycasts de avistamento: ~7 vezes por segundo bastam para o radar
    this.spotTimer -= dt;
    if (this.spotTimer <= 0) {
      this.spotTimer = 0.15;
      this.spotted = this.sim.spottedBy(team);
    }
    const others = this.sim.bots.map((b) => b.combatant).filter((c) => c.alive);
    const me = feetOf(human.id);
    const bomb = this.sim.rounds?.bomb ?? null;
    const carrier = bomb?.status === 'carried' && bomb.carrier ? this.sim.find(bomb.carrier) : undefined;
    this.minimap.update({
      x: me.x,
      z: me.z,
      yaw: this.view.yaw,
      team,
      allies: others.filter((c) => c.team === team).map((c) => feetOf(c.id)),
      enemies: others.filter((c) => c.team !== team && this.spotted.has(c.id)).map((c) => feetOf(c.id)),
      bomb,
      bombCarrier: carrier?.alive ? feetOf(carrier.id) : null,
      time: this.sim.time,
    });
  }

  private captureFeet(): void {
    const next = new Map<EntityId, Vec3>();
    for (const c of this.sim.combatants()) next.set(c.id, { ...c.controller.state.feet });
    this.currFeet = next;
  }

  private onEvent(e: SimEvent): void {
    const mine = (id: EntityId) => id === 'player';
    switch (e.type) {
      case 'shot':
        if (mine(e.shooter)) {
          this.renderer.viewModel.onShot();
          this.sound.shot();
        } else {
          this.renderer.combatants.onShot(e.shooter);
          // Volume cai com a distância (inverso, com piso)
          const me = this.sim.player.eyePosition();
          const d = Math.hypot(e.origin.x - me.x, e.origin.z - me.z);
          this.sound.shot(Math.min(0.8, 6 / Math.max(6, d)));
        }
        break;
      case 'impact':
        if (!e.onEntity) this.renderer.impacts.add(e.point, e.normal);
        break;
      case 'hit':
        if (e.killed && !e.victim.startsWith('target:')) this.reportKill(e.attacker, e.victim, e.part === 'head');
        if (mine(e.attacker)) {
          this.hits++;
          if (e.killed) this.kills++;
          this.hud?.showHit(e.part === 'head', e.killed);
          this.sound.hit(e.part === 'head', e.killed);
        }
        if (e.victim.startsWith('target:')) this.renderer.targets.onHit(Number(e.victim.slice(7)));
        else if (mine(e.victim)) {
          this.hud?.showHurt();
          this.sound.hurt();
        } else this.renderer.combatants.onHit(e.victim);
        break;
      case 'dryFire':
        if (mine(e.shooter)) this.sound.dryFire();
        break;
      case 'reloadStart':
        if (mine(e.shooter)) this.sound.reload(e.duration);
        break;
      case 'respawn':
        if (mine(e.id)) {
          // Renasceu: visão volta para a direção do spawn
          this.view = { yaw: this.sim.human.respawnYaw, pitch: 0 };
          this.currEye = this.prevEye = this.sim.player.eyePosition();
        }
        break;
      case 'bombPlanted':
        this.sound.bombEvent(true);
        break;
      case 'bombDefused':
        this.sound.bombEvent(false);
        break;
      case 'bombExploded': {
        this.renderer.bomb.explode();
        const me = this.sim.player.eyePosition();
        const d = Math.hypot(e.position.x - me.x, e.position.z - me.z);
        this.sound.explosion(Math.min(1, 15 / Math.max(15, d)));
        if (d < 35) this.roundHud?.explosion();
        break;
      }
      case 'roundEnd':
        this.roundHud?.showRoundEnd(e.winner, e.reason, this.sim.human.team);
        this.sound.roundEnd(e.winner === this.sim.human.team);
        break;
      case 'matchEnd':
        if (this.sim.rounds) this.roundHud?.showMatchEnd(e.winner, this.sim.rounds.state, this.sim.human.team);
        break;
      case 'halftime':
        this.roundHud?.showHalftime(this.sim.human.team);
        break;
      case 'reloadEnd':
      case 'roundStart':
      case 'freezeEnd':
      case 'bombPickup':
      case 'bombDropped':
        break;
    }
  }

  private frame(): void {
    const dt = Math.min(this.renderer.engine.getDeltaTime() / 1000, 0.1);
    const look = this.input.consumeLook();
    let alpha = 1;

    if (this.running) {
      this.view.yaw = (this.view.yaw + look.yaw) % (Math.PI * 2);
      this.view.pitch = clamp(this.view.pitch + look.pitch, -LOOK.maxPitch, LOOK.maxPitch);
      this.input.pollFrame();
      alpha = this.loop.advance(dt);
    }

    const eye = {
      x: lerp(this.prevEye.x, this.currEye.x, alpha),
      y: lerp(this.prevEye.y, this.currEye.y, alpha),
      z: lerp(this.prevEye.z, this.currEye.z, alpha),
    };
    const human = this.sim.human;
    const p = this.sim.player.state;
    const w = this.sim.weapon.state;
    if (!human.alive) {
      // Câmera de morte: desce até perto do chão
      const t = Math.min(1, (this.sim.time - human.diedAt) * 2);
      eye.y = lerp(eye.y, p.feet.y + 0.35, t);
    }
    const lerpFeet = (id: EntityId) => {
      const a = this.prevFeet.get(id);
      const b = this.currFeet.get(id)!;
      if (!a) return b;
      return { x: lerp(a.x, b.x, alpha), y: lerp(a.y, b.y, alpha), z: lerp(a.z, b.z, alpha) };
    };
    this.renderer.combatants.update(dt, this.sim.bots.map((b) => viewOf(b.combatant)), lerpFeet);
    const speedNorm = clamp(Math.hypot(p.velocity.x, p.velocity.z) / MOVE.runSpeed, 0, 1);

    this.renderer.targets.update(dt, this.sim.targets.targets);
    this.renderer.viewModel.setTeam(human.team);
    this.renderer.viewModel.setVisible(human.alive);
    this.renderer.viewModel.update(dt, w, speedNorm, p.grounded);
    // O recuo desloca a câmera junto com a mira dos tiros
    this.renderer.render(eye, this.view.yaw + w.recoilYaw, this.view.pitch + w.recoilPitch);

    const spreadPx = this.sim.weapon.currentSpread(p) * this.renderer.pixelsPerRadian();
    this.hud?.update(dt, w, spreadPx);
    this.hud?.updateStatus(
      dt,
      human.health,
      human.maxHealth,
      human.alive,
      this.sim.rounds ? -1 : human.respawnSeconds - (this.sim.time - human.diedAt),
      human.kills,
      human.deaths,
    );

    const rounds = this.sim.rounds;
    if (rounds) {
      const bomb = rounds.bomb;
      const live = rounds.state.phase === 'live' && human.alive;
      let action: BombAction = null;
      if (live && bomb.status === 'carried' && bomb.carrier === human.id && inSite(rounds.bombsites, p.feet)) action = 'plant';
      else if (
        live &&
        human.team === 'defense' &&
        bomb.status === 'planted' &&
        Math.hypot(p.feet.x - bomb.position.x, p.feet.z - bomb.position.z) < ROUND.defuseRange
      )
        action = 'defuse';
      document.body.classList.toggle('can-use', action !== null);
      this.touch?.setUseLabel(action === 'defuse' ? 'Desarmar' : 'Plantar');
      this.roundHud?.update(dt, rounds.state, bomb, this.sim.combatants(), human, action);
      if (this.renderer.bomb.update(dt, bomb)) this.sound.beep();
    }
    this.updateMinimap(dt, lerpFeet);
    this.killFeed?.update(dt);
    this.updateAllyTags(lerpFeet);
    this.debug?.update(dt, this.renderer.engine, p, this.instrumentation?.drawCallsCounter.current ?? 0);
  }
}
