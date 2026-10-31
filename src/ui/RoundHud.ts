// HUD da rodada: placar, cronômetro, vivos por equipe, estado da bomba,
// progresso de plantio, avisos, resultado da rodada e fim de partida.

import type { Combatant, Team } from '../sim/Combatant';
import { ROUND } from '../sim/config';
import { displayName } from './names';
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
  /** Seu time sempre à esquerda; o adversário à direita. */
  private readonly mySquad: HTMLDivElement;
  private readonly enemySquad: HTMLDivElement;
  private readonly myScore: HTMLDivElement;
  private readonly enemyScore: HTMLDivElement;
  private readonly clock: HTMLDivElement;
  private readonly roundLabel: HTMLSpanElement;
  private readonly clockTime: HTMLSpanElement;
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
    // Placar: [seu time: um ícone por jogador] [placar] [rodada e relógio] [placar] [adversários]
    this.board = div('round-board', parent);
    this.mySquad = div('squad mine', this.board);
    this.myScore = div('side-score', this.board);
    this.clock = div('clock', this.board);
    this.roundLabel = document.createElement('span');
    this.roundLabel.className = 'round-no';
    this.clockTime = document.createElement('span');
    this.clockTime.className = 'time';
    this.clock.append(this.roundLabel, this.clockTime);
    this.enemyScore = div('side-score', this.board);
    this.enemySquad = div('squad enemy', this.board);

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

  /** Um ícone por jogador: vivo na cor do lado, morto com X; o seu com contorno. */
  private renderSquad(el: HTMLDivElement, list: readonly Combatant[], human: Combatant): void {
    el.replaceChildren(
      ...list.map((c) => {
        const chip = div(`chip ${c.team === 'attack' ? 'atk' : 'def'}${c.alive ? '' : ' dead'}${c === human ? ' me' : ''}`);
        chip.textContent = c.alive ? displayName(c.id).charAt(0) : '✕';
        chip.title = displayName(c.id);
        return chip;
      }),
    );
    const n = list.filter((c) => c.alive).length;
    el.setAttribute('aria-label', `${n} ${n === 1 ? 'vivo' : 'vivos'}`);
  }

  private renderScore(el: HTMLDivElement, side: Team, score: number): void {
    el.className = `side-score ${side === 'attack' ? 'atk' : 'def'}`;
    el.innerHTML = `<b>${score}</b><small>${SIDE[side]}</small>`;
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
    // Placar e ícones: só reescreve o DOM quando algo muda
    const enemy: Team = mine === 'attack' ? 'defense' : 'attack';
    const squad = (t: Team) => {
      const list = all.filter((c) => c.team === t);
      // O jogador primeiro no próprio time
      return list.sort((a, b) => (a === human ? -1 : b === human ? 1 : 0));
    };
    const key = `${state.score.attack}|${state.score.defense}|${mine}|${state.round}|${all.map((c) => `${c.id}${c.team[0]}${c.alive ? 1 : 0}`).join()}`;
    if (key !== this.lastKey) {
      this.renderSquad(this.mySquad, squad(mine), human);
      this.renderSquad(this.enemySquad, squad(enemy), human);
      this.renderScore(this.myScore, mine, state.score[mine]);
      this.renderScore(this.enemyScore, enemy, state.score[enemy]);
      this.roundLabel.textContent = `Rodada ${state.round}`;
      this.lastKey = key;
    }

    // Rodada encerrada (por eliminação, por exemplo): a bomba que sobrou não conta mais
    const planted = bomb.status === 'planted' && state.phase === 'live';
    this.clock.classList.toggle('bomb', planted);
    if (state.phase === 'freeze') this.clockTime.textContent = `Preparação ${Math.ceil(state.timeLeft)}`;
    else if (planted) this.clockTime.textContent = `Bomba ${mmss(bomb.timeLeft)}`;
    else if (state.phase === 'live') this.clockTime.textContent = mmss(state.timeLeft);
    else this.clockTime.textContent = 'Fim da rodada';

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
    if (!live) {
      // Fim de rodada: só o banner fala
    } else if (state.phase === 'freeze' && (state.round === 1 || state.round === ROUND.halftimeAfterRound + 1))
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
