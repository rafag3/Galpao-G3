// Orquestra input → simulação (passo fixo) → eventos → render/áudio/HUD.

import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { SoundFx } from '../audio/SoundFx';
import { InputManager } from '../input/InputManager';
import { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { TouchInput } from '../input/TouchInput';
import type { LevelData } from '../level/LevelData';
import { GameRenderer } from '../render/GameRenderer';
import { LOOK, MOVE, SIM_DT } from '../sim/config';
import { viewOf } from '../sim/Combatant';
import type { EntityId, SimEvent } from '../sim/events';
import { GameSim } from '../sim/GameSim';
import { clamp, lerp, type Vec3 } from '../sim/math';
import { initPhysics } from '../sim/PhysicsWorld';
import { DebugHud } from '../ui/DebugHud';
import { Hud } from '../ui/Hud';
import { StartOverlay } from '../ui/StartOverlay';
import { FixedStepLoop } from './FixedStepLoop';

export const isTouchDevice = () =>
  window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

export class Game {
  private sim!: GameSim;
  private renderer!: GameRenderer;
  private readonly input = new InputManager();
  private readonly sound = new SoundFx();
  private loop!: FixedStepLoop;
  private keyboard?: KeyboardMouseInput;
  private debug?: DebugHud;
  private hud?: Hud;
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

  async init(level: LevelData): Promise<void> {
    await initPhysics();
    this.sim = new GameSim(level);
    this.renderer = new GameRenderer(this.canvas, level, this.sim.targets.targets);
    this.currEye = this.prevEye = this.sim.player.eyePosition();
    this.view = { yaw: level.spawnYaw, pitch: 0 };

    const touch = isTouchDevice();
    if (touch) {
      document.body.classList.add('is-touch');
      this.input.add(new TouchInput(this.uiRoot));
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
    });

    const pause = () => {
      if (!this.running) return;
      this.running = false;
      overlay.show();
    };
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

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => this.renderer.resize());

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
      get running() {
        return game.running;
      },
    };
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
      case 'reloadEnd':
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
      human.respawnSeconds - (this.sim.time - human.diedAt),
      human.kills,
      human.deaths,
    );
    this.debug?.update(dt, this.renderer.engine, p, this.instrumentation?.drawCallsCounter.current ?? 0);
  }
}
