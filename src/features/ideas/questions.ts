import type { IdeaKind, IdeaStatus } from './types.ts'

export type CriterionId =
  | 'pain' | 'distribution' | 'monetization' | 'test' | 'execution' | 'evidence'
  | 'audience' | 'discovery' | 'format' | 'cost' | 'future' | 'signal'

export type Level = 'evidenced' | 'hypothesis' | 'alert' | 'unknown'
export type Tone = 'good' | 'maybe' | 'risk' | 'unknown'
export type FlagId = 'no_audience' | 'no_channel' | 'spend_first' | 'expensive_dep' | 'no_pain'
export type PrincipleId = 'pain' | 'offer' | 'distribution' | 'opportunity' | 'price' | 'mvp' | 'validation' | 'content'

export type Choice = {
  id: string
  label: string
  means: string
  effects: Partial<Record<CriterionId, Level>>
  tone?: Tone
  flag?: FlagId
  marks?: ('weak_pain' | 'no_edge')[]
}

export type Question = {
  id: string
  kind: IdeaKind
  criterion: CriterionId
  short: string
  prompt: string
  help: string
  placeholder: string
  choices: Choice[]
}

export type TestPlan = { action: string; target: string; goal: string }
export type NoteOf = (questionId: string) => string | null

export type CriterionDef = {
  id: CriterionId
  kind: IdeaKind
  label: string
  core: boolean
  principle: PrincipleId
  hypothesis: (note: NoteOf) => string
  validate: string
  plan: TestPlan
}

export type FlagDef = {
  id: FlagId
  label: string
  byKind: Record<IdeaKind, { criterion: CriterionId; detail: string; validate: string; plan: TestPlan; dont: string }>
}

export const KIND_LABEL: Record<IdeaKind, string> = {
  product: 'Produto digital / micro-SaaS',
  content: 'Conteúdo / canal / perfil',
}
export const KIND_SHORT: Record<IdeaKind, string> = { product: 'Produto', content: 'Conteúdo' }

export const STATUS_LABEL: Record<IdeaStatus, string> = {
  captured: 'Capturada',
  evaluating: 'Em avaliação',
  testing: 'Em teste',
  paused: 'Pausada',
  archived: 'Arquivada',
}
export const STATUS_ORDER: IdeaStatus[] = ['testing', 'evaluating', 'captured', 'paused', 'archived']

export const LEVEL_LABEL: Record<Level, string> = {
  evidenced: 'evidenciado',
  hypothesis: 'hipótese',
  unknown: 'desconhecido',
  alert: 'alerta',
}

const NAO_SEI = (means: string, c: CriterionId): Choice => ({ id: 'unknown', label: 'Não sei', means, effects: { [c]: 'unknown' } })

