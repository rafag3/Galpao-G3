// Nomes exibidos no HUD (abates, placar, aliados). Ficam no bot, não no lado:
// depois da troca de lado o "Lobo" continua sendo o Lobo.

import type { EntityId } from '../sim/events';

const CALLSIGNS = ['Brasa', 'Lobo', 'Raio', 'Tatu', 'Falcão', 'Cobra', 'Gavião', 'Sombra'];

export function displayName(id: EntityId): string {
  if (id === 'player') return 'Você';
  const n = Number(id.split(':')[1]);
  return Number.isFinite(n) ? CALLSIGNS[n % CALLSIGNS.length] : id;
}
