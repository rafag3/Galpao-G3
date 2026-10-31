// Definições de armas como dados. Novas armas = novas entradas, sem código.
// Ângulos em radianos, tempos em segundos, distâncias em metros.

export interface WeaponDef {
  id: string;
  name: string;
  magSize: number;
  reserve: number;
  /** Intervalo entre tiros (0,1 s = 600 tiros/min). */
  fireInterval: number;
  automatic: boolean;
  damage: number;
  headshotMultiplier: number;
  reloadTime: number;
  range: number;
  spread: {
    /** Dispersão parado, de pé. */
    base: number;
    /** Somado proporcionalmente à velocidade (na velocidade de corrida). */
    moving: number;
    /** Somado no ar. */
    air: number;
    /** Multiplicador agachado. */
    crouchMultiplier: number;
    /** Fração do recuo acumulado que vira dispersão extra (rajada). */
    fromRecoil: number;
  };
  recoil: {
    /** Subida da mira por tiro. */
    pitchPerShot: number;
    /** Desvio lateral máximo por tiro (aleatório, com sinal). */
    yawJitter: number;
    /** Recuo vertical máximo acumulado. */
    maxPitch: number;
    /** Velocidade de retorno da mira ao centro. */
    recoveryPerSec: number;
    /** Tempo após o último tiro antes de começar a voltar. */
    recoveryDelay: number;
  };
}

export const RIFLE: WeaponDef = {
  id: 'rifle',
  name: 'Fuzil',
  magSize: 30,
  reserve: 90,
  fireInterval: 0.1,
  automatic: true,
  damage: 34,
  headshotMultiplier: 4,
  reloadTime: 2.2,
  range: 120,
  spread: {
    base: 0.002,
    moving: 0.035,
    air: 0.09,
    crouchMultiplier: 0.6,
    fromRecoil: 0.25,
  },
  recoil: {
    pitchPerShot: 0.011,
    yawJitter: 0.004,
    maxPitch: 0.14,
    recoveryPerSec: 0.55,
    recoveryDelay: 0.12,
  },
};