const PRODUCT: Question[] = [
  {
    id: 'p_who', kind: 'product', criterion: 'pain', short: 'Quem sente a dor',
    prompt: 'Quem exatamente sente a dor?',
    help: 'Quanto mais específico, mais fácil achar e conversar. “Pequenas empresas” é vago; “donos de pet shop com até 3 funcionários” é testável.',
    placeholder: 'Ex.: nutricionistas que atendem online',
    choices: [
      { id: 'named', label: 'Consigo citar pessoas reais', means: 'Você consegue citar pessoas reais que sentem a dor.', effects: { pain: 'evidenced' } },
      { id: 'profile', label: 'Tenho um perfil claro, sem nomes', means: 'O público é um perfil claro, mas ainda sem pessoas concretas.', effects: { pain: 'hypothesis' } },
      { id: 'anyone', label: 'Muita gente — difícil recortar', means: 'O público ainda é amplo demais para encontrar e abordar.', effects: { pain: 'alert' }, flag: 'no_audience' },
      NAO_SEI('Ainda não está claro quem sente a dor.', 'pain'),
    ],
  },
  {
    id: 'p_payer', kind: 'product', criterion: 'monetization', short: 'Quem paga',
    prompt: 'Quem paga? É a mesma pessoa que sente a dor?',
    help: 'Quem usa nem sempre é quem paga. Se for outra pessoa (empresa, chefe, família), a venda fica diferente — e mais longa.',
    placeholder: 'Ex.: a própria pessoa, no cartão',
    choices: [
      { id: 'confirmed', label: 'Sei quem paga e já confirmei', means: 'Quem paga está identificado e confirmado.', effects: { monetization: 'evidenced' } },
      { id: 'guess', label: 'Tenho um palpite', means: 'Quem paga é um palpite ainda não confirmado.', effects: { monetization: 'hypothesis' } },
      { id: 'nobody', label: 'Ninguém pagaria diretamente', means: 'Ninguém pagaria diretamente pela solução.', effects: { monetization: 'alert' } },
      NAO_SEI('Não está claro quem pagaria.', 'monetization'),
    ],
  },
  {
    id: 'p_problem', kind: 'product', criterion: 'pain', short: 'Problema e frequência',
    prompt: 'Qual problema concreto e frequente existe?',
    help: 'Um problema que aparece toda semana pesa mais que um incômodo raro. Pense na última vez que aconteceu com alguém.',
    placeholder: 'Ex.: perde 2 h por semana conciliando agendas',
    choices: [
      { id: 'heard', label: 'Ouvi de quem sente, e é frequente', means: 'Você ouviu de quem sente que o problema é frequente.', effects: { pain: 'evidenced', evidence: 'evidenced' } },
      { id: 'believe', label: 'Acho que é frequente', means: 'A frequência do problema é uma suposição sua.', effects: { pain: 'hypothesis' } },
      { id: 'rare', label: 'É raro ou um incômodo leve', means: 'O problema parece raro ou leve.', effects: { pain: 'alert' }, marks: ['weak_pain'] },
      NAO_SEI('A frequência do problema ainda é desconhecida.', 'pain'),
    ],
  },
  {
    id: 'p_today', kind: 'product', criterion: 'pain', short: 'Solução atual',
    prompt: 'Como esse problema é resolvido hoje?',
    help: 'A solução atual é a sua concorrente de verdade — inclusive planilha, mensagem no celular e “deixar para lá”.',
    placeholder: 'Ex.: planilha + lembrete no celular',
    choices: [
      { id: 'pays', label: 'Pagam por algo que deixa a desejar', means: 'Já existe gasto com o problema, e a solução atual deixa a desejar.', effects: { pain: 'evidenced', monetization: 'hypothesis' } },
      { id: 'workaround', label: 'Improvisam: planilha, manual, mensagens', means: 'Hoje as pessoas improvisam — sinal de dor sem solução boa.', effects: { pain: 'hypothesis' } },
      { id: 'solved', label: 'Já é bem resolvido; meu diferencial não é claro', means: 'O problema já é bem resolvido e o diferencial não está claro.', effects: { pain: 'alert' }, marks: ['no_edge'] },
      NAO_SEI('Não se sabe como o problema é resolvido hoje.', 'pain'),
    ],
  },
  {
    id: 'p_channel', kind: 'product', criterion: 'distribution', short: 'Canal até o público',
    prompt: 'Por qual canal esse público seria alcançado sem gastar muito?',
    help: 'Distribuição derruba mais ideias que o produto. Pense onde essas pessoas já estão: grupos, fóruns, eventos, a sua rede.',
    placeholder: 'Ex.: grupo de nutricionistas no Telegram',
    choices: [
      { id: 'access', label: 'Já tenho acesso direto a esse público', means: 'Você já tem acesso direto ao público.', effects: { distribution: 'evidenced' } },
      { id: 'plausible', label: 'Sei onde estão, mas não testei', means: 'Existe um canal plausível, ainda não testado.', effects: { distribution: 'hypothesis' } },
      { id: 'paid', label: 'Só com anúncio pago', means: 'O único caminho visto até o público é pagar por alcance.', effects: { distribution: 'alert' }, flag: 'no_channel' },
      NAO_SEI('Não está claro por onde alcançar o público.', 'distribution'),
    ],
  },
  {
    id: 'p_offer', kind: 'product', criterion: 'monetization', short: 'Oferta e preço',
    prompt: 'Qual seria a oferta e o preço inicial?',
    help: 'Uma frase: o que a pessoa recebe e quanto paga. Preço definido deixa o teste mais honesto — mesmo que mude depois.',
    placeholder: 'Ex.: R$ 49/mês, agenda + lembretes automáticos',
    choices: [
      { id: 'defined', label: 'Oferta e preço definidos', means: 'Oferta e preço estão definidos.', effects: { monetization: 'hypothesis' }, tone: 'good' },
      { id: 'rough', label: 'Só uma ideia vaga', means: 'Oferta e preço ainda estão vagos.', effects: { monetization: 'unknown' }, tone: 'maybe' },
      { id: 'free', label: 'Seria grátis no começo', means: 'Começar grátis adia a pergunta principal: alguém paga?', effects: { monetization: 'unknown' }, tone: 'risk' },
      NAO_SEI('Oferta e preço ainda não foram pensados.', 'monetization'),
    ],
  },
  {
    id: 'p_intent', kind: 'product', criterion: 'monetization', short: 'Intenção de pagamento',
    prompt: 'Já houve sinal de intenção de pagamento?',
    help: 'Dizer “eu pagaria” é barato. Sinal de verdade custa algo a quem dá: dinheiro, reserva, horário na agenda.',
    placeholder: 'Ex.: 2 pessoas pediram para avisar quando abrir',
    choices: [
      { id: 'paid', label: 'Alguém pagou, reservou ou encomendou', means: 'Alguém já pagou, reservou ou encomendou.', effects: { monetization: 'evidenced', evidence: 'evidenced' } },
      { id: 'said', label: 'Disseram que pagariam', means: 'Houve intenção declarada, sem compromisso.', effects: { monetization: 'hypothesis', evidence: 'hypothesis' } },
      { id: 'not_yet', label: 'Ainda não ofereci', means: 'Ainda não houve oferta, então não há sinal de pagamento.', effects: { monetization: 'unknown', evidence: 'unknown' }, tone: 'unknown' },
      { id: 'refused', label: 'Ofereci e recusaram', means: 'A oferta foi feita e recusada.', effects: { monetization: 'alert', evidence: 'alert' } },
    ],
  },
  {
    id: 'p_test', kind: 'product', criterion: 'test', short: 'Teste sem código',
    prompt: 'Qual a menor forma de testar sem desenvolver o sistema?',
    help: 'Página simples, demonstração, serviço feito à mão, conversa com proposta. Se só dá para saber construindo, o risco sobe.',
    placeholder: 'Ex.: fazer à mão para 3 clientes por 2 semanas',
    choices: [
      { id: 'ready', label: 'Tenho o teste e dá para fazer esta semana', means: 'Existe um teste sem código possível nesta semana.', effects: { test: 'evidenced' } },
      { id: 'idea', label: 'Tenho uma ideia de teste sem código', means: 'Há uma ideia de teste sem código, ainda não detalhada.', effects: { test: 'hypothesis' } },
      { id: 'build', label: 'Só dá para saber construindo ou pagando', means: 'Para testar seria preciso construir ou pagar antes.', effects: { test: 'alert' }, flag: 'spend_first' },
      NAO_SEI('Ainda não há ideia de como testar sem construir.', 'test'),
    ],
  },
  {
    id: 'p_mvp', kind: 'product', criterion: 'execution', short: 'MVP pequeno',
    prompt: 'Dá para construir um MVP pequeno, com vibe coding e pouca manutenção?',
    help: 'Pequeno é algo que você termina em dias, não semanas — e que não quebra sozinho quando você não está olhando.',
    placeholder: 'Ex.: 3 telas, sem login no começo',
    choices: [
      { id: 'done_before', label: 'Sim — já construí algo parecido', means: 'Você já construiu algo parecido.', effects: { execution: 'evidenced' } },
      { id: 'days', label: 'Acho que cabe em poucos dias', means: 'A estimativa é de poucos dias de construção.', effects: { execution: 'hypothesis' } },
      { id: 'big', label: 'Não: é grande, complexo ou frágil', means: 'O MVP seria grande, complexo ou de manutenção pesada.', effects: { execution: 'alert' } },
      NAO_SEI('O tamanho do MVP ainda é incerto.', 'execution'),
    ],
  },
  {
    id: 'p_deps', kind: 'product', criterion: 'execution', short: 'Dependências e custos',
    prompt: 'Exige atendimento manual, dependências externas, custos recorrentes ou integrações difíceis?',
    help: 'API paga por uso, aprovação de terceiros, suporte um a um e integrações frágeis comem margem e tempo.',
    placeholder: 'Ex.: depende da API oficial do WhatsApp',
    choices: [
      { id: 'none', label: 'Nada relevante', means: 'Não há dependências ou custos recorrentes relevantes.', effects: { execution: 'hypothesis' }, tone: 'good' },
      { id: 'light', label: 'Algo leve e controlável', means: 'Há dependências leves e controláveis.', effects: { execution: 'hypothesis' } },
      { id: 'heavy', label: 'Sim: custo recorrente alto ou integração difícil', means: 'Há custo recorrente alto ou integração difícil.', effects: { execution: 'alert' }, flag: 'expensive_dep' },
      NAO_SEI('Dependências e custos ainda não foram levantados.', 'execution'),
    ],
  },
]

