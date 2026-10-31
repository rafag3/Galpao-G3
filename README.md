# Galpão G3

FPS tático 3D original para navegador, com foco em celular (touch, horizontal) e suporte a PC (teclado e mouse).

**Estado atual:** Fase 0 — teste de stack. Cena cinza de testes, movimento em primeira pessoa e controles touch + teclado/mouse.

## Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Linguagem | TypeScript | Tipagem para um código que vai crescer |
| Render | Babylon.js (imports profundos) | Engine web madura, leve no mobile |
| Física | Rapier (`rapier3d-compat`) | Roda igual no navegador e no Node: a mesma simulação servirá a um servidor autoritativo no multiplayer |
| Build | Vite | Rápido, com code splitting por biblioteca |
| Testes | Vitest | A simulação é testada em Node, sem navegador |
| Deploy | Vercel | Site estático, com PWA em tela cheia e horizontal |

## Rodar

```bash
npm install
npm run dev      # servidor local, acessível na rede (abra no celular pelo IP)
npm test         # testes da simulação
npm run build    # typecheck + build de produção em dist/
```

## Controles

| Ação | PC | Celular |
|---|---|---|
| Mover | WASD / setas | Joystick flutuante: toque em qualquer ponto da metade esquerda |
| Correr | Shift | Joystick no limite |
| Mirar | Mouse (clique para capturar, Esc solta) | Arrastar na metade direita |
| Pular | Espaço | Botão **Pular** |
| Agachar | C (segurar) | Botão **Agachar** (alterna) |

Ctrl não é usado para agachar porque Ctrl+W fecha a aba.

## Arquitetura

```
src/
  core/      Game (orquestra), FixedStepLoop (tick fixo de 60 Hz)
  input/     InputIntents (contrato), teclado/mouse, touch, InputManager
  sim/       GameSim, PlayerController, PhysicsWorld, config, math  ← sem Babylon, sem DOM
  render/    GameRenderer (Babylon): só lê o estado da simulação
  level/     Níveis como dados, lidos pela física e pelo render
  ui/        Tela inicial, painel de diagnóstico
tests/       Testes da simulação (Node)
```

Regras que sustentam a evolução para multiplayer:

1. **`sim/` não importa Babylon nem DOM.** Os testes rodam em Node, o que garante isso na prática.
2. **Input vira intenção (`MoveIntent`).** A simulação não sabe se o comando veio de touch, teclado ou rede. No online, o cliente envia intents e o servidor roda a mesma `GameSim`.
3. **Tick fixo (60 Hz) e determinístico.** O render interpola entre ticks. Há teste garantindo que os mesmos intents produzem o mesmo resultado.
4. **Nível é dado.** A física e o render leem o mesmo `LevelData`, então o que se vê é o que colide.

## Orçamento de performance (alvo)

- 60 FPS como meta e 30 como piso, num Android intermediário e num iPhone com Safari
- Até ~100 mil triângulos visíveis e ~150 draw calls (cenário atual: 7)
- Resolução interna limitada a 1,5x o DPR
- Download inicial até ~15 MB (atual: ~2 MB gzip)

## Fases

0. ✅ Teste de stack: cena, controles touch e mouse, deploy
1. Movimento refinado (sensibilidade configurável, inclinação, som de passos)
2. Arma, tiro (raycast), dano, vida, recarga
3. Blockout do mapa do galpão com bombsites
4. Bots (navmesh com recast-navigation)
5. Rodadas, placar e bomba
6. HUD final, menu e opções
7. Arte final (low-poly semi-realista, GLB + KTX2, lightmaps)
