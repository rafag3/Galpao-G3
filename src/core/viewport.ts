// Altura real da área visível. No Safari do iPhone, 100dvh e os eventos de
// resize nem sempre acompanham a barra do navegador e a rotação: o jogo
// ficava mais baixo que a tela (faixa vazia embaixo) e a imagem 3D esticada,
// porque o canvas mudava de tamanho sem o motor recalcular a resolução.
//
// Solução: medir innerHeight em todos os eventos relevantes (inclusive com
// atraso após girar, quando o iOS informa o tamanho final) e observar o
// tamanho real do canvas para redimensionar o motor.

export function trackViewport(canvas: HTMLElement, onResize: () => void): void {
  const root = document.documentElement;
  let frame = 0;
  const apply = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      root.style.setProperty('--app-h', `${window.innerHeight}px`);
    });
  };
  apply();
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => {
    apply();
    // O iOS informa a altura final só depois da animação de giro
    setTimeout(apply, 250);
    setTimeout(apply, 700);
  });
  document.addEventListener('fullscreenchange', apply);

  // Qualquer mudança no tamanho do canvas redimensiona o motor (sem distorção)
  new ResizeObserver(() => onResize()).observe(canvas);
}