const CONTENT: Question[] = [
  {
    id: 'c_audience', kind: 'content', criterion: 'audience', short: 'Público e plataforma',
    prompt: 'Qual público, nicho e plataforma?',
    help: 'Nicho estreito cresce mais rápido que tema amplo. Diga para quem é e onde vai morar.',
    placeholder: 'Ex.: devs iniciantes em Python, no YouTube',
    choices: [
      { id: 'have', label: 'Já tenho público nesse nicho', means: 'Você já tem público nesse nicho.', effects: { audience: 'evidenced' } },
      { id: 'defined', label: 'Nicho e plataforma definidos', means: 'Nicho e plataforma estão definidos.', effects: { audience: 'hypothesis' } },
      { id: 'broad', label: 'Amplo — “quem gosta de IA”', means: 'O público ainda é amplo demais.', effects: { audience: 'alert' }, flag: 'no_audience' },
      NAO_SEI('Público e plataforma ainda não estão definidos.', 'audience'),
    ],
  },
  {
    id: 'c_value', kind: 'content', criterion: 'audience', short: 'Transformação entregue',
    prompt: 'Qual transformação ou entretenimento entrega?',
    help: 'O que a pessoa leva depois de assistir ou ler: aprende algo, economiza tempo, ri, se sente acompanhada.',
    placeholder: 'Ex.: um script pronto por semana para automatizar planilhas',
    choices: [
      { id: 'asked', label: 'Pedem isso em comentários e comunidades', means: 'Pessoas do nicho já pedem esse tipo de conteúdo.', effects: { audience: 'evidenced', signal: 'evidenced' } },
      { id: 'clear', label: 'Clara e diferente do que já existe', means: 'A promessa é clara e parece diferente do que existe.', effects: { audience: 'hypothesis' } },
      { id: 'generic', label: 'Parecida com o que muita gente já faz', means: 'A promessa se parece com o que já existe.', effects: { audience: 'alert' }, flag: 'no_pain' },
      NAO_SEI('A transformação entregue ainda não está clara.', 'audience'),
    ],
  },
  {
    id: 'c_format', kind: 'content', criterion: 'format', short: 'Formato e gancho',
    prompt: 'Qual formato se repetiria toda semana? Qual o gancho inicial?',
    help: 'Formato repetível é uma fórmula: mesma estrutura, assunto novo. O gancho é a primeira frase ou os três primeiros segundos.',
    placeholder: 'Ex.: “Automatizei X em 60 s” — tela + voz',
    choices: [
      { id: 'tested', label: 'Já testei esse formato', means: 'O formato já foi testado na prática.', effects: { format: 'evidenced' } },
      { id: 'defined', label: 'Formato e gancho definidos', means: 'Formato e gancho estão definidos.', effects: { format: 'hypothesis' } },
      { id: 'vague', label: 'Ainda vago', means: 'O formato ainda está vago.', effects: { format: 'unknown' }, tone: 'maybe' },
      NAO_SEI('O formato ainda não foi pensado.', 'format'),
    ],
  },
  {
    id: 'c_manual', kind: 'content', criterion: 'format', short: 'Três peças à mão',
    prompt: 'Dá para produzir três peças à mão, sem automação primeiro?',
    help: 'Três peças manuais mostram o formato, o tempo real de produção e a primeira reação — antes de qualquer ferramenta.',
    placeholder: 'Ex.: gravo no celular e edito no app gratuito',
    choices: [
      { id: 'done', label: 'Sim — já fiz uma ou mais', means: 'Você já produziu peças à mão.', effects: { format: 'evidenced' } },
      { id: 'yes', label: 'Sim, dá para fazer esta semana', means: 'Dá para produzir três peças à mão nesta semana.', effects: { format: 'hypothesis' } },
      { id: 'no', label: 'Só com automação ou ferramenta paga', means: 'Produzir dependeria de automação ou ferramenta paga.', effects: { format: 'alert' }, flag: 'spend_first' },
      NAO_SEI('Não está claro se dá para produzir à mão.', 'format'),
    ],
  },
  {
    id: 'c_discovery', kind: 'content', criterion: 'discovery', short: 'Hipótese de distribuição',
    prompt: 'Qual a hipótese de distribuição?',
    help: 'Como alguém que não te conhece vai encontrar a peça: busca, recomendação do algoritmo, comunidade, parceria.',
    placeholder: 'Ex.: busca no YouTube por “automatizar excel”',
    choices: [
      { id: 'community', label: 'Comunidade ou audiência onde já tenho espaço', means: 'Você já tem espaço numa comunidade ou audiência.', effects: { discovery: 'evidenced' } },
      { id: 'search', label: 'Busca ou recomendação, com temas claros', means: 'A descoberta depende de busca ou recomendação, ainda não testada.', effects: { discovery: 'hypothesis' } },
      { id: 'none', label: 'Não vejo como alguém acharia', means: 'Não há um caminho visível até quem não te conhece.', effects: { discovery: 'alert' }, flag: 'no_channel' },
      NAO_SEI('A forma de descoberta ainda é desconhecida.', 'discovery'),
    ],
  },
  {
    id: 'c_future', kind: 'content', criterion: 'future', short: 'Monetização futura',
    prompt: 'Como monetizaria no futuro — sem presumir dinheiro agora?',
    help: 'Não precisa monetizar já. Mas vale saber se existe um caminho: produto próprio, serviço, patrocínio do nicho, afiliados.',
    placeholder: 'Ex.: curso curto depois de mil inscritos',
    choices: [
      { id: 'proven', label: 'Já vi esse nicho pagar por algo', means: 'O nicho já paga por produtos ou patrocínios.', effects: { future: 'evidenced' } },
      { id: 'path', label: 'Tenho um caminho plausível', means: 'Existe um caminho plausível de receita, não testado.', effects: { future: 'hypothesis' } },
      { id: 'not_goal', label: 'Não é para monetizar', means: 'Monetizar não é objetivo — o teste mede alcance e retenção.', effects: { future: 'hypothesis' }, tone: 'good' },
      NAO_SEI('O caminho de receita ainda é aberto — e tudo bem por enquanto.', 'future'),
    ],
  },
  {
    id: 'c_metric', kind: 'content', criterion: 'format', short: 'Métrica do teste',
    prompt: 'Qual métrica inicial mede o teste?',
    help: 'Escolha uma que mostre interesse real: retenção, respostas, salvamentos, cliques qualificados. Seguidores e curtidas enganam.',
    placeholder: 'Ex.: retenção acima de 50% nos três vídeos',
    choices: [
      { id: 'defined', label: 'Métrica e alvo definidos', means: 'Há uma métrica e um alvo definidos para o teste.', effects: { format: 'hypothesis' }, tone: 'good' },
      { id: 'vanity', label: 'Seguidores e curtidas', means: 'Seguidores e curtidas dizem pouco — prefira retenção ou respostas.', effects: { format: 'unknown' }, tone: 'risk' },
      NAO_SEI('A métrica do teste ainda não foi escolhida.', 'format'),
    ],
  },
  {
    id: 'c_cost', kind: 'content', criterion: 'cost', short: 'Custo de produção',
    prompt: 'Quanto custaria produzir e publicar com consistência?',
    help: 'Conte tempo por peça, ferramentas e o que precisaria pagar todo mês. Consistência vence intensidade.',
    placeholder: 'Ex.: 3 h por vídeo, sem custo fixo',
    choices: [
      { id: 'low', label: 'Quase só o meu tempo, e ele cabe', means: 'O custo é basicamente tempo, e ele cabe na sua semana.', effects: { cost: 'hypothesis' }, tone: 'good' },
      { id: 'time', label: 'Muito tempo por peça', means: 'Muito tempo por peça ameaça a consistência.', effects: { cost: 'alert' } },
      { id: 'paid', label: 'Ferramentas, equipe ou equipamento pagos', means: 'Produzir dependeria de ferramentas, equipe ou equipamento pagos.', effects: { cost: 'alert' }, flag: 'expensive_dep' },
      NAO_SEI('O custo de produção ainda não foi estimado.', 'cost'),
    ],
  },
  {
    id: 'c_proof', kind: 'content', criterion: 'signal', short: 'Sinal real',
    prompt: 'Já existe algum sinal real?',
    help: 'Uma peça publicada com números, respostas de desconhecidos, pedidos. Reação de amigos ajuda pouco.',
    placeholder: 'Ex.: um post teve 40 respostas de gente fora da minha rede',
    choices: [
      { id: 'numbers', label: 'Sim, com números de desconhecidos', means: 'Há números reais vindos de desconhecidos.', effects: { signal: 'evidenced' } },
      { id: 'friends', label: 'Só reações de conhecidos', means: 'Por enquanto só houve reação de conhecidos.', effects: { signal: 'hypothesis' } },
      { id: 'none', label: 'Ainda não publiquei nada', means: 'Ainda não há publicação, então não há sinal.', effects: { signal: 'unknown' }, tone: 'unknown' },
      { id: 'flop', label: 'Publiquei e não houve resposta', means: 'Algo parecido foi publicado e não teve resposta.', effects: { signal: 'alert' } },
    ],
  },
]

