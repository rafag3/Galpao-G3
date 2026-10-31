// Gerador pseudoaleatório com semente (mulberry32). A dispersão dos tiros
// usa este gerador, e não Math.random, para manter a simulação
// determinística: mesma semente + mesmos intents = mesmo resultado.

export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  /** Número em [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
