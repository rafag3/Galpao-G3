// Controles touch: joystick flutuante à esquerda, área de mira à direita e
// botões de ação. Usa Pointer Events para multitoque (mover, mirar e atirar
// ao mesmo tempo) e também mouse, o que facilita testar no PC.

import { settings } from '../core/Settings';
import { noPressed, type InputSource, type MoveIntent, type PressedActions } from './InputIntents';

const LOOK_SENS = 0.0055; // rad por pixel de arraste, multiplicado pela preferência
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

  /** Dedos que estão girando a câmera → última posição. */
  private readonly lookPointers = new Map<number, { x: number; y: number }>();
  private yaw = 0;
  private pitch = 0;

  /** Dedos segurando algum botão de tiro. */
  private readonly firePointers = new Set<number>();
  private pressed: PressedActions = noPressed();
  private crouchToggled = false;
  private useHeld = false;
  private readonly useBtn: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    const opts = { signal: this.abort.signal };
    this.root = el('div', 'touch-root');

    const moveZone = el('div', 'touch-zone touch-move');
    const lookZone = el('div', 'touch-zone touch-look');
    this.joyBase = el('div', 'joy-base');
    this.joyKnob = el('div', 'joy-knob');
    this.joyBase.append(this.joyKnob);
    moveZone.append(this.joyBase);

    const fireBtn = button('touch-btn btn-fire', 'Atirar');
    const reloadBtn = button('touch-btn btn-reload', 'Recarregar');
    const jumpBtn = button('touch-btn btn-jump', 'Pular');
    const useBtn = button('touch-btn btn-use', 'Plantar');
    this.useBtn = useBtn;
    const crouchBtn = button('touch-btn btn-crouch', 'Agachar');

    this.root.append(moveZone, lookZone, fireBtn, reloadBtn, jumpBtn, crouchBtn, useBtn);
    parent.append(this.root);

    // ---- Joystick flutuante: nasce onde o polegar toca
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
      (e) => e.pointerId === this.joyId && this.updateJoy(e.clientX, e.clientY),
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

    // ---- Mira por arraste
    this.bindLook(lookZone, opts);

    // ---- Tiro. O botão também mira enquanto está pressionado:
    // o jogador corrige a mira sem tirar o polegar do gatilho.
    {
      const btn = fireBtn;
      btn.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          btn.setPointerCapture(e.pointerId);
          this.firePointers.add(e.pointerId);
          this.pressed.fire = true;
          btn.classList.add('on');
          this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        },
        opts,
      );
      btn.addEventListener('pointermove', (e) => this.moveLook(e), opts);
      const end = (e: PointerEvent) => {
        this.firePointers.delete(e.pointerId);
        this.lookPointers.delete(e.pointerId);
        btn.classList.remove('on');
      };
      btn.addEventListener('pointerup', end, opts);
      btn.addEventListener('pointercancel', end, opts);
    }

    // Plantar: segurar (só aparece quando dá para plantar, via body.can-plant)
    useBtn.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        useBtn.setPointerCapture(e.pointerId);
        this.useHeld = true;
      },
      opts,
    );
    const endUse = () => (this.useHeld = false);
    useBtn.addEventListener('pointerup', endUse, opts);
    useBtn.addEventListener('pointercancel', endUse, opts);

    tapButton(reloadBtn, () => (this.pressed.reload = true), opts);
    tapButton(jumpBtn, () => (this.pressed.jump = true), opts);
    // Agachar alterna: segurar um botão ocuparia o polegar da mira
    tapButton(
      crouchBtn,
      () => {
        this.crouchToggled = !this.crouchToggled;
        crouchBtn.classList.toggle('on', this.crouchToggled);
      },
      opts,
    );

    // Impede menu de contexto e seleção em toque longo
    this.root.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
  }

  private bindLook(zone: HTMLElement, opts: AddEventListenerOptions) {
    zone.addEventListener(
      'pointerdown',
      (e) => {
        zone.setPointerCapture(e.pointerId);
        this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      },
      opts,
    );
    zone.addEventListener('pointermove', (e) => this.moveLook(e), opts);
    const end = (e: PointerEvent) => this.lookPointers.delete(e.pointerId);
    zone.addEventListener('pointerup', end, opts);
    zone.addEventListener('pointercancel', end, opts);
  }

  private moveLook(e: PointerEvent) {
    const last = this.lookPointers.get(e.pointerId);
    if (!last) return;
    const k = LOOK_SENS * settings.touchSensitivity;
    this.yaw += (e.clientX - last.x) * k;
    this.pitch += (e.clientY - last.y) * k;
    this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    into.fire ||= this.firePointers.size > 0;
    into.use ||= this.useHeld;
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

  /** Rótulo do botão de ação: "Plantar" no ataque, "Desarmar" na defesa. */
  setUseLabel(label: string): void {
    if (this.useBtn.textContent !== label) this.useBtn.textContent = label;
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

function tapButton(btn: HTMLButtonElement, onTap: () => void, opts: AddEventListenerOptions) {
  btn.addEventListener(
    'pointerdown',
    (e) => {
      e.preventDefault();
      onTap();
    },
    opts,
  );
}
