// Nome e vida flutuando sobre a cabeça dos aliados (como na referência de
// layout). Só aliados: marcar inimigos através das paredes seria trapaça.

export interface AllyTag {
  id: string;
  name: string;
  health: number;
  /** Posição na tela em px CSS, ou null se estiver fora da vista. */
  screen: { x: number; y: number } | null;
}

export class AllyTags {
  private readonly root: HTMLDivElement;
  private readonly tags = new Map<string, { el: HTMLDivElement; hp: HTMLSpanElement; last: number }>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ally-tags';
    this.root.setAttribute('aria-hidden', 'true');
    parent.append(this.root);
  }

  update(list: readonly AllyTag[]): void {
    const seen = new Set<string>();
    for (const a of list) {
      seen.add(a.id);
      let t = this.tags.get(a.id);
      if (!t) {
        const el = document.createElement('div');
        el.className = 'ally-tag';
        const name = document.createElement('span');
        name.className = 'at-name';
        name.textContent = a.name;
        const hp = document.createElement('span');
        hp.className = 'at-hp';
        el.append(name, hp);
        this.root.append(el);
        t = { el, hp, last: -1 };
        this.tags.set(a.id, t);
      }
      if (t.last !== a.health) {
        t.hp.textContent = `${Math.ceil(a.health)}%`;
        t.last = a.health;
      }
      t.el.hidden = !a.screen;
      if (a.screen) t.el.style.transform = `translate(${a.screen.x.toFixed(1)}px, ${a.screen.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, t] of this.tags) {
      if (!seen.has(id)) {
        t.el.remove();
        this.tags.delete(id);
      }
    }
  }
}
