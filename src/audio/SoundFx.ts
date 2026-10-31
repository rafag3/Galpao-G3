// Sons provisórios sintetizados com Web Audio (nenhum arquivo para baixar).
// Serão trocados por amostras reais na fase de arte, pela mesma interface.
// O AudioContext só pode começar dentro de um gesto do usuário (botão Jogar).

import { settings } from '../core/Settings';

export class SoundFx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;

  /** Chamar dentro do gesto do usuário. Seguro chamar mais de uma vez. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(0.35);
      }
      this.master.gain.value = settings.volume;
      void this.ctx.resume();
    } catch {
      this.ctx = null; // sem áudio: o jogo segue mudo
    }
  }

  setVolume(v: number): void {
    if (this.ctx) this.master.gain.value = v;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private envelope(peak: number, attack: number, decay: number, at: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.master);
    return g;
  }

  private tone(type: OscillatorType, freq: number, peak: number, decay: number, at: number, endFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + decay);
    o.connect(this.envelope(peak, 0.002, decay, at));
    o.start(at);
    o.stop(at + decay + 0.05);
  }

  shot(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Estampido: ruído filtrado com queda rápida + grave curto
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2; // varia um pouco a cada tiro
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.18);
    src.connect(lp).connect(this.envelope(0.9, 0.002, 0.2, t));
    src.start(t);
    src.stop(t + 0.3);
    this.tone('sine', 140, 0.7, 0.12, t, 45);
  }

  dryFire(): void {
    if (!this.ctx) return;
    this.tone('square', 1800, 0.15, 0.03, this.ctx.currentTime);
  }

  reload(duration: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone('square', 900, 0.12, 0.04, t + 0.25); // pente sai
    this.tone('square', 700, 0.14, 0.05, t + duration - 0.55); // pente entra
    this.tone('square', 1300, 0.12, 0.04, t + duration - 0.15); // ferrolho
  }

  hit(head: boolean, killed: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone('sine', head ? 1900 : 1400, 0.25, 0.06, t);
    if (killed) this.tone('triangle', 700, 0.3, 0.18, t + 0.05, 350);
  }
}
