import { AREAS, type Area, type Profile } from './types.ts'

export const AREA_NOTE: Record<Area, string> = {
  dinheiro: 'Finanças, oportunidades e investimentos: Selic, IPCA, dólar, renda fixa, Tesouro, bolsa, cripto, vagas, freelas, editais e jeitos de ganhar dinheiro como dev.',
  codigo: 'O que melhora meu código, engenharia e arquitetura de software, com coisa prática para aplicar.',
  ia: 'Modelos, APIs e ferramentas de IA que eu posso usar já: lançamentos, preços, limites e técnicas.',
  potencializa: 'Stacks, frameworks, libs, ferramentas e serviços novos que me potencializam no dia a dia.',
  seguranca: 'Só a cibersegurança que afeta a minha stack ou as minhas contas (vulnerabilidade, vazamento, golpe).',
  politica: 'Política no Brasil, nos EUA, na China e na Europa: governo, eleições, Congresso, STF, política econômica, tarifas e geopolítica, principalmente o que mexe com mercado e com o meu bolso.',
  mundo: 'Só fatos do mundo realmente grandes (desastre, guerra, acidente grave). Nada de fofoca.',
}

export const DEFAULT_VOICE = 'pf_dora'
export const NEURAL_VOICES = [{ id: 'pf_dora', name: 'Dora', locale: 'pt-BR' }] as const
export const DEFAULT_TRANSLATE_MODEL = 'gemma4:e2b'
export const DEFAULT_EMBED_MODEL = 'embeddinggemma'
const isNeural = (v: unknown) => NEURAL_VOICES.some((x) => x.id === v)

export function localModelLabel(model: string | null | undefined): string {
  const m = (model ?? DEFAULT_TRANSLATE_MODEL).match(/^(?:.*\/)?([a-z]+)(\d+(?:\.\d+)?)?[^:]*(?::([a-z]?\d+(?:\.\d+)?)b)?/i)
  if (!m) return model ?? ''
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return [name, m[2], m[3] ? `${m[3].toUpperCase()}B` : ''].filter(Boolean).join(' ')
}

export function defaultProfile(): Profile {
  return {
    v: 1,
    areas: AREAS.map((id) => ({ id, enabled: true, weight: 1, note: AREA_NOTE[id] })),
    likes: [],
    ignores: [],
    about:
      'Desenvolvedor brasileiro; trabalho com TypeScript, React, Rust e IA. Ligo o computador por volta das 10h no escritório e quero, em poucos minutos, só o que agrega.',
    useRadarSources: true,
    learning: true,
    voice: { voice: DEFAULT_VOICE, rate: 185, jarvis: false },
    tuning: { depth: 0, fresh: 0 },
    codexPath: null,
    judgeEffort: 'low',
    localAi: true,
    translateModel: DEFAULT_TRANSLATE_MODEL,
    embedModel: DEFAULT_EMBED_MODEL,
  }
}

export function normalizeProfile(p: Partial<Profile> | null | undefined): Profile {
  const d = defaultProfile()
  if (!p || typeof p !== 'object') return d
  const areas = AREAS.map((id) => {
    const a = Array.isArray(p.areas) ? p.areas.find((x) => x?.id === id) : undefined
    return {
      id,
      enabled: typeof a?.enabled === 'boolean' ? a.enabled : true,
      weight: typeof a?.weight === 'number' && a.weight >= 0 && a.weight <= 2 ? a.weight : 1,
      note: typeof a?.note === 'string' ? a.note : AREA_NOTE[id],
    }
  })
  return {
    ...d,
    ...p,
    v: 1,
    areas,
    likes: Array.isArray(p.likes) ? p.likes.filter((x) => typeof x === 'string') : [],
    ignores: Array.isArray(p.ignores) ? p.ignores.filter((x) => typeof x === 'string') : [],
    voice: isNeural(p.voice?.voice) ? { ...d.voice, ...p.voice } : { ...d.voice, rate: typeof p.voice?.rate === 'number' ? p.voice.rate : d.voice.rate },
    tuning: {
      depth: Math.max(0, Math.min(3, Math.round(Number(p.tuning?.depth) || 0))),
      fresh: Math.max(0, Math.min(3, Math.round(Number(p.tuning?.fresh) || 0))),
    },
    localAi: typeof p.localAi === 'boolean' ? p.localAi : true,
    translateModel: typeof p.translateModel === 'string' && p.translateModel.trim() ? p.translateModel.trim() : DEFAULT_TRANSLATE_MODEL,
    embedModel: typeof p.embedModel === 'string' && p.embedModel.trim() ? p.embedModel.trim() : DEFAULT_EMBED_MODEL,
  }
}

export const areaPref = (p: Profile, a: Area) => p.areas.find((x) => x.id === a) ?? { id: a, enabled: true, weight: 1, note: '' }
