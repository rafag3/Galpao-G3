// HUD da rodada: placar, cronômetro, vivos por equipe, estado da bomba,
// progresso de plantio, avisos, resultado da rodada e fim de partida.

import type { Combatant, Team } from '../sim/Combatant';
import { ROUND } from '../sim/config';
import type { RoundEndReason } from '../sim/events';
import type { BombState, RoundState } from '../sim/RoundSystem';

const REASON: Record<RoundEndReason, string> = {
  elimination: 'eliminação',
  bomb: 'a bomba explodiu',
  defused: 'bomba desarmada',
  time: 'tempo esgotado',
};

/** Nomes na tela: TR (ataque) e CT (defesa). */
const SIDE: Record<Team, string> = { attack: 'TR', defense: 'CT' };

/** O que o jogador pode fazer agora com a bomba. */
export type BombAction = 'plant' | 'defuse' | null;

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
  private readonly atk: HTMLDivElement;
  private readonly def: HTMLDivElement;
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
    const atk = (this.atk = div('team atk', this.board));
    this.atkScore = document.createElement('span');
    this.atkScore.className = 'score';
    this.atkAlive = div('alive', atk);
    atk.prepend(this.atkScore);
    this.clock = div('clock', this.board);
    const def = (this.def = div('team def', this.board));
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

  showRoundEnd(winner: Team, reason: RoundEndReason, mine: Team): void {
    const won = winner === mine;
    this.banner.className = `round-banner show ${won ? 'win' : 'loss'}`;
    this.banner.textContent = `${SIDE[winner]} vence · ${REASON[reason]}`;
    this.bannerTimer = ROUND.postRoundSeconds - 0.5;
  }

  /** Intervalo: avisa o novo lado do jogador. */
  showHalftime(mine: Team): void {
    this.banner.className = 'round-banner show';
    this.banner.textContent = `Troca de lado · agora você é ${SIDE[mine]}`;
    this.bannerTimer = ROUND.freezeSeconds + 0.5;
  }

  showMatchEnd(winner: Team, state: RoundState, mine: Team): void {
    const enemy: Team = mine === 'attack' ? 'defense' : 'attack';
    this.matchScreen.querySelector('h1')!.textContent = winner === mine ? 'Vitória' : 'Derrota';
    this.matchScreen.querySelector('.phase')!.textContent = `Seu time ${state.score[mine]} × ${state.score[enemy]} Adversários`;
    this.matchScreen.classList.remove('hidden');
  }

  /** Partida recomeçada pelo menu: some com o fim de partida e o banner. */
  reset(): void {
    this.matchScreen.classList.add('hidden');
    this.banner.classList.remove('show');
    this.bannerTimer = 0;
  }

  explosion(): void {
    this.flashTimer = 0.9;
  }

  update(dt: number, state: RoundState, bomb: BombState, all: readonly Combatant[], human: Combatant, action: BombAction): void {
    const mine = human.team;
    const canPlant = action === 'plant';
    // Placar e vivos: só reescreve o DOM quando algo muda
    const alive = (t: 'attack' | 'defense') =>
      all
        .filter((c) => c.team === t)
        .map((c) => (c.alive ? '●' : '○'))
        .join('');
    const key = `${state.score.attack}|${state.score.defense}|${alive('attack')}|${alive('defense')}|${mine}`;
    if (key !== this.lastKey) {
      this.atk.classList.toggle('mine', mine === 'attack');
      this.def.classList.toggle('mine', mine === 'defense');
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
    const live = state.phase === 'live' || state.phase === 'freeze';
    this.carrier.classList.toggle('show', live && (carrying || action === 'defuse'));
    this.carrier.classList.toggle('in-site', action !== null);
    this.carrier.textContent =
      action === 'defuse' ? 'Na bomba: segure Desarmar' : canPlant ? 'No site: segure Plantar' : 'Você está com a bomba';

    // Barra de progresso: plantio ou desarme do jogador
    const planting = carrying && bomb.plantProgress > 0;
    const defusing = planted && bomb.defuser === human.id && bomb.defuseProgress > 0;
    this.progress.classList.toggle('show', planting || defusing);
    if (planting || defusing) {
      this.progressLabel.textContent = planting ? 'Plantando…' : 'Desarmando…';
      this.progressFill.style.transform = `scaleX(${planting ? bomb.plantProgress : bomb.defuseProgress})`;
    }

    // Avisos, do ponto de vista do lado do jogador
    const attacking = mine === 'attack';
    let alert = '';
    let danger = false;
    if (state.phase === 'freeze' && (state.round === 1 || state.round === ROUND.halftimeAfterRound + 1))
      alert = attacking ? 'Plante a bomba no A ou no B' : 'Defenda os sites A e B';
    else if (planted && bomb.defuser && bomb.defuser !== human.id) {
      alert = attacking ? 'Os CTs estão desarmando!' : 'Um aliado está desarmando';
      danger = attacking;
    } else if (planted && !attacking && !bomb.defuser) {
      alert = `Bomba plantada no ${bomb.site}: desarme!`;
      danger = true;
    } else if (bomb.status === 'dropped') alert = attacking ? 'Bomba caída: um aliado vai buscar' : 'Os TRs deixaram a bomba cair';
    this.alert.textContent = alert;
    this.alert.classList.toggle('show', !!alert);
    this.alert.classList.toggle('danger', danger);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.flash.style.opacity = String(Math.min(1, this.flashTimer * 1.5));
  }
}
