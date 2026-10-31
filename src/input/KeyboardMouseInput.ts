// Teclado + mouse (PC). Mouse usa Pointer Lock para giro ilimitado.

import type { InputSource, MoveIntent } from './InputIntents';

const MOUSE_SENS = 0.0022; // rad por pixel

export class KeyboardMouseInput implements InputSource {
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private jumpQueued = false;
  private readonly abort = new AbortController();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const opts = { signal: this.abort.signal };

    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        this.keys.add(e.code);
        if (e.code === 'Space') this.jumpQueued = true;
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      },
      opts,
    );
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), opts);
    // Ao perder o foco, solta tudo (evita personagem andando sozinho)
    window.addEventListener('blur', () => this.keys.clear(), opts);

    document.addEventListener(
      'mousemove',
      (e) => {
        if (document.pointerLockElement !== this.canvas) return;
        this.yaw += e.movementX * MOUSE_SENS;
        this.pitch += e.movementY * MOUSE_SENS;
      },
      opts,
    );
  }

  /** Pede pointer lock. Só funciona dentro de um gesto do usuário. */
  requestLock(): void {
    if (document.pointerLockElement === this.canvas) return;
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
  }

  consumeLook() {
    const out = { yaw: this.yaw, pitch: this.pitch };
    this.yaw = 0;
    this.pitch = 0;
    return out;
  }

  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  dispose(): void {
    this.abort.abort();
  }
}
