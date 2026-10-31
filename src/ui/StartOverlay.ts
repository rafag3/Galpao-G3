// Tela inicial e de pausa, com as opções de sensibilidade e volume.
// O botão "Jogar" é o gesto do usuário que os navegadores exigem para tela
// cheia, trava de orientação, pointer lock e áudio.

import { saveSettings, settings } from '../core/Settings';

export interface StartOptions {
  isTouch: boolean;
  onStart: () => void;
  onVolumeChange: (v: number) => void;
}

export class StartOverlay {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly opts: StartOptions) {
    const sensKey = opts.isTouch ? 'touchSensitivity' : 'mouseSensitivity';
    this.root = document.createElement('div');
    this.root.className = 'overlay start';
    this.root.innerHTML = `
      <div class="start-card">
        <h1>Galpão G3</h1>
        <p class="phase">Modo bomba · 3 contra 3</p>
        <button type="button" class="start-btn">Jogar</button>
        <div class="settings">
          <label>Sensibilidade ${opts.isTouch ? 'do toque' : 'do mouse'}
            <input type="range" name="sens" min="0.3" max="3" step="0.05" value="${settings[sensKey]}">
            <output>${settings[sensKey].toFixed(2)}</output>
          </label>
          <label>Volume
            <input type="range" name="vol" min="0" max="1" step="0.05" value="${settings.volume}">
            <output>${Math.round(settings.volume * 100)}%</output>
          </label>
        </div>
        <p class="hint">${
          opts.isTouch
            ? 'Polegar esquerdo move (no limite corre). Arraste à direita para mirar. O botão Atirar também mira enquanto pressionado.'
            : 'WASD move · Shift corre · Espaço pula · C agacha · Clique atira · R recarrega · E (segurar) planta · Esc pausa'
        }</p>
      </div>`;
    parent.append(this.root);

    this.root.querySelector('.start-btn')!.addEventListener('click', () => this.start());

    const [sens, vol] = this.root.querySelectorAll<HTMLInputElement>('input[type=range]');
    sens.addEventListener('input', () => {
      settings[sensKey] = Number(sens.value);
      sens.nextElementSibling!.textContent = settings[sensKey].toFixed(2);
      saveSettings();
    });
    vol.addEventListener('input', () => {
      settings.volume = Number(vol.value);
      vol.nextElementSibling!.textContent = `${Math.round(settings.volume * 100)}%`;
      saveSettings();
      opts.onVolumeChange(settings.volume);
    });
  }

  show(label = 'Continuar'): void {
    this.root.querySelector('.start-btn')!.textContent = label;
    this.root.classList.remove('hidden');
  }

  private async start(): Promise<void> {
    this.root.classList.add('hidden');
    // onStart primeiro: áudio e pointer lock precisam do gesto ainda "vivo"
    this.opts.onStart();
    if (this.opts.isTouch) await enterFullscreenLandscape();
  }
}

async function enterFullscreenLandscape(): Promise<void> {
  // Cada passo pode falhar (iOS Safari não tem Fullscreen API em iPhone nem
  // orientation.lock). Falhar aqui não pode impedir o jogo de começar.
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* sem suporte */
  }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch {
    /* sem suporte ou fora de tela cheia */
  }
}
