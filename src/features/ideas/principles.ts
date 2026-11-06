import type { PrincipleId } from './questions.ts'

export type Principle = {
  id: PrincipleId
  title: string
  essence: string
  points: string[]
  ask: string
}

export const PRINCIPLES: Principle[] = [
  {
    id: 'pain',
    title: 'Descoberta de dor',
    essence: 'Dor real aparece em histórias do passado, não em opiniões sobre o futuro.',
    points: [
      'Pergunte pela última vez que o problema aconteceu, o que a pessoa fez e quanto custou — em tempo, dinheiro ou paciência.',
      'Fuja do “você usaria?”. Todo mundo é gentil com a ideia dos outros; o comportamento passado não mente.',
      'Se ninguém tentou resolver, nem com gambiarra, talvez não doa o bastante.',
      'Anote as palavras exatas das pessoas: elas viram título, anúncio e oferta depois.',
    ],
    ask: 'Quem perdeu algo por causa disso nas últimas semanas?',
  },
  {
    id: 'offer',
    title: 'Oferta',
    essence: 'Oferta é a promessa inteira: para quem, qual resultado, em quanto tempo e por quanto.',
    points: [
      'Escreva em uma frase. Se precisa de um parágrafo, ainda não está clara.',
      'Venda o resultado, não a lista de funcionalidades. Ninguém quer um app; querem a tarde livre.',
      'Uma oferta para um público estreito convence mais que uma genérica para todos.',
      'Dá para apresentar a oferta antes de o produto existir — e é aí que ela mais ensina.',
    ],
    ask: 'Alguém do público entende e decide em dez segundos?',
  },
  {
    id: 'distribution',
    title: 'Distribuição',
    essence: 'Um produto bom sem caminho até o público é um segredo bem guardado.',
    points: [
      'Antes de construir, saiba onde cem pessoas do público estão reunidas hoje.',
      'Prefira canais onde você já tem acesso ou reputação; começar do zero custa caro.',
      'Anúncio pago testa mensagem, mas não substitui um canal que você controla.',
      'Teste a distribuição falando do problema; a solução pode vir depois.',
    ],
    ask: 'Consigo falar com vinte pessoas do público esta semana sem pagar?',
  },
  {
    id: 'opportunity',
    title: 'Custo de oportunidade',
    essence: 'Cada ideia em andamento custa as outras que você não está testando.',
    points: [
      'Uma ideia em teste por vez: com foco, o sinal aparece mais rápido.',
      'Decida antes o que faria você parar — e respeite quando acontecer.',
      'Arquivar não é fracasso: é liberar atenção para a próxima aposta.',
      'Some o tempo de manutenção futura, não só o de construção.',
    ],
    ask: 'Se eu fizer isto nas próximas duas semanas, o que deixo de fazer?',
  },
  {
    id: 'price',
    title: 'Preço',
    essence: 'Preço é uma pergunta ao mercado — e a resposta só vem quando alguém paga.',
    points: [
      'Diga um preço cedo. Esconder o preço esconde a informação mais útil do teste.',
      'Compare com o custo atual do problema, não com o preço de outros apps.',
      'Começar grátis adia a pergunta principal; um piloto pago pequeno ensina mais.',
      'Condição especial para os primeiros é melhor que grátis para todos.',
    ],
    ask: 'Alguém já colocou dinheiro, mesmo pouco, para resolver isso?',
  },
  {
    id: 'mvp',
    title: 'MVP',
    essence: 'O menor produto viável muitas vezes não é um produto: é você fazendo à mão.',
    points: [
      'Prove o valor manualmente primeiro; automatize só o que se repetiu.',
      'Corte login, painel e configurações. Ninguém compra infraestrutura.',
      'Se leva mais que alguns dias, provavelmente não é o menor.',
      'Escolha ferramentas que não pedem manutenção quando você está ocupado.',
    ],
    ask: 'O que eu entregaria amanhã se não pudesse escrever código?',
  },
  {
    id: 'validation',
    title: 'Validação',
    essence: 'Validar é procurar sinais que custam algo a quem dá — não elogios.',
    points: [
      'Defina a meta antes do teste. Meta escolhida depois sempre é batida.',
      'Elogio é ruído; pagamento, reserva, tempo na agenda e indicação são sinal.',
      'Um bom teste pode dar errado. Se não tem como falhar, não está testando nada.',
      'Registre o que aconteceu, inclusive o que contradiz a ideia.',
    ],
    ask: 'Qual resultado me faria desistir? Escrevi isso antes de começar?',
  },
  {
    id: 'content',
    title: 'Experimentos de conteúdo',
    essence: 'Canal se constrói com formato repetível e ajustes pequenos, não com uma peça viral.',
    points: [
      'Faça três peças à mão antes de qualquer automação; o formato se revela no fazer.',
      'Mude uma coisa por vez — gancho, duração ou tema — para saber o que funcionou.',
      'Olhe retenção e respostas antes de seguidores; números grandes e rasos enganam.',
      'A consistência que cabe na sua semana vence a intensidade que dura um mês.',
    ],
    ask: 'Eu conseguiria publicar isso toda semana por três meses?',
  },
]

export const PRINCIPLE_BY_ID = Object.fromEntries(PRINCIPLES.map((p) => [p.id, p])) as Record<PrincipleId, Principle>
