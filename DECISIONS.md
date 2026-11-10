# Decisões e pendências

## Stack (validada em 05/11/2026)

- **Tauri 2 + React + TypeScript + Vite.** Só macOS → um único motor (WebKit), o que elimina o principal problema do Tauri. Editor de blocos e livro 3D com texto ficam melhores no ecossistema web do que em SwiftUI.
- **SQLite no lado Rust** (`rusqlite` + `rusqlite_migration`, comandos tipados), não `tauri-plugin-sql`: a API JS do plugin não mantém uma transação numa conexão só (BEGIN/COMMIT podem cair em conexões diferentes do pool).
- **Bíblia em banco próprio, somente leitura**, separado dos dados do usuário (backup pequeno, migrações não tocam o texto).
- **E2E:** `tauri-driver` não roda em macOS. Plano: Playwright (motor WebKit) contra o build web com `mockIPC` + testes Rust + checklist manual do 3D no app real.

## Etapa 0 — Bíblia 3D (estado atual)

- Protótipo roda como app web (Vite). **Rust ainda não está instalado na máquina**: o shell Tauri entra quando houver `rustup` + Xcode CLT.
- Texto: **Bíblia Livre TR, release 2018.2.0**, USFM completo. NT Textus Receptus (troca para Nestle 1904 com `--variant n4`). Importador determinístico em `scripts/import-bible/` valida 66 livros / 1.189 capítulos / 31.102 versículos; junta linhas de continuação; guarda títulos de salmos (`\d`), itálico de palavras acrescentadas (`\add`) e notas de rodapé (`\f`, ainda não exibidas). Créditos CC BY 3.0 BR na página de créditos do próprio livro.
- Diagramação própria (canvas) em espaço de página fixo; a textura é desenhada na resolução que o zoom pede (1024–3072 px), então o texto continua nítido no foco.
- Leitura: coluna única, versículo por linha com número pendurado na margem (ou corrido), abertura de capítulo com rótulo + numeral, versalete na primeira palavra.
- Livro: folhas como curvas de comprimento constante (o papel não estica), virada com mola criticamente amortecida, canto que levanta ao passar o mouse, blocos com corte dourado cuja espessura acompanha a posição no cânon, capa que abre girando com o bloco esquerdo.
- **Persistência provisória em localStorage** (posição, estilo, anotações, meta, gratidão) atrás de stores com a mesma interface que irá para o SQLite.
- Clique no texto = selecionar versículo/anotar; virar = borda da página, arrastar, setas ou gesto lateral no trackpad.

## Pendências

- Medir fps real no WKWebView do Tauri (o painel de testes usado no desenvolvimento estava oculto e limitado a 1 quadro/s).
- Seleção/cópia de texto: camada DOM alinhada à página (o layout já guarda a posição de cada palavra).
- Hifenização em português para justificar com menos espaços largos.
- Exibir notas de rodapé da tradução.
- Mover stores para SQLite (etapa 1) e incluir anotações/gratidão no backup.

## Etapa 1 — base do app (05/11/2026)

- **Tauri 2** criado em `src-tauri/` (janela com barra de título sobreposta, CSP restrita em produção, permissões mínimas). Rust 1.99 instalado via rustup.
- **SQLite em Rust** (`rusqlite` com SQLite embutido): migrações versionadas por `PRAGMA user_version`, cada uma numa transação; backup automático (`VACUUM INTO`) antes de migrar dados existentes; backup manual pelo ⌘K. Banco em `~/Library/Application Support/app.personalspace.desktop/`. Testes: migração do zero + bloqueio de check-in duplicado (`cargo test`).
- **Comandos tipados** (sem SQL vindo da WebView): ajustes, tarefas, hábitos (frequência versionada em `habit_schedules`, pausas em `habit_pauses`), check-ins.
- **No navegador** (dev/testes) a mesma API roda numa emulação em localStorage (`src/shared/db/api.ts`).
- **Shell:** barra lateral recolhível (⌘\), ⌘K, ⌘1–7, ⌘N contextual, ⌘, temas. Bíblia, Home, Tarefas e Hábitos carregam sob demanda.
- **Leveza:** fundo dos temas desenhado uma vez por tamanho de janela; globo a 30 qps no giro automático e parado com a janela oculta; Bíblia só renderiza quando algo se move.

