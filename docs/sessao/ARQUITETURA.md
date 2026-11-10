# Sessão: arquitetura e manutenção

A Sessão é o produto do Shed onde Claude, Codex e modelos locais trabalham juntos em desks, pelas assinaturas, sem crédito de API. Ela complementa a Workstation: a Workstation organiza o trabalho, a Sessão executa.

## Camadas

| Camada | Onde | Responsabilidade |
|---|---|---|
| Motores | `~/Library/Application Support/app.personalspace.desktop/oficina` | Adaptadores ACP oficiais (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`), com versão fixa no `package.json` dessa pasta |
| Ponte | `src-tauri/src/oficina.rs` | Abre cada agente como processo, fala JSON-RPC (ACP) por stdin/stdout, repassa eventos para a tela, recusa chave de API, injeta token da assinatura, persona, skills, plugins e MCP por sessão |
| Arsenal | `src-tauri/src/sessao.rs` | Catálogo de skills instaladas, biblioteca de skills do Shed, contas do Codex com histórico compartilhado, versões dos motores, atualização testada e volta de versão |
| Estado da tela | `src/features/oficina/store.ts` | Único lugar que interpreta eventos ACP (`apply`). Mudou o protocolo, muda só aqui |
| Configuração | `src/features/oficina/cofre.ts` | Configuração por perfil (cofre), com `schema` versionado e `migrate()` |
| Tela | `Oficina.tsx`, `Bench.tsx`, `Arsenal.tsx` | Desks, bancada (código, arquivos, plano, terminal, agentes) e arsenal |

## Regras que mantêm de pé

1. **Só assinatura.** O ambiente dos agentes nunca recebe `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` nem `CODEX_API_KEY`. Se o agente anunciar autenticação por chave, a ponte derruba a sessão. O Claude entra pelo login do Claude Code ou pelo token de `claude setup-token`, guardado no Keychain por conta.
2. **Nada fora do Shed muda.** Persona, skills, plugins e MCP vão por sessão (`_meta.systemPrompt`, `_meta.claudeCode.options`, `mcpServers`). Nenhum arquivo do `~/.claude` ou do `~/.codex` é editado. Contas extras do Codex vivem em pastas do Shed, com a pasta `sessions` ligada à do Codex para o histórico ser o mesmo.
3. **Protocolo num lugar só.** Toda leitura de evento passa por `apply()` em `store.ts`. Componentes nunca leem JSON cru do agente.
4. **Versão fixa, atualização testada.** Arsenal › Motores mostra a versão instalada e a mais nova. Atualizar instala a nova numa pasta separada, faz o aperto de mão (`initialize`) com cada adaptador e só troca se o protocolo responder certo. A versão anterior fica guardada para voltar com um clique.
5. **Configuração versionada.** `cofre.ts` grava `schema`. Mudou o formato, sobe o número e a `migrate()` converte o que existe, sem perder o que o usuário configurou.
6. **Leve.** Agentes são processos separados; o Shed só desenha. Eventos são juntados por quadro de tela, a conversa mostra só o trecho final, agente parado pode ser fechado e reaberto retomando a mesma sessão, e o medidor de consumo mostra quem está pesando.

## Testes que travam regressão

- `oficina.rs`: parâmetros de sessão por agente (persona, skills, plugins, MCP), validação de MCP, blocos de prompt e imagens, recusa de chave de API, formato do token.
- `sessao.rs`: leitura de frontmatter, links do GitHub aceitos, nomes saneados.
- Rodar `cargo test` em `src-tauri` antes de publicar.

## Roteiro de atualização

1. Arsenal › Motores › **Ver se tem versão nova**.
2. **Atualizar**. Se o teste falhar, nada muda e a mensagem diz qual motor recusou.
3. Abrir uma desk e mandar uma mensagem curta para cada agente.
4. Se algo estranho aparecer, **Voltar versão**.
5. Se o protocolo mudar de verdade, ajustar `apply()` em `store.ts` e os testes de `oficina.rs`.
