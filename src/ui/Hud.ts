// HUD de combate: munição, recarga, mira dinâmica e marcador de acerto.
// DOM em vez de GUI do Babylon: texto nítido, CSS responsivo e barato.

import type { WeaponState } from '../sim/WeaponController';

export class Hud {
  private readonly ammo: HTMLDivElement;
  private readonly mag: HTMLSpanElement;
  private readonly reserve: HTMLSpanElement;
  private readonly reloadBar: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly health: HTMLDivElement;
  private readonly healthValue: HTMLSpanElement;
  private readonly healthBar: HTMLDivElement;
  private readonly score: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly death: HTMLDivElement;
  private hurtTimer = 0;
  private lastHealth = -1;
  private hitTimer = 0;
  private lastMag = -1;
  private lastReserve = -1;

  constructor(parent: HTMLElement) {
    this.crosshair = div('crosshair');
    for (const side of ['t', 'b', 'l', 'r']) this.crosshair.append(div(`ch ch-${side}`));

    this.hitmarker = div('hitmarker');

    this.ammo = div('hud-ammo');
    this.mag = document.createElement('span');
    this.mag.className = 'ammo-mag';
    this.reserve = document.createElement('span');
    this.reserve.className = 'ammo-reserve';
    this.reloadBar = div('reload-bar');
    this.ammo.append(this.mag, this.reserve, this.reloadBar);

    this.health = div('hud-health');
    this.healthValue = document.createElement('span');
    this.healthValue.className = 'health-value';
    const track = div('health-track');
    this.healthBar = div('health-bar');
    track.append(this.healthBar);
    this.score = div('hud-score');
    this.health.append(this.healthValue, track, this.score);

    this.vignette = div('hurt-vignette');
    this.death = div('death-screen');

    parent.append(this.vignette, this.crosshair, this.hitmarker, this.ammo, this.health, this.death);
  }

  /** Vida, placar pessoal e tela de morte (`respawnIn` < 0 = modo rodadas). */
  updateStatus(dt: number, health: number, maxHealth: number, alive: boolean, respawnIn: number, kills: number, deaths: number): void {
    if (health !== this.lastHealth) {
      this.healthValue.textContent = String(Math.ceil(health));
      this.healthBar.style.transform = `scaleX(${health / maxHealth})`;
      this.health.classList.toggle('low', health <= 30);
      this.lastHealth = health;
    }
    this.score.textContent = `${kills} abates · ${deaths} mortes`;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.vignette.style.opacity = String(Math.min(1, this.hurtTimer * 3));
    this.death.classList.toggle('show', !alive);
    // Classe, não estilo inline: o inline venceria a regra que esconde o HUD sob o menu
    this.crosshair.classList.toggle('dead', !alive);
    if (!alive)
      this.death.textContent =
        respawnIn < 0 ? 'Eliminado · aguardando a próxima rodada' : `Eliminado · renascendo em ${Math.max(0, Math.ceil(respawnIn))}`;
  }

  showHurt(): void {
    this.hurtTimer = 0.35;
  }

  /**
   * @param spreadPx dispersão atual convertida em pixels de tela
   */
  update(dt: number, weapon: WeaponState, spreadPx: number): void {
    if (weapon.mag !== this.lastMag || weapon.reserve !== this.lastReserve) {
      this.mag.textContent = String(weapon.mag);
      this.reserve.textContent = ` / ${weapon.reserve}`;
      this.ammo.classList.toggle('low', weapon.mag <= weapon.def.magSize * 0.2);
      this.lastMag = weapon.mag;
      this.lastReserve = weapon.reserve;
    }
    this.ammo.classList.toggle('reloading', weapon.reloading);
    this.reloadBar.style.transform = `scaleX(${weapon.reloadProgress})`;

    // Mira abre com a dispersão real da arma: o jogador vê quando o tiro é preciso
    const gap = Math.min(4 + spreadPx, 60);
    this.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);

    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.className = 'hitmarker';
    }
  }

  showHit(head: boolean, killed: boolean): void {
    this.hitmarker.className = `hitmarker show${head ? ' head' : ''}${killed ? ' kill' : ''}`;
    this.hitTimer = killed ? 0.3 : 0.15;
  }
}

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
