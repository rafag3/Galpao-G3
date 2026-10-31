// Preferências do jogador, salvas no aparelho. localStorage pode estar
// indisponível (aba anônima, Safari restrito), então tudo tem fallback.

export interface SettingsData {
  /** Multiplicador da sensibilidade do mouse. */
  mouseSensitivity: number;
  /** Multiplicador da sensibilidade do arraste touch. */
  touchSensitivity: number;
  volume: number;
}

const KEY = 'galpao.settings.v1';
const DEFAULTS: SettingsData = { mouseSensitivity: 1, touchSensitivity: 1, volume: 0.7 };

function load(): SettingsData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SettingsData>;
    const out = { ...DEFAULTS };
    // Só aceita números válidos: dado corrompido não quebra o jogo
    for (const k of Object.keys(DEFAULTS) as (keyof SettingsData)[]) {
      const v = parsed[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
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
