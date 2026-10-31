import './style.css';
import { Game } from './core/Game';
import { galpao } from './level/galpao';
import { testRange } from './level/testRange';

// ?mapa=teste abre o campo de testes da Fase 0
const params = new URLSearchParams(location.search);
const level = params.get('mapa') === 'teste' ? testRange : galpao;
// ?bots=0: sem bots (testes manuais e automatizados das regras)
const simOptions = params.get('bots') === '0' ? { bots: false } : {};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

new Game(canvas, ui).init(level, simOptions).catch((err: unknown) => {
  console.error(err);
  ui.innerHTML = `<div class="overlay fatal"><p>Não foi possível iniciar o jogo.</p><pre>${String(
    err instanceof Error ? err.message : err,
  )}</pre></div>`;
});