## Mudança de escopo pedida pelo dono (05/11/2026)

- Globo 3D em tempo real na Home e **temas completos** (Praia & Surf, Noir/máfia anos 40, Nova York) entram na V1, por decisão do dono.
- Tema máfia é estética original (whisky, charuto, couro, âmbar); sem nome, logo ou personagens de obras existentes.
- **Pendente de decisão:** origem das imagens. Globo realista precisa de texturas de satélite (NASA, domínio público); temas "óleo/impasto 4K" precisam de arte real (pinturas de domínio público de museus, ou imagens fornecidas pelo dono). Os fundos atuais são procedurais (shader com efeito de pincelada) e servem de base/fallback.
- Bíblia: polimento do 3D, ambientes céu/mar e experiência de leitura espiritual ficam para depois.

## Rodada de qualidade (05/11/2026, noite)

- Direção de design e checklist de validação em `docs/design/DIRECTION.md`.
- **Globo fotorrealista:** texturas Solar System Scope (CC BY 4.0, baseadas na NASA) em `public/earth/` (crédito em `CREDITOS.md`): dia 4K + 8K sob demanda no zoom, luzes noturnas, nuvens com sombra, relevo por normal map, reflexo do sol na água. Canvas de tela inteira com deslocamento de câmera: longe, o globo fica à direita; perto, desliza ao centro e a interface some ("modo exploração").
- **Temas por obra:** os fundos procedurais foram removidos. Cada tema tem pasta em `src/assets/themes/<id>/` com `PROMPT.md`; a `arte.jpg` colocada lá é detectada na build. Sem obra, o tema usa um degradê da própria paleta. 10 temas além do Editorial.
- **Movimento:** View Transitions entre páginas (recuo + desfoque na saída, subida na entrada), revelação circular na troca de tema, cascata de entrada, pílula deslizante na barra lateral flutuante.
- **Bíblia:** ambientes Escritório/Céu/Mar (shaders estáticos, sem custo contínuo), fitas que pendem livres fora da mesa, costura na capa, lombada com nervuras e título em ouro, "momento de leitura" (respiração, foco na página, interface e barra lateral somem, som ambiente sintetizado opcional).

### Pendências conhecidas
- Obras dos temas (o dono gera com os prompts e coloca nas pastas).
- Tarefas e Hábitos ainda com o visual anterior; precisam do mesmo acabamento da Home.
- Bíblia: seleção/cópia de texto, notas de rodapé, hifenização.
- Abrir o app nativo (`npm run app`) e medir fps no WKWebView.

## Temas com obras do dono (05/11/2026)

- 35 obras do dono (WebP 3840×2400, ampliadas de gerações menores) em `src/assets/wallpapers/<tema>/`, com miniaturas em `mini/`. Temas: Máfia (8), Havaí (10), Amalfi (10), Nova York (5), Miami (2), além de Editorial e **Órbita**.
- Algumas obras do tema Máfia retratam semelhança com atores reais em papéis de filme: ok para uso pessoal; não distribuir o app com elas.
- Cada tema tem várias obras; a escolhida fica salva por tema. Ajustes globais do fundo: desfoque, intensidade da obra e opacidade dos painéis.
- O globo vive só no tema **Órbita** (Home = Terra em tempo real no espaço, com Via Láctea e Lua; outras telas = céu estrelado). Nos demais temas a Home usa a obra como herói.
- Bloom (pós-processamento) testado e removido: deixava o canvas preto com a câmera deslocada; a cena se sustenta sem ele. Revisitar com `@react-three/postprocessing` se quiser mais brilho nas luzes.
- Tarefas e Hábitos refeitos: cabeçalhos editoriais, controle segmentado com pílula, entrada rápida com chips ao vivo, conclusão animada (risco + saída), anéis de progresso, calendário com meses.

