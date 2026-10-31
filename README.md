# Galpão G3

FPS tático 3D original para navegador, com foco em celular (touch, horizontal) e suporte a PC (teclado e mouse).

**Estado atual:** **modo bomba 3 contra 3** no mapa Galpão. Você e 2 aliados bots contra 3 bots; escolha começar como **TR** (ataque, planta a bomba) ou **CT** (defesa, desarma), e os times trocam de lado no intervalo. Primeiro a 5 rodadas vence.

| Regra | Valor |
|---|---|
| Preparação / rodada | 3 s / 1:30 |
| Plantar / desarmar | 3 s / 5 s segurando a ação, quase parado |
| Bomba | 35 s; letal até 8 m |
| TR (ataque) vence | elimina os CTs ou a bomba explode |
| CT (defesa) vence | elimina os TRs antes do plantio, tempo esgota ou desarma |
| Morte | volta só na próxima rodada |
| Troca de lado | depois da rodada 4 (o placar acompanha cada time) |
| Dificuldade | vale para todos os bots, aliados e adversários |

Parâmetros de URL: `?mapa=teste` (campo de treino com alvos e respawn), `?bots=0` (sem bots, para testar regras), `?graficos=leve` (força o modo leve).

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
| Desarmar | E (segurar) | Botão **Desarmar** (aparece perto da bomba plantada) |

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
  render/    GameRenderer, ViewModel, CombatantViews, BombView, ImpactDecals…
    art/     ProceduralTextures, MapMaterials, Sky, WeaponTextures, SoldierAtlas: arte gerada por código
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
6. HUD final, menu e opções
   - ✅ Troca de lado: lado inicial no menu, intervalo após a rodada 4, desarme pelo jogador, HUD e avisos do ponto de vista do lado; dificuldade simétrica (com aliados mais fortes, a defesa vencia sozinha 15 de 16 rodadas)
   - ✅ Menu principal: painel com faixa de alerta, escolha de lado (TR/CT), nível dos bots, "Como jogar" (objetivo de cada lado, controles do aparelho, dicas) e Opções; na pausa, Continuar e Recomeçar partida. Fontes Saira e Saira Stencil One servidas pelo próprio site
   - ✅ HUD no layout dos FPS de celular: radar redondo (gira com o jogador; aliados, sites, bomba e só inimigos que o time está vendo) com engrenagem que abre o menu; abates logo abaixo (com marca de tiro na cabeça); placar com um ícone por jogador (X quando morre), seu time à esquerda, rodada e relógio no meio; cartão da arma no canto superior direito; vida embaixo no centro; nome e vida sobre os aliados
   - FPS e draw calls sempre visíveis em letra pequena; detalhes de posição com `?debug=1`
   - ✅ Bots trocam tiro agachados (chance por nível: 25/45/60%, só com alvo a mais de 9 m) e agacham para plantar e desarmar
7. Arte (em andamento)
   - ✅ Mapa: texturas procedurais geradas no carregamento (concreto, chapa ondulada, madeira, contêiner em 3 cores, pilar com faixa de alerta, chapa xadrez, pintura do site) com normal map; UV em escala de mundo; sombras do sol estáticas (desenhadas uma vez); claraboias no galpão e no B; céu em degradê
   - ✅ Arma em primeira pessoa: fuzil original em partes (culatra, guarda-mão, trilho, mira de ponto vermelho, cano, quebra-chamas, carregador, coronha), mãos com luva e manga camuflada; câmera própria com FOV de 47° (proporção natural sem estreitar a visão); recarga em etapas (inclina, solta o pente, mão busca outro, encaixa); cápsulas ejetadas; clarão em estrela aditivo
   - ✅ Opção Gráficos altos / Leve (sem sombras e relevo, resolução 1x); `?graficos=leve`
   - ✅ Soldados procedurais: modelados por código em peças low-poly com textura-atlas por equipe (defesa: azul-marinho, colete coiote, capacete e óculos âmbar; ataque: camuflado bege, colete oliva, capuz, boné e mochila); animados por articulações (passada que acompanha a velocidade, agachar dobrando joelhos, tronco e cabeça seguindo a mira, queda ao morrer); sombra de contato sob os pés. 8 draw calls por soldado
   - ✅ Segunda passada de arte: peças com quinas arredondadas e normais suaves (gerador próprio `roundedBox`), membros em cápsulas afuniladas, capacete em cúpula, mãos com dedos, fuzil com trilho dentado, carregador curvo, tubo da coronha e mira tubular; relevo (normal map) no uniforme dos soldados
   - ✅ Tela no iPhone: altura medida em JS (`--app-h`) e motor redimensionado por ResizeObserver; acabou a faixa vazia embaixo e a imagem esticada
   - ✅ Modelos de terceiros com licença livre (ver `public/models/LICENSES.md`): soldados animados do Quaternius Toon Shooter Kit (CC0; 17 animações, recoloridos TR laranja-terra / CT azul-marinho, cabeça reduzida para bater com a linha de headshot) e armas em primeira pessoa do Tiny Strike (ISC; AK para o TR, M4 para o CT). Materiais PBR convertidos para StandardMaterial. Se os arquivos não carregarem, ficam os modelos feitos por código
   - Personagens finais em .glb (Meshy/Tripo + Mixamo), se vierem: entram no lugar de `CombatantViews` sem mudar a simulação
   - Sons gravados
