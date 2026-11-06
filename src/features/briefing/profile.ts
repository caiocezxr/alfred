import { AREAS, type Area, type Profile } from './types.ts'

export const AREA_NOTE: Record<Area, string> = {
  dinheiro: 'Coisas que podem pôr dinheiro no bolso: oportunidades no meio tec, finanças, investimentos e cripto.',
  codigo: 'O que melhora meu código, engenharia e arquitetura de software.',
  ia: 'Modelos e ferramentas de IA novos, inclusive para criação de conteúdo.',
  potencializa: 'Stacks, frameworks, libs, ferramentas e serviços novos que me potencializam.',
  seguranca: 'Cibersegurança: ataques, vulnerabilidades e vazamentos que podem me afetar.',
  mundo: 'Notícias do mundo de fato relevantes (queda de avião, tsunami, terremoto, guerra). Nada de fofoca.',
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
    voice: { voice: 'Luciana', rate: 185, jarvis: true },
    codexPath: null,
    judgeEffort: 'low',
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
    voice: { ...d.voice, ...(p.voice ?? {}) },
  }
}

export const areaPref = (p: Profile, a: Area) => p.areas.find((x) => x.id === a) ?? { id: a, enabled: true, weight: 1, note: '' }
