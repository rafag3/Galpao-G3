// Lista de abates sob o radar: "Brasa [fuzil] Lobo", com marca de tiro na
// cabeça. Cada linha some depois de alguns segundos; no máximo 4 na tela.

import type { Team } from '../sim/Combatant';

const SHOW_SECONDS = 5;
const MAX_LINES = 4;

const RIFLE_ICON =
  '<svg class="kf-gun" viewBox="0 0 40 12" aria-hidden="true"><path d="M1 5h4l1-2h15v-1h3v1h9v1h6v2h-6l-1 1h-6l-2 4h-3l1-4h-6l-2 3H9l1-3H6L5 7H1z"/></svg>';
const HEAD_ICON =
  '<svg class="kf-head" viewBox="0 0 12 12" aria-label="na cabeça"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="6" r="1.4"/></svg>';

interface Line {
  el: HTMLDivElement;
  until: number;
}

export class KillFeed {
  private readonly root: HTMLDivElement;
  private lines: Line[] = [];
  private time = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'kill-feed';
    this.root.setAttribute('aria-live', 'polite');
    parent.append(this.root);
  }

  add(killer: { name: string; team: Team } | null, victim: { name: string; team: Team }, head: boolean, mine: boolean): void {
    const el = document.createElement('div');
    el.className = `kf-line${mine ? ' mine' : ''}`;
    const name = (n: { name: string; team: Team }) => {
      const s = document.createElement('span');
      s.className = `kf-name ${n.team === 'attack' ? 'atk' : 'def'}`;
      s.textContent = n.name;
      return s;
    };
    if (killer) el.append(name(killer));
    el.insertAdjacentHTML('beforeend', RIFLE_ICON + (head ? HEAD_ICON : ''));
    el.append(name(victim));
    this.root.append(el);
    this.lines.push({ el, until: this.time + SHOW_SECONDS });
    while (this.lines.length > MAX_LINES) this.lines.shift()!.el.remove();
  }

  clear(): void {
    for (const l of this.lines) l.el.remove();
    this.lines = [];
  }

  update(dt: number): void {
    this.time += dt;
    while (this.lines.length && this.lines[0].until <= this.time) this.lines.shift()!.el.remove();
  }
}
