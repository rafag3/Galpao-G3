// Orquestra input → simulação (passo fixo) → render (interpolado).

import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { InputManager } from '../input/InputManager';
import { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { TouchInput } from '../input/TouchInput';
import type { LevelData } from '../level/LevelData';
import { GameRenderer } from '../render/GameRenderer';
import { SIM_DT } from '../sim/config';
import { GameSim } from '../sim/GameSim';
import { lerp, type Vec3 } from '../sim/math';
import { initPhysics } from '../sim/PhysicsWorld';
import { DebugHud } from '../ui/DebugHud';
import { StartOverlay } from '../ui/StartOverlay';
import { FixedStepLoop } from './FixedStepLoop';

export const isTouchDevice = () =>
  window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

export class Game {
  private sim!: GameSim;
  private renderer!: GameRenderer;
  private readonly input = new InputManager();
  private loop!: FixedStepLoop;
  private keyboard?: KeyboardMouseInput;
  private hud?: DebugHud;
  private instrumentation?: SceneInstrumentation;
  private running = false;
  private prevEye: Vec3 = { x: 0, y: 0, z: 0 };
  private currEye: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
  ) {}

  async init(level: LevelData): Promise<void> {
    await initPhysics();
    this.sim = new GameSim(level);
    this.renderer = new GameRenderer(this.canvas, level);
    this.currEye = this.prevEye = this.sim.player.eyePosition();

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
      this.sim.tick(this.input.sampleTick(), dt);
      this.currEye = this.sim.player.eyePosition();
    });

    this.hud = new DebugHud(this.uiRoot);
    this.instrumentation = new SceneInstrumentation(this.renderer.scene);
    this.instrumentation.captureFrameTime = false;

    const overlay = new StartOverlay(this.uiRoot, {
      isTouch: touch,
      onStart: () => {
        this.running = true;
        if (!touch) this.keyboard?.requestLock();
      },
    });

    // PC: soltar o mouse (Esc) pausa
    document.addEventListener('pointerlockchange', () => {
      if (!touch && document.pointerLockElement !== this.canvas && this.running) {
        this.running = false;
        overlay.show();
      }
    });
    // Celular: app em segundo plano pausa
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running) {
        this.running = false;
        overlay.show();
      }
    });
    // Clique no canvas recaptura o mouse se o lock tiver caído
    this.canvas.addEventListener('click', () => {
      if (this.running && !touch) this.keyboard?.requestLock();
    });

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => this.renderer.resize());

    this.renderer.engine.runRenderLoop(() => this.frame());

    // Gancho de diagnóstico para testes automatizados (somente leitura)
    (window as unknown as { __galpao: unknown }).__galpao = {
      get state() {
        return structuredClone(game.sim.player.state);
      },
      get running() {
        return game.running;
      },
    };
    const game = this;
  }

  private frame(): void {
    const dt = this.renderer.engine.getDeltaTime() / 1000;
    const look = this.input.consumeLook();
    let alpha = 1;

    if (this.running) {
      this.sim.player.applyLook(look.yaw, look.pitch);
      this.input.pollFrame();
      alpha = this.loop.advance(dt);
    }

    const eye = {
      x: lerp(this.prevEye.x, this.currEye.x, alpha),
      y: lerp(this.prevEye.y, this.currEye.y, alpha),
      z: lerp(this.prevEye.z, this.currEye.z, alpha),
    };
    const s = this.sim.player.state;
    this.renderer.render(eye, s.yaw, s.pitch);
    this.hud?.update(dt, this.renderer.engine, s, this.instrumentation?.drawCallsCounter.current ?? 0);
  }
}
