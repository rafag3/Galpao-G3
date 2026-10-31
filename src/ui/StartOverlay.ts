// Tela inicial. O botão "Jogar" é o gesto do usuário que os navegadores
// exigem para tela cheia, trava de orientação, pointer lock e áudio.

export interface StartOptions {
  isTouch: boolean;
  onStart: () => void;
}

export class StartOverlay {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly opts: StartOptions) {
    this.root = document.createElement('div');
    this.root.className = 'overlay start';
    this.root.innerHTML = `
      <div class="start-card">
        <h1>Galpão G3</h1>
        <p class="phase">Fase 0 — teste de controles</p>
        <button type="button" class="start-btn">Jogar</button>
        <p class="hint">${
          opts.isTouch
            ? 'Polegar esquerdo move (até o limite = correr). Arraste à direita para mirar.'
            : 'WASD move · Shift corre · Espaço pula · C agacha · Esc libera o mouse'
        }</p>
      </div>`;
    parent.append(this.root);
    this.root.querySelector('button')!.addEventListener('click', () => this.start());
  }

  show(label = 'Continuar'): void {
    this.root.querySelector('button')!.textContent = label;
    this.root.classList.remove('hidden');
  }

  private async start(): Promise<void> {
    this.root.classList.add('hidden');
    if (this.opts.isTouch) await enterFullscreenLandscape();
    this.opts.onStart();
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
