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

    parent.append(this.crosshair, this.hitmarker, this.ammo);
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
