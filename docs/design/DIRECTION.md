# Direção de design — Personal Space

Documento-âncora. Toda tela é validada contra o **checklist** do fim antes de ser dada como pronta.

## Ideia central

O app é um **ateliê pessoal**: cada tema é uma obra pintada a óleo (espátula, empasto grosso) que vira o ambiente
inteiro — o papel de parede, a paleta, os materiais e a tipografia nascem da obra. A interface é vidro fino sobre a
pintura: some quando não é necessária e nunca compete com a arte.

## Princípios

1. **A arte manda.** A UI pega a paleta da obra; o lado da tela onde a obra respira (terço direito) fica livre.
2. **Hierarquia tipográfica forte.** Um display por tema, grande e confiante; texto de UI em SF Pro, pequeno e calmo.
3. **Vidro com propósito.** Painéis com desfoque, borda de 1 px com brilho no topo, sombra longa e suave. Nada de
   "caixa cinza".
4. **Movimento que explica.** Toda mudança de estado tem uma transição curta (180–420 ms), com saída rápida e
   entrada suave (expo-out). Nada anima sem motivo; tudo respeita "reduzir movimento".
5. **Leve.** Animações só em `transform`/`opacity`; 3D só quando a tela está visível; arte carregada sob demanda.

## Movimento

| Token | Valor | Uso |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | entradas, indicadores |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | trocas de estado |
| `--t-fast` | 160 ms | hover, toque |
| `--t-med` | 280 ms | painéis, abas |
| `--t-slow` | 520 ms | troca de página, tema |

- **Troca de página:** View Transitions — a página antiga sai com leve recuo e desfoque, a nova sobe 8 px e aparece.
  Barra lateral fica parada.
- **Entrada de conteúdo:** blocos da página entram em cascata (45 ms entre cada um).
- **Troca de tema:** a nova obra se revela num círculo que nasce do ponto clicado.
- **Indicador da barra lateral:** uma pílula única desliza até o item ativo.

## Temas

Cada tema tem uma pasta `src/assets/themes/<id>/` com `PROMPT.md` (prompt da obra) e o arquivo `arte.jpg` que o dono
gera. Sem arte, o tema mostra só um degradê da própria paleta — nunca uma pintura falsa feita por código.

## Checklist de validação (por tela)

- [ ] Hierarquia clara em 3 segundos: o que é principal, secundário, ação.
- [ ] Contraste do texto ≥ 4.5:1 sobre a arte em qualquer tema (o véu do tema garante).
- [ ] Espaçamentos na grade de 4/8 px; alinhamentos verticais consistentes.
- [ ] Estados: vazio, carregando, erro, hover, foco visível, desabilitado.
- [ ] Toda mudança de estado tem transição; nenhuma "pula".
- [ ] Teclado: tudo alcançável; Esc fecha; atalhos documentados.
- [ ] 60 fps nas transições (medido no Chrome e no app), nada animando parado.
- [ ] Conferido nos temas Editorial, um claro de arte (Surf) e um escuro (Noir).
