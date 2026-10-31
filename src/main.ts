import './style.css';
import { Game } from './core/Game';
import { galpao } from './level/galpao';
import { testRange } from './level/testRange';

// ?mapa=teste abre o campo de testes da Fase 0
const level = new URLSearchParams(location.search).get('mapa') === 'teste' ? testRange : galpao;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

new Game(canvas, ui).init(level).catch((err: unknown) => {
  console.error(err);
  ui.innerHTML = `<div class="overlay fatal"><p>Não foi possível iniciar o jogo.</p><pre>${String(
    err instanceof Error ? err.message : err,
  )}</pre></div>`;
});
