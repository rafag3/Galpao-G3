// Comandante de equipe: decide o OBJETIVO de cada bot conforme o estado da
// rodada e da bomba. O BotBrain executa (caminha, vigia, combate).
//
// Defesa: cada um no seu posto; bomba plantada → o mais próximo desarma e
//         os outros retomam o site.
// Ataque: bots vão ao site escolhido (sorteado; com o humano no ataque, segue
//         o site para onde ele vai);
//         bomba caída → o mais próximo busca; portador bot → planta;
//         bomba plantada → protegem em volta dela.

import type { Bombsite, LevelData } from '../../level/LevelData';
import type { Combatant } from '../Combatant';
import type { EntityId } from '../events';
import type { Vec3 } from '../math';
import type { NavGrid, Point2 } from '../nav/NavGrid';
import type { Rng } from '../rng';
import type { BombState } from '../RoundSystem';
import { type BotBrain, objectiveFromPost } from './BotBrain';

interface BotRef {
  combatant: Combatant;
  brain: BotBrain;
}

const yawTo = (from: Point2, to: Point2) => Math.atan2(to.x - from.x, to.z - from.z);
const flat = (v: Vec3): Point2 => ({ x: v.x, z: v.z });
const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.z - b.z);

export class TeamCommander {
  private targetSite: Bombsite | null = null;
  private defuser: EntityId | null = null;
  private readonly defenseCenter: Point2;
  private readonly attackCenter: Point2;

  constructor(
    private readonly level: LevelData,
    private readonly nav: NavGrid,
  ) {
    const z = level.spawnZones!;
    this.defenseCenter = { x: (z.defense.min[0] + z.defense.max[0]) / 2, z: (z.defense.min[1] + z.defense.max[1]) / 2 };
    this.attackCenter = { x: (z.attack.min[0] + z.attack.max[0]) / 2, z: (z.attack.min[1] + z.attack.max[1]) / 2 };
  }

  /** Nova rodada: o ataque sorteia um site até o jogador mostrar para onde vai. */
  onRoundStart(rng: Rng): void {
    const sites = this.level.bombsites ?? [];
    this.targetSite = sites[Math.floor(rng.next() * sites.length)] ?? null;
    this.defuser = null;
  }

  private plantSpot(site: Bombsite): Point2 {
    const p = site.plantSpot ?? [(site.min[0] + site.max[0]) / 2, (site.min[1] + site.max[1]) / 2];
    return this.nav.nearestFree({ x: p[0], z: p[1] }) ?? { x: p[0], z: p[1] };
  }

  /** Pontos livres em volta de `c` (para espalhar quem protege ou retoma). */
  private around(c: Point2, i: number, radius: number): Point2 {
    const a = i * 2.4 + 0.6;
    const p = { x: c.x + Math.sin(a) * radius, z: c.z + Math.cos(a) * radius };
    return this.nav.nearestFree(p) ?? c;
  }

  update(bots: readonly BotRef[], human: Combatant | null, bomb: BombState): void {
    const sites = this.level.bombsites ?? [];
    const defense = bots.filter((b) => b.combatant.team === 'defense' && b.combatant.alive);
    const attack = bots.filter((b) => b.combatant.team === 'attack' && b.combatant.alive);
    const posts = this.level.defensePosts ?? [];

    // ---------------------------------------------------------- defesa
    if (bomb.status === 'planted') {
      const bp = flat(bomb.position);
      const stillValid = defense.some((b) => b.combatant.id === this.defuser);
      if (!stillValid) {
        // Quem tiver o menor caminho até a bomba desarma
        let best: BotRef | null = null;
        let bestD = Infinity;
        for (const b of defense) {
          const d = dist(flat(b.combatant.controller.state.feet), bp);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        this.defuser = best?.combatant.id ?? null;
      }
      defense.forEach((b, i) => {
        if (b.combatant.id === this.defuser) {
          b.brain.setObjective({ point: bp, watchYaw: yawTo(bp, this.attackCenter), use: true, canRespond: false });
        } else {
          const p = this.around(bp, i, 4);
          b.brain.setObjective({ point: p, watchYaw: yawTo(p, bp), canRespond: true });
        }
      });
    } else {
      // Posto fixo pela ordem entre TODOS os bots da defesa (vivos ou não):
      // uma morte não remaneja os outros. Com o humano na defesa, os bots
      // ficam com os primeiros postos (A e B) e o humano cobre o resto.
      const allDefense = bots.filter((b) => b.combatant.team === 'defense');
      defense.forEach((b) => {
        const post = posts[allDefense.indexOf(b) % Math.max(1, posts.length)];
        if (post) b.brain.setObjective(objectiveFromPost(post));
      });
    }

    // ---------------------------------------------------------- ataque
    if (!attack.length || !sites.length) return;

    // O site segue o jogador humano (no ataque) quando ele se afasta do spawn
    if (human?.alive && human.team === 'attack') {
      const hp = flat(human.controller.state.feet);
      if (dist(hp, this.attackCenter) > 15) {
        let best = this.targetSite;
        let bestD = Infinity;
        for (const s of sites) {
          const d = dist(hp, this.plantSpot(s));
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        this.targetSite = best;
      }
    }
    const site = this.targetSite ?? sites[0];
    const spot = this.plantSpot(site);
    const towardDefense = yawTo(spot, this.defenseCenter);

    if (bomb.status === 'planted') {
      const bp = flat(bomb.position);
      attack.forEach((b, i) => {
        const p = this.around(bp, i + 1, 5);
        b.brain.setObjective({ point: p, watchYaw: yawTo(bp, this.defenseCenter) + (i % 2 ? 0.7 : -0.7) });
      });
      return;
    }

    // Bomba caída: o aliado mais próximo vai buscar
    let fetcher: BotRef | null = null;
    if (bomb.status === 'dropped') {
      let bestD = Infinity;
      for (const b of attack) {
        const d = dist(flat(b.combatant.controller.state.feet), flat(bomb.position));
        if (d < bestD) {
          bestD = d;
          fetcher = b;
        }
      }
    }

    attack.forEach((b, i) => {
      if (b === fetcher) {
        b.brain.setObjective({ point: flat(bomb.position), watchYaw: towardDefense, canRespond: false });
      } else if (bomb.status === 'carried' && bomb.carrier === b.combatant.id) {
        b.brain.setObjective({ point: spot, watchYaw: towardDefense, use: true, canRespond: false });
      } else {
        const p = this.around(spot, i + 2, 4);
        b.brain.setObjective({ point: p, watchYaw: towardDefense });
      }
    });
  }
}
