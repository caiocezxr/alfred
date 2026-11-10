# Alfred: o que tem por debaixo dos panos

App de macOS em **Tauri 2** (Rust + React/TypeScript). Os dados ficam na máquina, num **SQLite** local. Segredos ficam no **Keychain**. A rede só fala com os serviços listados abaixo.

## IA

| O quê | Onde entra | Como paga |
|---|---|---|
| **Claude Code** (adaptador ACP `claude-agent-acp`) | Agente das desks da Sessão | Assinatura: login do Claude Code ou token `claude setup-token` no Keychain |
| **Codex** (adaptador ACP `codex-acp`) | Agente das desks da Sessão | Conta do ChatGPT; contas extras em pastas do Alfred |
| **Codex CLI** (`codex exec`, só leitura) | Juiz do Briefing: escolhe e escreve as notícias | Conta do ChatGPT |
| **Ollama** (local, `127.0.0.1:11434`) | Chat "Local" da Sessão; embeddings para escolher skills; tradução de manchetes e gosto pessoal do Briefing | Grátis, roda na máquina |
| **Kokoro-82M** (ONNX via `@huggingface/transformers` + `espeak-ng`) | Voz do Briefing | Grátis; o modelo é baixado uma vez do Hugging Face |
| **Voz do macOS** (`say`) | Narração alternativa do Briefing | Do sistema |

Regra da Sessão: **nunca usa chave de API**. O Alfred apaga `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY` e afins do ambiente. Se um agente disser que entrou por chave, o Alfred derruba a sessão.

## O que vai junto com cada agente da Sessão

- **Persona** de tech lead (editável por perfil).
- **Skills de base, sempre ligadas:** `i-have-adhd`, `ponytail`, `caveman`. Além delas, as skills do perfil e uma escolha automática por pedido, feita com embeddings do Ollama.
- **MCP opcional por perfil:** `playwright`, `context7`, `chrome-devtools` ou servidores próprios.
- **Contexto da desk:** o que foi dito aos outros agentes desde a última mensagem.
- **Isolar:** cada agente numa git worktree própria (branch `alfred/<desk>-<agente>`).

## Integrações

| Integração | Para quê |
|---|---|
| **GitHub** (`gh` CLI + `api.github.com`, várias contas) | PRs, checks, diffs e comentários na Workstation; troca de conta ativa |
| **Sessões locais do Claude Code e do Codex** (`~/.claude`, `~/.codex`) | Histórico das desks, ligação com PRs, continuar no Terminal |
| **Zendesk da Statix** | Só o link do chamado no card (sem API) |
| **macOS** | Keychain, notificações nativas, abrir links no navegador, janela com vibração |

## APIs e serviços externos

| Serviço | Uso | Conta |
|---|---|---|
| **Open-Meteo** | Clima de Fortaleza e Recife na Home | Sem conta |
| **CoinGecko** | Bitcoin e Ethereum | Sem conta |
| **AwesomeAPI** | Dólar e euro | Sem conta |
| **Banco Central (SGS)** | Selic e IPCA | Sem conta |
| **Yahoo Finance** | Ibovespa | Sem conta |
| **Feeds RSS/Atom** (OpenAI, DeepMind, HN, Simon Willison, GitHub, releases de claude-code, codex, tauri, react etc.) | Radar e Briefing; só fontes cadastradas | Sem conta |
| **Hugging Face** | Download do modelo de voz | Sem conta |
| **GitHub** | Ver Integrações | Suas contas via `gh` |

## Onde ficam as coisas

- Banco: `~/Library/Application Support/app.personalspace.desktop/personal-space.sqlite`, com backup automático antes de cada migração.
- Adaptadores ACP, skills do Alfred e worktrees do Isolar: na mesma pasta (`oficina/`, `skills-plugin/`, `worktrees/`).
- Segredos (tokens do Claude, dados sensíveis da Workstation): Keychain do macOS.
