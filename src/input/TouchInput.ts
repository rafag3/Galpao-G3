// Controles touch: joystick flutuante à esquerda, área de mira à direita e
// botões de ação. Usa Pointer Events para suportar multitoque (mover e mirar
// ao mesmo tempo) e também mouse, o que facilita testar no PC.

import type { InputSource, MoveIntent } from './InputIntents';

const LOOK_SENS = 0.0055; // rad por pixel de arraste
const JOY_RADIUS = 60; // px
const RUN_THRESHOLD = 0.92; // joystick quase no limite = correr

export class TouchInput implements InputSource {
  readonly root: HTMLDivElement;
  private readonly abort = new AbortController();

  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;

  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private yaw = 0;
  private pitch = 0;

  private jumpQueued = false;
  private crouchToggled = false;
  private readonly crouchBtn: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    const opts = { signal: this.abort.signal };
    this.root = el('div', 'touch-root');

    const moveZone = el('div', 'touch-zone touch-move');
    const lookZone = el('div', 'touch-zone touch-look');
    this.joyBase = el('div', 'joy-base');
    this.joyKnob = el('div', 'joy-knob');
    this.joyBase.append(this.joyKnob);
    moveZone.append(this.joyBase);

    const jumpBtn = button('touch-btn btn-jump', 'Pular');
    this.crouchBtn = button('touch-btn btn-crouch', 'Agachar');

    this.root.append(moveZone, lookZone, jumpBtn, this.crouchBtn);
    parent.append(this.root);

    // Joystick flutuante: nasce onde o polegar toca
    moveZone.addEventListener(
      'pointerdown',
      (e) => {
        if (this.joyId !== null) return;
        this.joyId = e.pointerId;
        moveZone.setPointerCapture(e.pointerId);
        this.joyOrigin = { x: e.clientX, y: e.clientY };
        this.joyBase.style.left = `${e.clientX}px`;
        this.joyBase.style.top = `${e.clientY}px`;
        this.joyBase.classList.add('active');
        this.updateJoy(e.clientX, e.clientY);
      },
      opts,
    );
    moveZone.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId === this.joyId) this.updateJoy(e.clientX, e.clientY);
      },
      opts,
    );
    const endJoy = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.joyVec = { x: 0, y: 0 };
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
      this.joyBase.classList.remove('active');
    };
    moveZone.addEventListener('pointerup', endJoy, opts);
    moveZone.addEventListener('pointercancel', endJoy, opts);

    // Mira: arraste relativo
    lookZone.addEventListener(
      'pointerdown',
      (e) => {
        if (this.lookId !== null) return;
        this.lookId = e.pointerId;
        lookZone.setPointerCapture(e.pointerId);
        this.lookLast = { x: e.clientX, y: e.clientY };
      },
      opts,
    );
    lookZone.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId !== this.lookId) return;
        this.yaw += (e.clientX - this.lookLast.x) * LOOK_SENS;
        this.pitch += (e.clientY - this.lookLast.y) * LOOK_SENS;
        this.lookLast = { x: e.clientX, y: e.clientY };
      },
      opts,
    );
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    lookZone.addEventListener('pointerup', endLook, opts);
    lookZone.addEventListener('pointercancel', endLook, opts);

    jumpBtn.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        this.jumpQueued = true;
      },
      opts,
    );
    // Agachar é alternância no touch: segurar um botão ocupa o polegar da mira
    this.crouchBtn.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        this.crouchToggled = !this.crouchToggled;
        this.crouchBtn.classList.toggle('on', this.crouchToggled);
      },
      opts,
    );

    // Impede menu de contexto/seleção em toque longo
    this.root.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
  }

  private updateJoy(x: number, y: number) {
    let dx = x - this.joyOrigin.x;
    let dy = y - this.joyOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      dx = (dx / d) * JOY_RADIUS;
      dy = (dy / d) * JOY_RADIUS;
    }
    this.joyVec = { x: dx / JOY_RADIUS, y: dy / JOY_RADIUS };
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  sample(into: MoveIntent): void {
    into.moveX += this.joyVec.x;
    into.moveZ += -this.joyVec.y; // tela: y para baixo; jogo: frente = +Z
    into.run ||= Math.hypot(this.joyVec.x, this.joyVec.y) >= RUN_THRESHOLD;
    into.crouch ||= this.crouchToggled;
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
    this.root.remove();
  }
}

function el(tag: 'div', className: string): HTMLDivElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function button(className: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('aria-label', label);
  return b;
}