export const QUESTIONS: Record<IdeaKind, Question[]> = { product: PRODUCT, content: CONTENT }

const q = (note: NoteOf, id: string, before: string, fallback: string, after = '') => {
  const n = note(id)
  return n ? `${before}${n}${after}` : fallback
}

const PRODUCT_CRITERIA: CriterionDef[] = [
  {
    id: 'pain', kind: 'product', label: 'Dor e público', core: true, principle: 'pain',
    hypothesis: (n) => q(n, 'p_who', 'O público ', 'Existe um grupo específico que sente esse problema com frequência e se importa o bastante para mudar o que faz hoje.', ' sente esse problema com frequência e se importa o bastante para mudar o que faz hoje.'),
    validate: 'Converse com 5 pessoas do público e peça a história da última vez que o problema aconteceu — sem apresentar a sua ideia.',
    plan: {
      action: 'Faça 5 conversas de 20 minutos com quem sente a dor. Peça para contarem a última vez que o problema aconteceu e o que fizeram a respeito. Não apresente a ideia.',
      target: '5 pessoas do público, por contato direto',
      goal: 'Pelo menos 3 de 5 descrevem um caso recente sem você sugerir.',
    },
  },
  {
    id: 'distribution', kind: 'product', label: 'Distribuição', core: true, principle: 'distribution',
    hypothesis: (n) => q(n, 'p_channel', 'Dá para alcançar esse público por ', 'Existe um canal onde esse público pode ser alcançado sem pagar por alcance.', ' sem pagar por alcance.'),
    validate: 'Liste 3 lugares onde esse público já se reúne e confirme que você pode falar lá sem pagar.',
    plan: {
      action: 'Publique o problema (não a solução) em 2 lugares onde o público já está e convide para uma conversa ou lista de espera.',
      target: '2 comunidades ou grupos onde esse público conversa',
      goal: '10 respostas ou inscrições de pessoas do público.',
    },
  },
  {
    id: 'monetization', kind: 'product', label: 'Monetização', core: false, principle: 'price',
    hypothesis: (n) => q(n, 'p_offer', 'Alguém paga por ', 'Alguém paga por isso — não só diz que pagaria.', ' — não só diz que pagaria.'),
    validate: 'Apresente oferta e preço a 10 pessoas do público e peça um compromisso concreto: pagamento antecipado, reserva ou reunião marcada.',
    plan: {
      action: 'Monte uma página de uma tela com oferta e preço e ofereça diretamente a 10 pessoas. Peça um compromisso: pagamento antecipado, reserva ou horário marcado.',
      target: '10 pessoas do público, abordadas uma a uma',
      goal: '2 compromissos concretos em 10 abordagens.',
    },
  },
  {
    id: 'test', kind: 'product', label: 'Simplicidade de teste', core: true, principle: 'mvp',
    hypothesis: () => 'Dá para comprovar o interesse sem construir o sistema.',
    validate: 'Desenhe um teste sem código: página simples, demonstração ou o serviço feito à mão.',
    plan: {
      action: 'Resolva o problema à mão para 1 a 3 pessoas, como um serviço, sem software. Anote cada passo que se repete.',
      target: '1 a 3 pessoas que já relataram a dor',
      goal: '1 pessoa usa a versão manual duas vezes ou pede para continuar.',
    },
  },
  {
    id: 'execution', kind: 'product', label: 'Execução e custo', core: false, principle: 'opportunity',
    hypothesis: () => 'Um MVP pequeno se mantém com pouca manutenção e sem custos recorrentes altos.',
    validate: 'Liste dependências e custos mensais e procure uma versão manual que elimine o item mais caro.',
    plan: {
      action: 'Monte a versão mais simples com o que você já tem (planilha, formulário, automação gratuita) e anote o custo mensal estimado.',
      target: 'Você + 1 pessoa do público usando',
      goal: 'Versão manual rodando em até 2 dias, com o custo mensal por escrito.',
    },
  },
  {
    id: 'evidence', kind: 'product', label: 'Evidência real', core: false, principle: 'validation',
    hypothesis: () => 'O interesse que você percebe aparece em ações de outras pessoas, não só na sua convicção.',
    validate: 'Busque um sinal que custe algo a quem dá: pagamento, reserva, tempo na agenda ou indicação.',
    plan: {
      action: 'Peça um compromisso pequeno a quem demonstrou interesse: pré-reserva, horário na agenda ou indicação de outra pessoa.',
      target: 'Pessoas do público fora do seu círculo próximo',
      goal: '3 compromissos de pessoas fora do seu círculo próximo.',
    },
  },
]

