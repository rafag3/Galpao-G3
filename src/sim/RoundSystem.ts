// Regras de rodada e da bomba (CS simplificado).
//
//   freeze ─► live ─► (bomba plantada) ─► over ─► freeze …
//                                          └─► matchOver
//
// Ataque vence: elimina a defesa ou a bomba explode.
// Defesa vence: elimina o ataque antes do plantio, o tempo acaba sem
// plantio ou desarma a bomba.

import type { MoveIntent } from '../input/InputIntents';
import type { Bombsite, LevelData } from '../level/LevelData';
import type { Combatant, Team } from './Combatant';
import { ROUND } from './config';
import type { EntityId, EventQueue, RoundEndReason } from './events';
import type { Vec3 } from './math';

export type RoundPhase = 'freeze' | 'live' | 'over' | 'matchOver';
export type BombStatus = 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';

export interface BombState {
  status: BombStatus;
  carrier: EntityId | null;
  position: Vec3;
  site: 'A' | 'B' | null;
  /** 0..1 */
  plantProgress: number;
  defuseProgress: number;
  defuser: EntityId | null;
  /** Segundos até explodir (só quando plantada). */
  timeLeft: number;
}

export interface RoundState {
  phase: RoundPhase;
  round: number;
  score: Record<Team, number>;
  /** Segundos restantes da fase atual (preparação, rodada ou pós-rodada). */
  timeLeft: number;
  lastWinner: Team | null;
  lastReason: RoundEndReason | null;
  matchWinner: Team | null;
}

export interface RoundHost {
  combatants(): Combatant[];
  /** Mata (explosão da bomba). */
  kill(c: Combatant): void;
  /** Reposiciona todos para uma nova rodada. */
  resetPositions(): void;
  /** Intervalo: cada combatente passa para o outro lado. */
  swapSides(): void;
}

export function inSite(sites: readonly Bombsite[], p: Vec3): Bombsite | undefined {
  return sites.find((s) => p.x >= s.min[0] && p.x <= s.max[0] && p.z >= s.min[1] && p.z <= s.max[1]);
}

const freezeIntent = (i: MoveIntent) => {
  i.moveX = i.moveZ = 0;
  i.fire = i.jump = i.use = false;
};

export class RoundSystem {
  readonly state: RoundState = {
    phase: 'freeze',
    round: 1,
    score: { attack: 0, defense: 0 },
    timeLeft: ROUND.freezeSeconds,
    lastWinner: null,
    lastReason: null,
    matchWinner: null,
  };
  readonly bomb: BombState = {
    status: 'carried',
    carrier: null,
    position: { x: 0, y: 0, z: 0 },
    site: null,
    plantProgress: 0,
    defuseProgress: 0,
    defuser: null,
    timeLeft: 0,
  };
  private readonly sites: readonly Bombsite[];
  /** Quantos de cada equipe começaram a rodada (eliminação só conta se havia alguém). */
  private teamSize: Record<Team, number> = { attack: 0, defense: 0 };

  constructor(
    level: LevelData,
    private readonly host: RoundHost,
    private readonly events: EventQueue,
    private readonly initialCarrier: () => EntityId | null,
  ) {
    this.sites = level.bombsites ?? [];
  }

  get bombsites(): readonly Bombsite[] {
    return this.sites;
  }

  /** Começa a rodada atual: posições, bomba e contadores. */
  startRound(): void {
    this.host.resetPositions();
    const all = this.host.combatants();
    this.teamSize = {
      attack: all.filter((c) => c.team === 'attack').length,
      defense: all.filter((c) => c.team === 'defense').length,
    };
    Object.assign(this.bomb, {
      status: 'carried',
      carrier: this.initialCarrier(),
      site: null,
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null,
      timeLeft: 0,
    } satisfies Partial<BombState>);
    this.state.phase = 'freeze';
    this.state.timeLeft = ROUND.freezeSeconds;
    this.events.push({ type: 'roundStart', round: this.state.round });
  }

  /** Recomeça a partida do zero. */
  restartMatch(): void {
    this.state.round = 1;
    this.state.score = { attack: 0, defense: 0 };
    this.state.matchWinner = null;
    this.state.lastWinner = null;
    this.state.lastReason = null;
    this.startRound();
  }

  /**
   * Antes de mover os combatentes: aplica preparação e trava quem está
   * plantando ou desarmando. Também avança plantio e desarme.
   */
  preStep(intents: Map<Combatant, MoveIntent>, dt: number): void {
    const st = this.state;
    if (st.phase !== 'live') {
      // Preparação, pós-rodada e fim de partida: só olhar em volta
      for (const i of intents.values()) freezeIntent(i);
      return;
    }
    const bomb = this.bomb;

    // Plantio
    if (bomb.status === 'carried') {
      const carrier = this.byId(bomb.carrier);
      const i = carrier && intents.get(carrier);
      const s = carrier?.controller.state;
      const site = s && inSite(this.sites, s.feet);
      const slow = s && Math.hypot(s.velocity.x, s.velocity.z) < ROUND.maxUseSpeed + 2;
      if (carrier?.alive && i?.use && site && s.grounded && slow) {
        freezeIntent(i);
        i.use = true;
        bomb.plantProgress += dt / ROUND.plantSeconds;
        if (bomb.plantProgress >= 1) {
          bomb.status = 'planted';
          bomb.carrier = null;
          bomb.site = site.id;
          bomb.position = { ...s.feet };
          bomb.timeLeft = ROUND.bombSeconds;
          bomb.plantProgress = 1;
          this.events.push({ type: 'bombPlanted', by: carrier.id, site: site.id, position: bomb.position });
        }
      } else {
        bomb.plantProgress = 0;
      }
    }

    // Desarme: o primeiro defensor vivo, perto e segurando a ação
    if (bomb.status === 'planted') {
      const defuser = this.host
        .combatants()
        .find(
          (c) =>
            c.alive &&
            c.team === 'defense' &&
            intents.get(c)?.use &&
            Math.hypot(c.controller.state.feet.x - bomb.position.x, c.controller.state.feet.z - bomb.position.z) <
              ROUND.defuseRange,
        );
      if (defuser) {
        if (bomb.defuser !== defuser.id) bomb.defuseProgress = 0;
        bomb.defuser = defuser.id;
        freezeIntent(intents.get(defuser)!);
        bomb.defuseProgress += dt / ROUND.defuseSeconds;
        if (bomb.defuseProgress >= 1) {
          bomb.status = 'defused';
          this.events.push({ type: 'bombDefused', by: defuser.id });
          this.endRound('defense', 'defused');
        }
      } else {
        bomb.defuser = null;
        bomb.defuseProgress = 0;
      }
    }
  }

