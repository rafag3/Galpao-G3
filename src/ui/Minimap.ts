// Radar no canto superior esquerdo. Gira com o jogador (frente sempre para
// cima), centrado nele. Mostra o mapa em planta, os sites, os aliados, a
// bomba quando o time sabe onde ela está e só os inimigos que alguém do time
// está vendo agora (como no CS: o radar não revela quem está escondido).

import type { LevelData } from '../level/LevelData';
import type { Team } from '../sim/Combatant';
import type { BombState } from '../sim/RoundSystem';

/** Pixels por metro da camada estática (desenhada uma vez). */
const LAYER_SCALE = 4;
/** Raio de visão do radar, em metros. */
const VIEW_RADIUS = 26;

const COLOR = {
  outside: '#101215',
  floor: '#4d5259',
  wall: '#1a1c20',
  prop: '#2c3036',
  site: 'rgba(242, 183, 5, 0.22)',
  siteText: '#f2b705',
  attack: '#ff7a2f',
  defense: '#3d8bff',
  enemy: '#ff3b3b',
  bomb: '#f2b705',
};

export interface RadarDot {
  x: number;
  z: number;
}

export interface RadarFrame {
  /** Jogador: posição e direção (yaw). */
  x: number;
  z: number;
  yaw: number;
  team: Team;
  allies: RadarDot[];
  enemies: RadarDot[];
  bomb: BombState | null;
  /** Posição do portador, quando a bomba está sendo carregada. */
  bombCarrier: RadarDot | null;
  time: number;
}

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private readonly minX: number;
  private readonly maxZ: number;
  private readonly sites: { id: string; x: number; z: number }[];
  private size = 0;
  private dpr = 1;

  constructor(parent: HTMLElement, level: LevelData) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Limites do mapa: o bloco de chão cobre tudo
    const floor = level.blocks.find((b) => b.kind === 'floor')!;
    this.minX = floor.position[0] - floor.size[0] / 2;
    this.maxZ = floor.position[2] + floor.size[2] / 2;
    this.layer = this.buildLayer(level, floor.size[0], floor.size[2]);
    this.sites = (level.bombsites ?? []).map((s) => ({
      id: s.id,
      x: (s.min[0] + s.max[0]) / 2,
      z: (s.min[1] + s.max[1]) / 2,
    }));
  }

  /** Planta do mapa: chão, paredes, objetos e sites. */
  private buildLayer(level: LevelData, width: number, depth: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.ceil(width * LAYER_SCALE);
    c.height = Math.ceil(depth * LAYER_SCALE);
    const g = c.getContext('2d')!;
    g.fillStyle = COLOR.floor;
    g.fillRect(0, 0, c.width, c.height);
    const rect = (x0: number, z0: number, x1: number, z1: number) =>
      g.fillRect((x0 - this.minX) * LAYER_SCALE, (this.maxZ - z1) * LAYER_SCALE, (x1 - x0) * LAYER_SCALE, (z1 - z0) * LAYER_SCALE);

    for (const s of level.bombsites ?? []) {
      g.fillStyle = COLOR.site;
      rect(s.min[0], s.min[1], s.max[0], s.max[1]);
    }
    for (const b of level.blocks) {
      if (b.collide === false || b.kind === 'floor' || b.kind === 'roof' || b.kind === 'ceiling' || b.kind === 'ramp') continue;
      g.fillStyle = b.kind === 'wall' ? COLOR.wall : COLOR.prop;
      const [x, , z] = b.position;
      const [w, , d] = b.size;
      rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
    }
    return c;
  }

  private resize(): void {
    const size = this.canvas.clientWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
  }

  update(f: RadarFrame): void {
    this.resize();
    const g = this.ctx;
    const px = this.canvas.width;
    if (!px) return;
    const half = px / 2;
    const zoom = half / VIEW_RADIUS; // px do radar por metro
    const cos = Math.cos(-f.yaw);
    const sin = Math.sin(-f.yaw);
    const dot = this.dpr;

    // Mundo → radar: planta com o norte para cima, girada pelo yaw do jogador
    const toRadar = (x: number, z: number, clampEdge: boolean): [number, number] => {
      const dx = x - f.x;
      const dy = -(z - f.z);
      let rx = (dx * cos - dy * sin) * zoom;
      let ry = (dx * sin + dy * cos) * zoom;
      if (clampEdge) {
        const lim = half - 6 * dot;
        const m = Math.max(Math.abs(rx), Math.abs(ry));
        if (m > lim) {
          rx *= lim / m;
          ry *= lim / m;
        }
      }
      return [half + rx, half + ry];
    };

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.fillStyle = COLOR.outside;
    g.fillRect(0, 0, px, px);

    g.save();
    g.translate(half, half);
    g.rotate(-f.yaw);
    g.scale(zoom / LAYER_SCALE, zoom / LAYER_SCALE);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.layer, -(f.x - this.minX) * LAYER_SCALE, -(this.maxZ - f.z) * LAYER_SCALE);
    g.restore();

    // Letras dos sites, sempre de pé
    g.font = `700 ${Math.round(13 * dot)}px Saira, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3 * dot;
    g.strokeStyle = COLOR.outside;
    g.fillStyle = COLOR.siteText;
    for (const s of this.sites) {
      const [sx, sy] = toRadar(s.x, s.z, false);
      if (sx < -10 || sy < -10 || sx > px + 10 || sy > px + 10) continue;
      g.strokeText(s.id, sx, sy);
      g.fillText(s.id, sx, sy);
    }

    const circle = (x: number, y: number, r: number, fill: string) => {
      g.beginPath();
      g.arc(x, y, r * dot, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 1.5 * dot;
      g.strokeStyle = COLOR.outside;
      g.stroke();
    };

    // Bomba: o TR sempre sabe onde está; o CT só depois de plantada
    const b = f.bomb;
    if (b && b.status !== 'exploded' && b.status !== 'defused') {
      const knows = f.team === 'attack' || b.status === 'planted';
      const pos = b.status === 'carried' ? f.bombCarrier : b.position;
      const blinkOff = b.status === 'planted' && Math.floor(f.time * 4) % 2 === 1;
      if (knows && pos && !blinkOff) {
        const [bx, by] = toRadar(pos.x, pos.z, true);
        const s = (b.status === 'carried' ? 4 : 5) * dot;
        g.fillStyle = b.status === 'planted' ? COLOR.enemy : COLOR.bomb;
        g.strokeStyle = COLOR.outside;
        g.lineWidth = 1.5 * dot;
        g.fillRect(bx - s, by - s, s * 2, s * 2);
        g.strokeRect(bx - s, by - s, s * 2, s * 2);
      }
    }

    const mine = f.team === 'attack' ? COLOR.attack : COLOR.defense;
    for (const a of f.allies) circle(...toRadar(a.x, a.z, true), 4, mine);
    for (const e of f.enemies) circle(...toRadar(e.x, e.z, true), 4.5, COLOR.enemy);

    // Jogador: seta branca no centro apontando para cima (frente)
    g.beginPath();
    g.moveTo(half, half - 7 * dot);
    g.lineTo(half + 5 * dot, half + 5 * dot);
    g.lineTo(half, half + 2.5 * dot);
    g.lineTo(half - 5 * dot, half + 5 * dot);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 1.5 * dot;
    g.strokeStyle = COLOR.outside;
    g.stroke();
  }
}
