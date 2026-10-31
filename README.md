# Galpão G3

FPS tático 3D original para navegador, com foco em celular (touch, horizontal) e suporte a PC (teclado e mouse).

**Estado atual:** Fase 5 — **modo bomba 3 contra 3** no mapa Galpão. Você e 2 aliados bots no ataque contra 3 bots da defesa; primeiro a 5 rodadas vence.

| Regra | Valor |
|---|---|
| Preparação / rodada | 3 s / 1:30 |
| Plantar / desarmar | 3 s / 5 s segurando a ação, quase parado |
| Bomba | 35 s; letal até 8 m |
| Ataque vence | elimina a defesa ou a bomba explode |
| Defesa vence | elimina o ataque antes do plantio, tempo esgota ou desarma |
| Morte | volta só na próxima rodada |

Parâmetros de URL: `?mapa=teste` (campo de treino com alvos e respawn), `?bots=0` (sem bots, para testar regras).

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
| Atirar | Clique esquerdo (segurar = automático) | **Atirar** (também mira enquanto pressionado) |
| Recarregar | R | Botão **Recarregar** (ou automático ao atirar sem bala) |
| Plantar | E (segurar) | Botão **Plantar** (aparece no site com a bomba) |

Ctrl não é usado para agachar porque Ctrl+W fecha a aba.

## Arquitetura

```
src/
  core/      Game (orquestra), FixedStepLoop (tick fixo de 60 Hz), Settings
  input/     InputIntents (contrato), teclado/mouse, touch, InputManager
  sim/       GameSim, RoundSystem (rodadas e bomba), Combatant, PlayerController, WeaponController, HitRegistry,
             TargetSystem, PhysicsWorld, weapons (dados), events, rng
    ai/      TeamCommander: objetivos por equipe (posto, site, plantar,
             desarmar, buscar bomba, proteger); BotBrain executa e combate
    nav/     NavGrid: grade de 0,5 m gerada do nível, A* + suavização
             ← sim/ inteiro: sem Babylon, sem DOM
  render/    GameRenderer, ViewModel, TargetViews, ImpactDecals: só leem o estado
  audio/     SoundFx: sons sintetizados provisórios (Web Audio)
  level/     Níveis como dados. galpao.ts descreve as áreas caminháveis e os
             objetos; walkableGrid gera as paredes do resto (greedy meshing)
  ui/        Tela inicial, painel de diagnóstico
tests/       Testes da simulação (Node)
```

Regras que sustentam a evolução para multiplayer:

1. **`sim/` não importa Babylon nem DOM.** Os testes rodam em Node, o que garante isso na prática.
2. **Input vira intenção (`MoveIntent`).** A simulação não sabe se o comando veio de touch, teclado ou rede. No online, o cliente envia intents e o servidor roda a mesma `GameSim`.
3. **Tick fixo (60 Hz) e determinístico.** O render interpola entre ticks. Há teste garantindo que os mesmos intents produzem o mesmo resultado.
4. **A simulação emite eventos** (`shot`, `hit`, `impact`…). Render, áudio e HUD reagem a eles; a simulação não sabe que existem.
5. **Aleatoriedade com semente** (`Rng`). A dispersão dos tiros é reproduzível, condição para o servidor validar tiros no online.
6. **Bot = jogador com outro cérebro.** Mesmo controlador, mesma arma, mesmas regras; o `BotBrain` só gera intents. No online, um bot é indistinguível de um cliente.
7. **Nível é dado.** A física e o render leem o mesmo `LevelData`, então o que se vê é o que colide.

## Orçamento de performance (alvo)

- 60 FPS como meta e 30 como piso, num Android intermediário e num iPhone com Safari
- Até ~100 mil triângulos visíveis e ~150 draw calls (Galpão: 22)
- Resolução interna limitada a 1,5x o DPR
- Download inicial até ~15 MB (atual: ~2 MB gzip)

## Fases

0. ✅ Teste de stack: cena, controles touch e mouse, deploy
1. ✅ Sensibilidade configurável e volume (salvos no aparelho)
2. ✅ Arma hitscan, cadência, dano por parte do corpo, dispersão, recuo, recarga, alvos com respawn, sons provisórios
3. ✅ Blockout do mapa Galpão: rotas validadas por teste (A ~11 s, B ~9,5 s, estreita ~9 s, defesa ~4 s)
4. ✅ Bots: navegação A* em grade, visão por raycast (sem atravessar paredes), reação de 0,6 s, erro de mira que assenta, rajadas, audição de tiros, um bot de apoio por avistamento, anti-travamento
5. ✅ Rodadas e bomba: plantar/desarmar/explodir, queda e coleta da bomba, aliados bots, desarme e retomada pela defesa, placar, fim de partida
6. HUD final, menu e opções; troca de lado (jogar na defesa)
7. Arte final (low-poly semi-realista, GLB + KTX2, lightmaps)
