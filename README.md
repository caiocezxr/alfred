# Shed

App pessoal para macOS: o dia, o trabalho e os agentes de IA num lugar só. Feito com **Tauri 2** (Rust + React/TypeScript). Os dados ficam na máquina, num **SQLite** local, e os segredos no **Keychain**.

## Módulos

| Módulo | O que faz |
|---|---|
| **Home** | Saudação, clima, cartão Hoje e o Briefing do dia |
| **Briefing / Dossiê** | Notícias do dia filtradas pelo seu perfil, com cotações e narração por voz |
| **Workstation** | Espaços Statix, Livelo e Pessoal: to-dos, chamados, PRs e standup |
| **Sessão** | Desks onde Claude, Codex e um modelo local trabalham juntos, em paralelo |
| **Bíblia** | Leitura com livro 3D (Bíblia Livre TR) |
| **Notas, Ideias, Radar, Hábitos, Humor** | Editor com busca, laboratório de ideias, feeds curados, hábitos e check-in diário |

## IA

| O quê | Onde entra | Como paga |
|---|---|---|
| **Claude Code** (adaptador ACP `claude-agent-acp`) | Agente das desks da Sessão | Assinatura: login do Claude Code ou token `claude setup-token` no Keychain |
| **Codex** (adaptador ACP `codex-acp`) | Agente das desks da Sessão | Conta do ChatGPT; contas extras em pastas do Shed |
| **Codex CLI** (`codex exec`, só leitura) | Juiz do Briefing: escolhe e escreve as notícias | Conta do ChatGPT |
| **Ollama** (local) | Chat "Local" da Sessão, embeddings para escolher skills, tradução de manchetes e gosto pessoal do Briefing | Grátis, roda na máquina |
| **Kokoro-82M** (ONNX via `@huggingface/transformers` + `espeak-ng`) | Voz do Briefing | Grátis; modelo baixado uma vez do Hugging Face |
| **Voz do macOS** (`say`) | Narração alternativa | Do sistema |

A Sessão **nunca usa chave de API**: o Shed tira `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY` e afins do ambiente e derruba qualquer sessão que tente entrar por chave.

Cada agente da Sessão recebe:

- persona de tech lead (editável por perfil);
- skills de base sempre ligadas (`i-have-adhd`, `ponytail`, `caveman`), as skills do perfil e uma escolha automática por pedido;
- MCP opcional por perfil (`playwright`, `context7`, `chrome-devtools` ou servidores próprios);
- o que foi dito aos outros agentes da desk desde a última mensagem dele;
- com **Isolar** ligado, uma git worktree própria (branch `shed/<desk>-<agente>`).

## Integrações

| Integração | Para quê |
|---|---|
| **GitHub** (`gh` CLI + `api.github.com`, várias contas) | PRs, checks, diffs e comentários na Workstation |
| **Sessões locais do Claude Code e do Codex** | Histórico das desks, ligação com PRs, continuar no Terminal |
| **Zendesk** | Link do chamado no card (sem API) |
| **macOS** | Keychain, notificações, abrir links no navegador, janela com vibração |

## APIs externas

Nenhuma exige conta.

| Serviço | Uso |
|---|---|
| **Open-Meteo** | Clima de Fortaleza e Recife |
| **CoinGecko** | Bitcoin e Ethereum |
| **AwesomeAPI** | Dólar e euro |
| **Banco Central (SGS)** | Selic e IPCA |
| **Yahoo Finance** | Ibovespa |
| **Feeds RSS/Atom** | Radar e Briefing, só de fontes cadastradas |
| **Hugging Face** | Download do modelo de voz |

## Rodar

```bash
npm install
npm run app                              # app nativo em modo dev
npm run dev                              # só a interface no navegador (dados em localStorage)
npx tauri build --bundles app            # gera src-tauri/target/release/bundle/macos/Shed.app
cd src-tauri && cargo test               # testes do lado Rust
```

Precisa de Node, Rust (`rustup`) e Xcode Command Line Tools. Para a Sessão: Claude Code e/ou Codex logados na máquina; Ollama é opcional.

## Onde ficam os dados

- Banco: `~/Library/Application Support/app.personalspace.desktop/personal-space.sqlite`, com backup automático antes de cada migração.
- Na mesma pasta: adaptadores ACP (`oficina/`), skills do Shed (`skills-plugin/`) e worktrees do Isolar (`worktrees/`).
- Segredos: Keychain do macOS.

Decisões e histórico em [`DECISIONS.md`](DECISIONS.md); arquitetura da Sessão em [`docs/sessao/ARQUITETURA.md`](docs/sessao/ARQUITETURA.md).
