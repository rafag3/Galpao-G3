// Orquestra input → simulação (passo fixo) → eventos → render/áudio/HUD.

import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { SoundFx } from '../audio/SoundFx';
import { InputManager } from '../input/InputManager';
import { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { TouchInput } from '../input/TouchInput';
import type { LevelData } from '../level/LevelData';
import { GameRenderer } from '../render/GameRenderer';
import { LOOK, MOVE, SIM_DT } from '../sim/config';
import type { SimEvent } from '../sim/events';
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

    this.loop = new FixedStepLoop(SIM_DT, (dt) => {
      this.prevEye = this.currEye;
      this.sim.tick(this.input.sampleTick(this.view.yaw, this.view.pitch), dt);
      this.currEye = this.sim.player.eyePosition();
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
        return { hits: game.hits, kills: game.kills };
      },
      get running() {
        return game.running;
      },
    };
  }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'shot':
        this.renderer.viewModel.onShot();
        this.sound.shot();
        break;
      case 'impact':
        if (!e.onTarget) this.renderer.impacts.add(e.point, e.normal);
        break;
      case 'hit':
        this.hits++;
        if (e.killed) this.kills++;
        this.renderer.targets.onHit(e.targetId);
        this.hud?.showHit(e.part === 'head', e.killed);
        this.sound.hit(e.part === 'head', e.killed);
        break;
      case 'dryFire':
        this.sound.dryFire();
        break;
      case 'reloadStart':
        this.sound.reload(e.duration);
        break;
      case 'reloadEnd':
      case 'targetRespawn':
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
    const p = this.sim.player.state;
    const w = this.sim.weapon.state;
    const speedNorm = clamp(Math.hypot(p.velocity.x, p.velocity.z) / MOVE.runSpeed, 0, 1);

    this.renderer.targets.update(dt, this.sim.targets.targets);
    this.renderer.viewModel.update(dt, w, speedNorm, p.grounded);
    // O recuo desloca a câmera junto com a mira dos tiros
    this.renderer.render(eye, this.view.yaw + w.recoilYaw, this.view.pitch + w.recoilPitch);

    const spreadPx = this.sim.weapon.currentSpread(p) * this.renderer.pixelsPerRadian();
    this.hud?.update(dt, w, spreadPx);
    this.debug?.update(dt, this.renderer.engine, p, this.instrumentation?.drawCallsCounter.current ?? 0);
  }
}
