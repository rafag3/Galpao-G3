// Loop de passo fixo: a simulação sempre avança em ticks de duração igual,
// independente do FPS do aparelho. Isso deixa o movimento determinístico e
// é pré-requisito para o multiplayer (cliente e servidor no mesmo ritmo).

export class FixedStepLoop {
  private accumulator = 0;
  /** Máximo de ticks por frame: evita a "espiral da morte" em aparelho lento. */
  private readonly maxStepsPerFrame = 5;

  constructor(
    private readonly dt: number,
    private readonly tick: (dt: number) => void,
  ) {}

  /**
   * Avança `frameSeconds` de tempo real.
   * @returns alpha ∈ [0,1) para interpolar o render entre os dois últimos ticks.
   */
  advance(frameSeconds: number): number {
    this.accumulator += Math.min(frameSeconds, 0.25);
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxStepsPerFrame) {
      this.tick(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) this.accumulator = 0; // descarta atraso
    return this.accumulator / this.dt;
  }
}
