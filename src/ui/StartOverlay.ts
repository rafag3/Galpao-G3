// Menu principal e de pausa: lado inicial, nível dos bots, Jogar, "Como
// jogar" e Opções (gráficos, sensibilidade, volume), num painel à esquerda
// que deixa a cena visível. O botão "Jogar" é o gesto do usuário que os
// navegadores exigem para tela cheia, trava de orientação, pointer lock e
// áudio.

import '@fontsource/saira/latin-400.css';
import '@fontsource/saira/latin-600.css';
import '@fontsource/saira/latin-700.css';
import '@fontsource/saira-stencil-one/latin-400.css';
import { saveSettings, settings } from '../core/Settings';
import type { Team } from '../sim/Combatant';
import { type Difficulty, ROUND } from '../sim/config';

const LEVELS: [Difficulty, string][] = [
  ['easy', 'Fácil'],
  ['normal', 'Normal'],
  ['hard', 'Difícil'],
];

type View = 'main' | 'howto' | 'options';

export interface StartOptions {
  isTouch: boolean;
  onStart: () => void;
  onVolumeChange: (v: number) => void;
  onDifficultyChange: (d: Difficulty) => void;
  /** Lado inicial mudou: recomeça a partida. */
  onSideChange: (side: Team) => void;
  /** "Recomeçar partida" no menu de pausa. */
  onRestart: () => void;
}

const radio = (attr: string, value: string, checked: boolean, inner: string, cls = '') =>
  `<button type="button" role="radio" class="${cls}" data-${attr}="${value}" aria-checked="${checked}">${inner}</button>`;