## Claro/Escuro, Bíblia quente, Home e clima (05/11/2026, madrugada)

- **Dois temas padrão sem obra:** Claro (papel luminoso, tinta escura e bronze) e Escuro (preto puro `#000`). Ícones e cores semânticas têm variante para `data-scheme="light"`.
- **Localização:** o dono mora no Ceará. Só Fortaleza (casa) e Recife existem no app; nada de outras cidades.
- **Rede na Home (exceção pedida pelo dono):** clima de Fortaleza e Recife pelo Open-Meteo (gratuito, sem conta e sem chave; só envia as coordenadas públicas das duas cidades). Cache de 30 min em localStorage, funciona offline com o último valor. CSP liberado só para `https://api.open-meteo.com`. A spec original previa rede apenas no Radar.
- **Home nova:** saudação sem ponto final, com ícone de sol, entardecer ou lua conforme a hora (pôr do sol cedo, perto do equador); clima das duas cidades; cartões Hoje, Continuar leitura e Versículo do dia (30 versículos curados, um por dia, texto carregado sob demanda; clicar abre a Bíblia no versículo, realçado por alguns segundos). Nos temas com obra, o meio da tela fica livre para a pintura; no Claro/Escuro o conteúdo se agrupa no centro.
- **Bíblia no clima da referência do dono:** luz de manhã quente com sombra de folhas, couro marrom, 5 capas (Couro clássico, Executiva, Linho, Oliva, Horizonte) e **8 fundos com as fotos do dono** (Montanha, Mar, Estudo, Mediterrâneo, Floresta, Céu, Aconchego, Noite) + "Luz da manhã" sem foto. Cada fundo tem luz da cena e som ambiente próprios (vento, ondas, chuva, lareira, grilos — sintetizados). Nas fotos, a luz principal vem alta para a sombra não cair sobre o céu; um chão escuro sobe do pé da tela e uma sombra de contato assenta o livro.
- **Pacote do dono:** os GLB de capa/livro aberto (≈1.350 triângulos, caixas, sem relevo) não foram usados: o livro procedural tem mais detalhe e é o único que abre e vira páginas. As texturas de capa repetem a composição que o livro já desenha com ouro metálico. O papel ganhou o tom marfim do pacote (`#f2e6cd`).
- **Entrada da Bíblia redesenhada:** nunca abre sozinha. Chegada em grua até o livro fechado, brilho correndo pelo ouro da capa, convite com a leitura do dia. Abertura física: a mão ergue a capa até passar da vertical, a gravidade a deita e ela quica com um baque de couro; também dá para arrastar a capa com o cursor. Fechar: a câmera recua primeiro, depois a capa desce. Voltar à aba na mesma sessão com o livro aberto mantém o livro aberto.

## Laboratório, Radar e Notas (05/11/2026)