  /** Depois de mover e aplicar dano: bomba, tempos e condições de vitória. */
  postStep(dt: number): void {
    const st = this.state;
    const bomb = this.bomb;
    st.timeLeft -= dt;

    if (st.phase === 'freeze') {
      if (st.timeLeft <= 0) {
        st.phase = 'live';
        st.timeLeft = ROUND.roundSeconds;
        this.events.push({ type: 'freezeEnd' });
      }
      return;
    }
    if (st.phase === 'over') {
      if (st.timeLeft <= 0) {
        st.round++;
        if (st.round === ROUND.halftimeAfterRound + 1) this.halftime();
        this.startRound();
      }
      return;
    }
    if (st.phase !== 'live') return;

    const all = this.host.combatants();

    // Portador morreu: bomba cai; aliado que passar por cima pega
    if (bomb.status === 'carried') {
      const carrier = this.byId(bomb.carrier);
      if (!carrier || !carrier.alive) {
        bomb.status = 'dropped';
        bomb.position = carrier ? { ...carrier.controller.state.feet } : bomb.position;
        bomb.carrier = null;
        bomb.plantProgress = 0;
        this.events.push({ type: 'bombDropped', position: bomb.position });
      }
    } else if (bomb.status === 'dropped') {
      const picker = all.find(
        (c) =>
          c.alive &&
          c.team === 'attack' &&
          Math.hypot(c.controller.state.feet.x - bomb.position.x, c.controller.state.feet.z - bomb.position.z) <
            ROUND.pickupRange,
      );
      if (picker) {
        bomb.status = 'carried';
        bomb.carrier = picker.id;
        this.events.push({ type: 'bombPickup', by: picker.id });
      }
    }

    // Tempo
    if (bomb.status === 'planted') {
      bomb.timeLeft -= dt;
      if (bomb.timeLeft <= 0) {
        this.explode(all);
        return;
      }
    } else if (st.timeLeft <= 0) {
      this.endRound('defense', 'time');
      return;
    }

    // Eliminação (só conta para equipes que tinham alguém)
    const alive = (t: Team) => all.some((c) => c.team === t && c.alive);
    if (this.teamSize.defense > 0 && !alive('defense')) {
      this.endRound('attack', 'elimination');
    } else if (this.teamSize.attack > 0 && !alive('attack') && bomb.status !== 'planted') {
      this.endRound('defense', 'elimination');
    }
  }

  /**
   * Troca de lado. O placar é por lado, então os valores trocam junto: cada
   * time leva as vitórias que já tinha.
   */
  private halftime(): void {
    this.host.swapSides();
    const s = this.state.score;
    this.state.score = { attack: s.defense, defense: s.attack };
    this.events.push({ type: 'halftime' });
  }

  private explode(all: Combatant[]): void {
    const bomb = this.bomb;
    bomb.status = 'exploded';
    bomb.timeLeft = 0;
    this.events.push({ type: 'bombExploded', position: bomb.position });
    for (const c of all) {
      if (!c.alive) continue;
      const f = c.controller.state.feet;
      const d = Math.hypot(f.x - bomb.position.x, f.z - bomb.position.z);
      if (d <= ROUND.explosionLethalRadius) this.host.kill(c);
      else if (d < ROUND.explosionMaxRadius) {
        const t = (d - ROUND.explosionLethalRadius) / (ROUND.explosionMaxRadius - ROUND.explosionLethalRadius);
        c.health = Math.max(1, Math.round(c.health - (1 - t) * 100));
      }
    }
    this.endRound('attack', 'bomb');
  }

  private endRound(winner: Team, reason: RoundEndReason): void {
    const st = this.state;
    if (st.phase !== 'live') return;
    st.score[winner]++;
    st.lastWinner = winner;
    st.lastReason = reason;
    this.events.push({ type: 'roundEnd', winner, reason });
    if (st.score[winner] >= ROUND.winsToMatch) {
      st.phase = 'matchOver';
      st.matchWinner = winner;
      st.timeLeft = 0;
      this.events.push({ type: 'matchEnd', winner });
    } else {
      st.phase = 'over';
      st.timeLeft = ROUND.postRoundSeconds;
    }
  }

  private byId(id: EntityId | null): Combatant | undefined {
    return id ? this.host.combatants().find((c) => c.id === id) : undefined;
  }

  /** Para testes: planta a bomba direto num ponto. */
  debugPlant(site: 'A' | 'B', position: Vec3): void {
    Object.assign(this.bomb, { status: 'planted', carrier: null, site, position, timeLeft: ROUND.bombSeconds });
    this.state.phase = 'live';
  }
}
