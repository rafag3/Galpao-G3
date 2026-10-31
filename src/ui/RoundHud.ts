// HUD da rodada: placar, cronômetro, vivos por equipe, estado da bomba,
// progresso de plantio, avisos, resultado da rodada e fim de partida.

import type { Combatant } from '../sim/Combatant';
import { ROUND } from '../sim/config';
import type { RoundEndReason } from '../sim/events';
import type { BombState, RoundState } from '../sim/RoundSystem';

const REASON: Record<RoundEndReason, string> = {
  elimination: 'eliminação',
  bomb: 'a bomba explodiu',
  defused: 'bomba desarmada',
  time: 'tempo esgotado',
};

const mmss = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function div(className: string, parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  parent?.append(d);
  return d;
}

export class RoundHud {
  private readonly board: HTMLDivElement;
  private readonly atkScore: HTMLSpanElement;
  private readonly defScore: HTMLSpanElement;
  private readonly clock: HTMLDivElement;
  private readonly atkAlive: HTMLDivElement;
  private readonly defAlive: HTMLDivElement;
  private readonly carrier: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly progressFill: HTMLDivElement;
  private readonly progressLabel: HTMLDivElement;
  private readonly alert: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly matchScreen: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private bannerTimer = 0;
  private flashTimer = 0;
  private lastKey = '';

  constructor(parent: HTMLElement, onRestart: () => void) {
    this.board = div('round-board', parent);
    const atk = div('team atk', this.board);
    this.atkScore = document.createElement('span');
    this.atkScore.className = 'score';
    this.atkAlive = div('alive', atk);
    atk.prepend(this.atkScore);
    this.clock = div('clock', this.board);
    const def = div('team def', this.board);
    this.defScore = document.createElement('span');
    this.defScore.className = 'score';
    this.defAlive = div('alive', def);
    def.append(this.defScore);

    this.carrier = div('bomb-chip', parent);
    this.carrier.textContent = 'Você está com a bomba';

    this.progress = div('use-progress', parent);
    this.progressLabel = div('label', this.progress);
    const track = div('track', this.progress);
    this.progressFill = div('fill', track);

    this.alert = div('round-alert', parent);
    this.banner = div('round-banner', parent);
    this.flash = div('explosion-flash', parent);

    this.matchScreen = div('overlay match-over hidden', parent);
    this.matchScreen.innerHTML = `<div class="start-card"><h1></h1><p class="phase"></p><button type="button" class="start-btn">Jogar de novo</button></div>`;
    this.matchScreen.querySelector('button')!.addEventListener('click', () => {
      this.matchScreen.classList.add('hidden');
      onRestart();
    });
  }

  showRoundEnd(winner: 'attack' | 'defense', reason: RoundEndReason): void {
    const won = winner === 'attack'; // o jogador está sempre no ataque, por enquanto
    this.banner.className = `round-banner show ${won ? 'win' : 'loss'}`;
    this.banner.textContent = `${won ? 'Ataque vence' : 'Defesa vence'} · ${REASON[reason]}`;
    this.bannerTimer = ROUND.postRoundSeconds - 0.5;
  }

  showMatchEnd(winner: 'attack' | 'defense', state: RoundState): void {
    const won = winner === 'attack';
    this.matchScreen.querySelector('h1')!.textContent = won ? 'Vitória' : 'Derrota';
    this.matchScreen.querySelector('.phase')!.textContent = `Ataque ${state.score.attack} × ${state.score.defense} Defesa`;
    this.matchScreen.classList.remove('hidden');
  }

  explosion(): void {
    this.flashTimer = 0.9;
  }

  update(dt: number, state: RoundState, bomb: BombState, all: readonly Combatant[], human: Combatant, canPlant: boolean): void {
    // Placar e vivos: só reescreve o DOM quando algo muda
    const alive = (t: 'attack' | 'defense') =>
      all
        .filter((c) => c.team === t)
        .map((c) => (c.alive ? '●' : '○'))
        .join('');
    const key = `${state.score.attack}|${state.score.defense}|${alive('attack')}|${alive('defense')}`;
    if (key !== this.lastKey) {
      this.atkScore.textContent = String(state.score.attack);
      this.defScore.textContent = String(state.score.defense);
      this.atkAlive.textContent = alive('attack');
      this.defAlive.textContent = alive('defense');
      this.lastKey = key;
    }

    const planted = bomb.status === 'planted';
    this.clock.classList.toggle('bomb', planted);
    if (state.phase === 'freeze') this.clock.textContent = `Preparação ${Math.ceil(state.timeLeft)}`;
    else if (planted) this.clock.textContent = `Bomba ${mmss(bomb.timeLeft)}`;
    else if (state.phase === 'live') this.clock.textContent = mmss(state.timeLeft);
    else this.clock.textContent = 'Fim da rodada';

    const carrying = bomb.status === 'carried' && bomb.carrier === human.id && human.alive;
    this.carrier.classList.toggle('show', carrying && state.phase !== 'over');
    this.carrier.classList.toggle('in-site', canPlant);
    this.carrier.textContent = canPlant ? 'No site: segure Plantar' : 'Você está com a bomba';

    // Barra de progresso: plantio do jogador
    const planting = carrying && bomb.plantProgress > 0;
    this.progress.classList.toggle('show', planting);
    if (planting) {
      this.progressLabel.textContent = 'Plantando…';
      this.progressFill.style.transform = `scaleX(${bomb.plantProgress})`;
    }

    // Avisos
    let alert = '';
    if (state.phase === 'freeze' && state.round === 1) alert = 'Plante a bomba no A ou no B';
    else if (planted && bomb.defuser) alert = 'A defesa está desarmando!';
    else if (bomb.status === 'dropped') alert = 'Bomba caída: um aliado vai buscar';
    this.alert.textContent = alert;
    this.alert.classList.toggle('show', !!alert);
    this.alert.classList.toggle('danger', planted && !!bomb.defuser);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.flash.style.opacity = String(Math.min(1, this.flashTimer * 1.5));
  }
}