- Construídos em paralelo, cada um dono dos próprios arquivos: `src/features/<mod>/`, `src-tauri/src/<mod>.rs` e migrações `002_ideas`, `003_radar`, `004_notes`.
- Dependências novas: Tiptap v3 (editor das Notas, MIT), `@tauri-apps/plugin-opener` (links no navegador padrão, permissão `opener:default`) e `ureq` 3 (busca de feeds no Rust, contornando CORS sem scraping).
- ⌘N é contextual: nova ideia no Laboratório, nova nota em Notas, novo hábito em Hábitos e nova tarefa no resto.
- **Laboratório:** o parecer não é gravado; é recalculado das respostas + evidências (evidência registrada pesa mais que a resposta). Vereditos: descartar por enquanto / investigar / testar barato / informação insuficiente, sem nota numérica. Um teste por vez com aviso suave.
- **Radar:** 18 fontes semeadas e validadas (OpenAI, DeepMind, HN, Simon Willison, Hugging Face, GitHub Changelog, Google AI, ElevenLabs, YouTube Blog, The Decoder, Rust Blog e releases de claude-code, codex, tauri, vite, react, TypeScript; three.js por `tags.atom`, porque o `releases.atom` tem 2 MB e passa de 10 s). O RSS da Anthropic responde 404 e ficou de fora. Preferências em `radar_keywords` (termo, boost/mute, peso) + `feed_sources.weight`; "não me interessa" ajusta pesos de forma explicável e desfazível. Busca só de fontes cadastradas, sem endereços locais, redirecionamentos conferidos um a um.
- **Notas:** busca FTS5 sem acento (o rusqlite embutido tem FTS5), chave estável `rid` para o índice (o rowid muda em VACUUM). Autosave em fila única com resgate em localStorage. Imagens com tipo conferido pelos bytes, gravadas em `note-assets/`. Destaque de sintaxe no código ficou de fora (sem lowlight).
- **Carregamento:** as páginas são pré-carregadas em segundo plano quando o app fica ocioso; se ainda assim demorar, aparece um esqueleto discreto depois de 350 ms.

## Só Claro e Escuro, com aparência editável (06/11/2026)

- Pedido do dono: ficam só **Claro** e **Escuro**. Saíram Órbita (globo), Máfia, Havaí, Amalfi, Nova York e Miami.
- Nada foi apagado: obras (`wallpapers/`, 43 MB), texturas da Terra (`earth/`, 9 MB) e `Globe.tsx` estão em `arquivo/temas-removidos/`, fora da build. O app ficou com 10 MB.
- Cada tema guarda a própria aparência: cor de destaque (paleta + cor livre), fonte dos títulos (Cormorant, Garamond, Fraunces, Bodoni, Josefin, SF Pro), fonte do texto (SF Pro, arredondada, serifada), tom do fundo (neutro, quente, frio), intensidade do fundo (até preto puro / branco puro), contraste do texto, opacidade dos painéis e arredondamento. As cores do tema são derivadas dessas escolhas; o texto sobre o destaque escolhe preto ou branco pela luminância.
- Estado em `ps.theme.v3` + setting `theme`; o formato antigo migra sozinho (Claro continua Claro, o resto vira Escuro).
- Fontes criativas extras para títulos: Instrument Serif, Unbounded e Syne, com `font-size-adjust` para não estourarem o layout.
- **Janela transparente:** a janela nativa é transparente com vibração do macOS (`macOSPrivateApi`). O controle "Transparência da janela" mistura o fundo do tema com o desktop; em 0 a janela é opaca. A janela só aparece depois do primeiro quadro pintado, sem piscar branco.

## Manhãs: saudação, humor e briefing (06/11/2026)

- **Saudação:** "Bom dia/Boa tarde/Boa noite" seguido de um apelido que muda todo dia e nunca repete o de ontem (lista editável clicando no apelido). Na primeira abertura do dia, uma abertura curta escreve a saudação e ela voa até o lugar na Home; qualquer tecla ou clique pula.
- **Humor:** check-in de um toque (5 rostos) com nota opcional; de manhã pergunta do café intensidade 14. Tabela `day_checkins` (migração `006_mood`). "Seu ano" mostra a grade de 12 meses e leituras simples (café, leitura da Bíblia, dia da semana, tendência do mês).
- **Briefing do dia:** gerado uma vez por dia, na primeira abertura do app (pronto em cerca de 1 min). Coleta feeds e cotações (CoinGecko, AwesomeAPI, Banco Central SGS, Yahoo para o Ibovespa), filtra localmente pelo perfil e manda os candidatos para o **Codex CLI logado na conta do ChatGPT do dono** (`codex exec`, sandbox só leitura, sem tokens de API) como juiz, que escreve tudo em português. Sem Codex, usa o filtro local e avisa "feito sem o juiz". 👍/👎, triagem do que ficou de fora e perfil de interesses treinam o filtro. Migração `005_briefing`.
- **Apresentação com voz:** narração pela voz do macOS (`say`) com filtro opcional estilo Jarvis no Web Audio.
- **Home focada no briefing:** saíram "Versículo do dia" e "Continuar leitura" (a Bíblia já abre no ponto onde parou). O briefing virou o destaque: orbe grande para ouvir, as 3 manchetes principais numeradas com a cor da área, aurora sutil com as cores das áreas do dia e o mercado no rodapé. Ao lado fica o cartão Hoje. Abaixo de 1180 px as colunas empilham.

