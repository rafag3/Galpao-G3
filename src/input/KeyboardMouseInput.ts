// Teclado + mouse (PC). Mouse usa Pointer Lock para giro ilimitado.

import { settings } from '../core/Settings';
import { noPressed, type InputSource, type MoveIntent, type PressedActions } from './InputIntents';

const MOUSE_SENS = 0.0022; // rad por pixel, multiplicado pela preferência

export class KeyboardMouseInput implements InputSource {
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private pressed: PressedActions = noPressed();
  private mouseFire = false;
  private readonly abort = new AbortController();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const opts = { signal: this.abort.signal };

    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        this.keys.add(e.code);
        if (e.code === 'Space') this.pressed.jump = true;
        if (e.code === 'KeyR') this.pressed.reload = true;
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      },
      opts,
    );
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), opts);
    // Ao perder o foco, solta tudo (evita personagem andando ou atirando sozinho)
    window.addEventListener(
      'blur',
      () => {
        this.keys.clear();
        this.mouseFire = false;
      },
      opts,
    );

    document.addEventListener(
      'mousemove',
      (e) => {
        if (!this.locked) return;
        const k = MOUSE_SENS * settings.mouseSensitivity;
        this.yaw += e.movementX * k;
        this.pitch += e.movementY * k;
      },
      opts,
    );
    document.addEventListener(
      'mousedown',
      (e) => {
        if (this.locked && e.button === 0) this.mouseFire = this.pressed.fire = true;
      },
      opts,
    );
    document.addEventListener('mouseup', (e) => e.button === 0 && (this.mouseFire = false), opts);
    document.addEventListener('pointerlockchange', () => !this.locked && (this.mouseFire = false), opts);
  }

  private get locked() {
    return document.pointerLockElement === this.canvas;
  }

  /** Pede pointer lock. Só funciona dentro de um gesto do usuário. */
  requestLock(): void {
    if (this.locked) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      /* navegador sem suporte: segue sem lock */
    }
  }

  private has(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  sample(into: MoveIntent): void {
    into.moveZ += (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
    into.moveX += (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    into.run ||= this.has('ShiftLeft', 'ShiftRight');
    // Ctrl foi evitado de propósito: Ctrl+W fecha a aba do navegador.
    into.crouch ||= this.has('KeyC');
    into.fire ||= this.mouseFire;
  }

  consumeLook() {
    const out = { yaw: this.yaw, pitch: this.pitch };
    this.yaw = 0;
    this.pitch = 0;
    return out;
  }

  consumePressed(): PressedActions {
    const p = this.pressed;
    this.pressed = noPressed();
    return p;
  }

  dispose(): void {
    this.abort.abort();
  }
}