const CONTENT_CRITERIA: CriterionDef[] = [
  {
    id: 'audience', kind: 'content', label: 'Público e promessa', core: true, principle: 'offer',
    hypothesis: (n) => q(n, 'c_audience', 'O público ', 'Um nicho específico quer exatamente essa entrega — e não encontra igual.', ' quer exatamente essa entrega — e não encontra igual.'),
    validate: 'Publique 3 peças curtas para o nicho, com ganchos diferentes, e veja qual gera respostas de quem é do nicho.',
    plan: {
      action: 'Publique 3 peças curtas para o nicho, cada uma com um gancho diferente, e responda a todo comentário.',
      target: 'Plataforma principal escolhida',
      goal: 'Pelo menos 1 das 3 peças gera respostas de pessoas do nicho (não só curtidas).',
    },
  },
  {
    id: 'discovery', kind: 'content', label: 'Descoberta', core: true, principle: 'distribution',
    hypothesis: (n) => q(n, 'c_discovery', 'As peças serão encontradas por ', 'Alguém que não te conhece vai encontrar as peças, mesmo sem audiência prévia.', ', mesmo sem audiência prévia.'),
    validate: 'Publique onde a descoberta acontece sem audiência (busca, comunidade, recomendação) e anote de onde vem quem assiste.',
    plan: {
      action: 'Publique 3 peças no canal escolhido e 1 versão adaptada numa comunidade do nicho. Anote de onde veio cada visualização.',
      target: 'Canal escolhido + 1 comunidade do nicho',
      goal: 'Pelo menos 1 peça alcança pessoas fora da sua rede.',
    },
  },
  {
    id: 'format', kind: 'content', label: 'Formato e teste', core: true, principle: 'content',
    hypothesis: () => 'O formato se repete por semanas sem se esgotar — e dá para produzir à mão.',
    validate: 'Produza 3 peças do formato à mão antes de qualquer ferramenta e cronometre cada uma.',
    plan: {
      action: 'Produza 3 peças do formato à mão, cronometre cada uma e publique sempre no mesmo dia da semana.',
      target: 'Plataforma principal escolhida',
      goal: '3 peças publicadas no prazo, com o tempo de produção anotado.',
    },
  },
  {
    id: 'signal', kind: 'content', label: 'Sinal real', core: false, principle: 'validation',
    hypothesis: () => 'As pessoas voltam e respondem — não só passam.',
    validate: 'Peça uma ação explícita no fim de cada peça (responder, salvar, entrar numa lista) e conte quem faz.',
    plan: {
      action: 'Publique e peça uma ação explícita no fim: responder com uma pergunta, salvar ou entrar numa lista.',
      target: 'Plataforma principal escolhida',
      goal: '10 respostas ou inscrições de desconhecidos.',
    },
  },
  {
    id: 'cost', kind: 'content', label: 'Custo de consistência', core: false, principle: 'opportunity',
    hypothesis: () => 'Dá para produzir com consistência sem custos que inviabilizem.',
    validate: 'Simplifique o formato até caber na sua semana e meça o tempo real por peça.',
    plan: {
      action: 'Simplifique o formato até caber em metade do tempo atual e produza 3 peças nessa versão.',
      target: 'Plataforma principal escolhida',
      goal: 'O tempo por peça cabe na sua semana nas 3 publicações.',
    },
  },
  {
    id: 'future', kind: 'content', label: 'Monetização futura', core: false, principle: 'price',
    hypothesis: (n) => q(n, 'c_future', 'Um público fiel abre caminho para ', 'Um público fiel nesse nicho abre algum caminho de receita.', '.'),
    validate: 'Pergunte ao público o que ele já compra sobre o tema — sem vender nada ainda.',
    plan: {
      action: 'Pergunte nos comentários ou numa comunidade do nicho o que as pessoas já compram sobre o tema, sem vender nada.',
      target: 'Quem já comentou ou respondeu',
      goal: 'Pelo menos 3 pessoas descrevem algo que já pagaram sobre o tema.',
    },
  },
]