## Bíblia: nova leitura (06/11/2026)

- Abertura e fechamento com curvas suaves, sons reais (pacote Kenney, CC0, em `src/assets/sounds/`) e controle de volume.
- Virada de página com sombra calculada, pré-carregamento incremental e sombras sob demanda. Swipe de dois dedos no trackpad vira páginas (direita = próxima, esquerda = anterior), respeitando a rolagem natural do macOS.
- Marcador (tecla M, "Ir ao marcador") com fita saindo do miolo; fita dourada marca o início da leitura do dia. Medidor de leitura e convite "Continuar em …" no livro fechado.

## Workstation (06/11/2026)

- Substitui Tarefas e Trabalho: espaços Statix, Livelo e Pessoal, cada um com seus to-dos (diário, fixo ou com prazo, com importância) e itens de trabalho com ciclo A fazer → Fazendo → Entregue → Testado → Validado → Concluído, além de Voltou e Aguardando.
- "Não pode esquecer" dispara notificação nativa do macOS. Capturas de tela por item; dados sensíveis vão para o Keychain do macOS, nunca para o SQLite. Migração `007_work`.
- Copiloto: alertas de atraso, foco do dia, linha do tempo do que foi entregue e gerador de standup. Recompensa visual por manter tudo verde, sem pontos nem medalhas.
- Logos: Statix tirada do projeto `financial-manager-app`; Livelo redesenhada em SVG a partir da imagem enviada.

## Ícone e entrega

- Ícone do app: nascer do sol sobre o horizonte, gerado em todos os tamanhos pelo `tauri icon`.
- Repositório: `github.com/caiocezxr/alfred`, autor único caiocezxr, sem comentários no código.

## Sessão em paralelo, skills de base e Dossiê enxuto (09/11/2026)

- **Skills de base sempre ligadas:** `i-have-adhd`, `ponytail` e `caveman` (as duas últimas na biblioteca do Alfred). O texto delas vai nas instruções de toda sessão do Claude e do Codex, com teto de 30 mil caracteres. O chat local fica de fora pelo contexto pequeno.
- **Claude e Codex ao mesmo tempo:** a conversa junta cada pedaço de texto na última mensagem do mesmo agente. O botão **Isolar** põe cada agente numa git worktree própria (branch `alfred/<desk>-<agente>`, pasta em `worktrees/` do Alfred); juntar as branches fica com o dono. Ligar ou mudar a pasta principal abre sessões novas.
- **Robustez:** evento de processo encerrado de propósito é ignorado; abertura antiga não derruba a nova; sessão que não retoma abre uma nova com aviso; limite e login só são lidos no fim do turno, com frases exatas; não dá para mandar enquanto o agente trabalha; permissões pendentes são canceladas no Esc e no fechamento; o adaptador recebe SIGTERM no grupo de processos antes do SIGKILL.
- **Dossiê:** saíram Em 30 segundos (no modo tela cheia), Linha do dia, linha de Confiança, cotações duplicadas, Como ler, rótulo "Topo" e changelog que repetia o resumo. A faixa do topo respeita os botões da janela; abaixo de 1180 px some o mercado lateral e abaixo de 860 px o sumário.
