// Preferências do jogador, salvas no aparelho. localStorage pode estar
// indisponível (aba anônima, Safari restrito), então tudo tem fallback.

import type { Team } from '../sim/Combatant';
import type { Difficulty } from '../sim/config';

export interface SettingsData {
  /** Multiplicador da sensibilidade do mouse. */
  mouseSensitivity: number;
  /** Multiplicador da sensibilidade do arraste touch. */
  touchSensitivity: number;
  volume: number;
  difficulty: Difficulty;
  graphics: 'high' | 'low';
  /** Lado em que o jogador começa a partida (troca no intervalo). */
  side: Team;
}

const KEY = 'galpao.settings.v1';
// Fácil por padrão: no touch o jogador reage mais devagar que no mouse
const DEFAULTS: SettingsData = { mouseSensitivity: 1, touchSensitivity: 1, volume: 0.7, difficulty: 'easy', graphics: 'high', side: 'attack' };

function load(): SettingsData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SettingsData>;
    const out = { ...DEFAULTS };
    // Só aceita números válidos: dado corrompido não quebra o jogo
    for (const k of ['mouseSensitivity', 'touchSensitivity', 'volume'] as const) {
      const v = parsed[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    if (parsed.graphics === 'high' || parsed.graphics === 'low') out.graphics = parsed.graphics;
    if (parsed.side === 'attack' || parsed.side === 'defense') out.side = parsed.side;
    if (parsed.difficulty === 'easy' || parsed.difficulty === 'normal' || parsed.difficulty === 'hard') out.difficulty = parsed.difficulty;
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: SettingsData = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}
