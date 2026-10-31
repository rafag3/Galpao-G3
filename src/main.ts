import './style.css';
import { Game } from './core/Game';
import { testRange } from './level/testRange';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

new Game(canvas, ui).init(testRange).catch((err: unknown) => {
  console.error(err);
  ui.innerHTML = `<div class="overlay fatal"><p>Não foi possível iniciar o jogo.</p><pre>${String(
    err instanceof Error ? err.message : err,
  )}</pre></div>`;
});