export const CRITERIA: Record<IdeaKind, CriterionDef[]> = { product: PRODUCT_CRITERIA, content: CONTENT_CRITERIA }

export const SCALE: Record<IdeaKind, { hypothesis: string; validate: string; plan: TestPlan }> = {
  product: {
    hypothesis: 'O que funcionou com poucas pessoas se repete com mais gente e por outro canal.',
    validate: 'Repita o teste com mais gente antes de construir algo maior.',
    plan: {
      action: 'Repita o que funcionou com o dobro de pessoas e por um canal diferente, para ver se o resultado se mantém.',
      target: 'Um canal novo, além do que já funcionou',
      goal: 'Resultado parecido com o do primeiro teste, com o dobro de pessoas.',
    },
  },
  content: {
    hypothesis: 'O interesse se mantém com a repetição, não só nas primeiras peças.',
    validate: 'Mantenha a cadência antes de mudar o formato ou automatizar.',
    plan: {
      action: 'Mantenha a cadência por mais 3 semanas sem mudar o formato e compare a retenção da 1ª com a da 4ª semana.',
      target: 'Plataforma principal',
      goal: 'Retenção estável ou crescente da 1ª para a 4ª semana.',
    },
  },
}

export const FLAGS: Record<FlagId, FlagDef> = {
  no_audience: {
    id: 'no_audience',
    label: 'Sem público definível',
    byKind: {
      product: {
        criterion: 'pain',
        detail: 'Do jeito que está, não dá para encontrar nem abordar quem sentiria isso.',
        validate: 'Recorte o público até conseguir nomear 5 pessoas reais com esse perfil.',
        plan: { action: 'Escreva o perfil em uma frase específica e encontre 5 pessoas reais que se encaixam nele. Converse com 2.', target: 'Sua rede e 1 comunidade do tema', goal: '5 nomes reais e 2 conversas feitas.' },
        dont: 'Falar com “todo mundo”: sem recorte, nenhuma resposta ensina.',
      },
      content: {
        criterion: 'audience',
        detail: 'Um tema amplo não diz para quem é cada peça nem onde encontrá-las.',
        validate: 'Recorte o nicho até caber numa frase: quem, com qual problema ou interesse, em qual plataforma.',
        plan: { action: 'Escreva o nicho em uma frase e publique 1 peça só para ele, com o gancho falando direto com essas pessoas.', target: 'Plataforma principal escolhida', goal: 'Respostas de pessoas que se reconhecem no nicho.' },
        dont: 'Falar com “todo mundo”: sem recorte, nenhuma resposta ensina.',
      },
    },
  },
  no_channel: {
    id: 'no_channel',
    label: 'Sem canal plausível',
    byKind: {
      product: {
        criterion: 'distribution',
        detail: 'Não há um caminho barato até o público: o teste dependeria de pagar por alcance.',
        validate: 'Ache 3 lugares onde esse público já está e onde você pode falar sem pagar.',
        plan: { action: 'Mapeie 3 lugares onde o público conversa e publique o problema em 1 deles, sem vender nada.', target: '3 comunidades, fóruns ou eventos do público', goal: '3 lugares mapeados e respostas reais em pelo menos 1.' },
        dont: 'Pagar anúncio para descobrir se existe interesse.',
      },
      content: {
        criterion: 'discovery',
        detail: 'Sem busca, comunidade ou recomendação plausível, as peças não chegam a quem não te conhece.',
        validate: 'Escolha um caminho de descoberta (busca, comunidade ou parceria) e confirme que o nicho usa esse caminho.',
        plan: { action: 'Liste 5 termos que o nicho pesquisa ou 3 comunidades onde ele está, e publique 1 peça pensada para esse caminho.', target: 'Termos de busca ou comunidades do nicho', goal: '1 peça encontrada por pessoas fora da sua rede.' },
        dont: 'Impulsionar posts para descobrir se existe interesse.',
      },
    },
  },
  spend_first: {
    id: 'spend_first',
    label: 'Precisa gastar antes de testar',
    byKind: {
      product: {
        criterion: 'test',
        detail: 'Para descobrir se funciona seria preciso construir ou pagar primeiro.',
        validate: 'Encontre uma versão do teste que não exija construir nem pagar: página, demonstração ou serviço manual.',
        plan: { action: 'Desenhe 2 versões do teste sem código nem gasto (página simples, demonstração gravada, serviço manual) e rode a mais simples.', target: '5 pessoas do público', goal: 'Um teste rodando sem gasto em até 7 dias.' },
        dont: 'Investir dinheiro antes de ter um teste que não dependa disso.',
      },
      content: {
        criterion: 'format',
        detail: 'A produção dependeria de automação ou ferramenta paga antes do primeiro sinal.',
        validate: 'Produza 1 peça só com o que você já tem e veja se o formato se sustenta sem a ferramenta.',
        plan: { action: 'Produza 3 peças à mão, com o que você já tem, mesmo que mais simples que o ideal.', target: 'Plataforma principal escolhida', goal: '3 peças publicadas sem gasto novo.' },
        dont: 'Automatizar ou assinar ferramenta antes de 3 peças manuais.',
      },
    },
  },
  expensive_dep: {
    id: 'expensive_dep',
    label: 'Dependência cara',
    byKind: {
      product: {
        criterion: 'execution',
        detail: 'Custos recorrentes ou integrações difíceis pesam antes de existir receita.',
        validate: 'Descubra como entregar o valor sem a dependência cara, nem que seja à mão no começo.',
        plan: { action: 'Entregue o resultado para 1 a 3 pessoas sem a dependência cara (manual, planilha, ferramenta gratuita) e anote o que faltou.', target: '1 a 3 pessoas do público', goal: 'Valor entregue sem custo recorrente novo.' },
        dont: 'Assinar serviços recorrentes só para testar.',
      },
      content: {
        criterion: 'cost',
        detail: 'Produzir com consistência dependeria de ferramentas, equipe ou equipamento pagos.',
        validate: 'Produza uma peça só com o que você já tem e compare com o que imaginava.',
        plan: { action: 'Produza 3 peças só com o que você já tem (celular, editor gratuito) e veja se a qualidade atrapalha a resposta.', target: 'Plataforma principal escolhida', goal: '3 peças publicadas sem gasto novo.' },
        dont: 'Comprar equipamento ou contratar ajuda antes do primeiro sinal.',
      },
    },
  },
  no_pain: {
    id: 'no_pain',
    label: 'Não resolve dor nem tem diferencial claro',
    byKind: {
      product: {
        criterion: 'pain',
        detail: 'O problema parece leve e já é bem resolvido por outras opções.',
        validate: 'Descubra se o problema incomoda de verdade: peça a 5 pessoas para contarem como lidam com ele hoje.',
        plan: { action: 'Pergunte a 5 pessoas do público como lidam com o problema hoje e o que mais as irrita na solução atual.', target: '5 pessoas do público', goal: 'Pelo menos 2 citam uma frustração concreta com o que usam hoje.' },
        dont: 'Somar funcionalidades para compensar a falta de dor.',
      },
      content: {
        criterion: 'audience',
        detail: 'A promessa se parece com o que já existe no nicho.',
        validate: 'Observe 5 perfis do nicho e escreva, em uma frase, o que o seu faria diferente.',
        plan: { action: 'Observe 5 perfis do nicho, escreva o seu ângulo diferente em uma frase e publique 1 peça com ele.', target: '5 perfis de referência + plataforma escolhida', goal: 'Um ângulo em uma frase e 1 peça publicada com ele.' },
        dont: 'Aumentar o volume de posts antes de achar o ângulo.',
      },
    },
  },
}

export const DONT_BASE: Record<IdeaKind, string[]> = {
  product: [
    'Escrever o código do produto antes do teste.',
    'Comprar domínio, logo, template ou ferramenta paga.',
    'Construir login, painel ou integrações.',
  ],
  content: [
    'Automatizar produção ou publicação antes de 3 peças manuais.',
    'Comprar equipamento, curso ou ferramenta.',
    'Abrir perfis em várias plataformas ao mesmo tempo.',
  ],
}

export function questionsFor(kind: IdeaKind): Question[] {
  return QUESTIONS[kind]
}

export function criteriaFor(kind: IdeaKind): CriterionDef[] {
  return CRITERIA[kind]
}

export function criterionDef(kind: IdeaKind, id: string | null | undefined): CriterionDef | null {
  return CRITERIA[kind].find((c) => c.id === id) ?? null
}

export function toneOf(question: Question, choice: Choice): Tone {
  if (choice.tone) return choice.tone
  const levels = Object.values(choice.effects)
  if (levels.includes('alert')) return 'risk'
  const main = choice.effects[question.criterion] ?? levels[0]
  return main === 'evidenced' ? 'good' : main === 'hypothesis' ? 'maybe' : 'unknown'
}