function controlsHtml(isTouch: boolean): string {
  const rows: [string, string][] = isTouch
    ? [
        ['Andar', 'Polegar esquerdo em qualquer ponto da metade esquerda; no limite do círculo você corre'],
        ['Mirar', 'Arraste na metade direita'],
        ['Atirar', 'Segure Atirar; arrastar o dedo no botão também mira'],
        ['Plantar e desarmar', 'Segure o botão que aparece no site ou perto da bomba'],
        ['Agachar', 'Toque para alternar'],
      ]
    : [
        ['Andar e correr', 'WASD, Shift para correr'],
        ['Mirar e atirar', 'Mouse; clique atira, segurar é automático'],
        ['Plantar e desarmar', 'Segure E'],
        ['Agachar, pular, recarregar', 'C, Espaço, R'],
        ['Pausar', 'Esc'],
      ];
  return rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

export class StartOverlay {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly opts: StartOptions) {
    const sensKey = opts.isTouch ? 'touchSensitivity' : 'mouseSensitivity';
    const mins = Math.floor(ROUND.roundSeconds / 60);
    const secs = String(ROUND.roundSeconds % 60).padStart(2, '0');
    this.root = document.createElement('div');
    this.root.className = 'overlay start';
    this.root.innerHTML = `
      <div class="menu-panel" data-view="main">
        <section class="menu-view view-main">
          <h1 class="menu-title">Galpão G3</h1>
          <p class="menu-sub">Modo bomba, 3 contra 3. Vence quem ganhar ${ROUND.winsToMatch} rodadas.</p>
          <div class="side" role="radiogroup" aria-label="Lado inicial">
            ${radio('s', 'attack', settings.side === 'attack', '<strong>TR</strong><span>Ataque: plante a bomba no A ou no B</span>', 'side-tile atk')}
            ${radio('s', 'defense', settings.side === 'defense', '<strong>CT</strong><span>Defesa: segure os sites e desarme</span>', 'side-tile def')}
          </div>
          <p class="side-note">Os times trocam de lado depois da rodada ${ROUND.halftimeAfterRound}.</p>
          <div class="menu-row">
            <span class="row-label" id="lvl-label">Nível dos bots</span>
            <div class="seg levels" role="radiogroup" aria-labelledby="lvl-label">
              ${LEVELS.map(([id, label]) => radio('d', id, settings.difficulty === id, label)).join('')}
            </div>
          </div>
          <div class="menu-actions">
            <button type="button" class="start-btn">Jogar</button>
            <button type="button" class="menu-link restart-link" hidden>Recomeçar partida</button>
            <button type="button" class="menu-link" data-go="howto">Como jogar</button>
            <button type="button" class="menu-link" data-go="options">Opções</button>
          </div>
        </section>

        <section class="menu-view view-howto" aria-labelledby="howto-title">
          <h2 id="howto-title" tabindex="-1">Como jogar</h2>
          <div class="howto-sides">
            <div class="howto-side atk">
              <h3>Como TR</h3>
              <p>Leve a bomba até o site A ou B e segure Plantar por ${ROUND.plantSeconds}&nbsp;s. Depois proteja a bomba por ${ROUND.bombSeconds}&nbsp;s até ela explodir, ou elimine os CTs.</p>
            </div>
            <div class="howto-side def">
              <h3>Como CT</h3>
              <p>Impeça o plantio até o relógio zerar (${mins}:${secs}) ou elimine os TRs. Se a bomba for plantada, chegue nela e segure Desarmar por ${ROUND.defuseSeconds}&nbsp;s.</p>
            </div>
          </div>
          <h3>Controles</h3>
          <dl class="howto-controls">${controlsHtml(opts.isTouch)}</dl>
          <h3>Dicas</h3>
          <ul class="howto-tips">
            <li>Um tiro na cabeça derruba; no corpo são três.</li>
            <li>Agachado você erra menos e fica menor, mas anda devagar.</li>
            <li>Parado, a mira assenta; correndo e pulando, os tiros se espalham.</li>
            <li>Quem morre volta na rodada seguinte.</li>
          </ul>
          <button type="button" class="menu-link back" data-go="main">Voltar</button>
        </section>

        <section class="menu-view view-options" aria-labelledby="opt-title">
          <h2 id="opt-title" tabindex="-1">Opções</h2>
          <div class="menu-row">
            <span class="row-label" id="gfx-label">Gráficos</span>
            <div class="seg graphics" role="radiogroup" aria-labelledby="gfx-label">
              ${radio('g', 'high', settings.graphics === 'high', 'Altos')}
              ${radio('g', 'low', settings.graphics === 'low', 'Leves')}
            </div>
          </div>
          <p class="side-note">Leves desliga sombras e relevo, para aparelhos mais fracos. Mudar recarrega o jogo.</p>
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
          <button type="button" class="menu-link back" data-go="main">Voltar</button>
        </section>
      </div>`;
    parent.append(this.root);
    document.body.classList.add('menu-open');

    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    const qa = <T extends Element>(s: string) => this.root.querySelectorAll<T>(s);

    q('.start-btn').addEventListener('click', () => this.start());
    q('.restart-link').addEventListener('click', () => {
      opts.onRestart();
      this.start();
    });
    qa<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.go as View)));

    const diffButtons = qa<HTMLButtonElement>('[data-d]');
    diffButtons.forEach((b) =>
      b.addEventListener('click', () => {
        settings.difficulty = b.dataset.d as Difficulty;
        saveSettings();
        diffButtons.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        opts.onDifficultyChange(settings.difficulty);
      }),
    );

    // Lado: recomeça a partida (na pausa, o botão volta a ser "Jogar")
    const sideButtons = qa<HTMLButtonElement>('[data-s]');
    sideButtons.forEach((b) =>
      b.addEventListener('click', () => {
        const side = b.dataset.s as Team;
        if (side === settings.side) return;
        settings.side = side;
        saveSettings();
        sideButtons.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        opts.onSideChange(side);
        this.setPaused(false);
      }),
    );

    // Gráficos: o cenário é montado na carga, então trocar exige recarregar
    qa<HTMLButtonElement>('[data-g]').forEach((b) =>
      b.addEventListener('click', () => {
        const g = b.dataset.g as 'high' | 'low';
        if (g === settings.graphics) return;
        settings.graphics = g;
        saveSettings();
        location.reload();
      }),
    );

    const [sens, vol] = qa<HTMLInputElement>('input[type=range]');
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

  /** Abre o menu como pausa: "Continuar", "Recomeçar partida" e aviso de que trocar de lado recomeça. */
  show(): void {
    this.go('main');
    this.setPaused(true);
    this.root.classList.remove('hidden');
    document.body.classList.add('menu-open');
  }

  private setPaused(paused: boolean): void {
    this.root.querySelector('.start-btn')!.textContent = paused ? 'Continuar' : 'Jogar';
    this.root.querySelector<HTMLButtonElement>('.restart-link')!.hidden = !paused;
    this.root.querySelector('.side-note')!.textContent = paused
      ? 'Trocar de lado aqui recomeça a partida.'
      : `Os times trocam de lado depois da rodada ${ROUND.halftimeAfterRound}.`;
  }

  private go(view: View): void {
    const panel = this.root.querySelector<HTMLElement>('.menu-panel')!;
    panel.dataset.view = view;
    panel.scrollTop = 0;
    // Foco no primeiro controle da nova tela (teclado e leitores de tela)
    panel.querySelector<HTMLElement>(`.view-${view} h2, .view-${view} .start-btn`)?.focus({ preventScroll: true });
  }

  private async start(): Promise<void> {
    this.root.classList.add('hidden');
    document.body.classList.remove('menu-open');
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
