const L = '\\p{L}\\p{M}\\d'
const word = (src: string, flags = 'gu') => new RegExp(`(?<![${L}])(?:${src})(?![${L}])`, flags)

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

const femWord = (s: string) =>
  s.replace(/(?<![\p{L}])um$/u, 'uma').replace(/(?<![\p{L}])dois$/u, 'duas').replace(/entos$/, 'entas')

function under1000(n: number, fem: boolean): string {
  if (n === 100) return 'cem'
  const h = Math.floor(n / 100)
  const r = n % 100
  const parts: string[] = []
  if (h) parts.push(fem ? HUNDREDS[h].replace(/entos$/, 'entas') : HUNDREDS[h])
  if (r) {
    if (r < 20) parts.push(fem ? femWord(UNITS[r]) : UNITS[r])
    else {
      const t = TENS[Math.floor(r / 10)]
      const u = r % 10
      parts.push(u ? `${t} e ${fem ? femWord(UNITS[u]) : UNITS[u]}` : t)
    }
  }
  return parts.join(' e ')
}

export function numberWords(n: number, fem = false): string {
  if (!Number.isFinite(n)) return ''
  if (n < 0) return `menos ${numberWords(-n, fem)}`
  n = Math.floor(n)
  if (n < 1000) return n === 0 ? 'zero' : under1000(n, fem)
  const scales: [number, string, string][] = [
    [1e12, 'trilhão', 'trilhões'],
    [1e9, 'bilhão', 'bilhões'],
    [1e6, 'milhão', 'milhões'],
  ]
  const groups: string[] = []
  let rest = n
  for (const [v, one, many] of scales) {
    const q = Math.floor(rest / v)
    if (q) {
      groups.push(`${under1000(q, false)} ${q === 1 ? one : many}`)
      rest -= q * v
    }
  }
  const th = Math.floor(rest / 1000)
  if (th) {
    groups.push(th === 1 ? 'mil' : `${under1000(th, fem)} mil`)
    rest -= th * 1000
  }
  if (rest) groups.push(under1000(rest, fem))
  if (groups.length === 1) return groups[0]
  const lastGroup = rest ? rest : th ? th * 1000 : n % 1e6
  const glue = rest ? (rest < 100 || rest % 100 === 0 ? ' e ' : ' ') : lastGroup && (th < 100 || th % 100 === 0) ? ' e ' : ' '
  return groups.slice(0, -1).join(' ') + glue + groups[groups.length - 1]
}

const SPELL: Record<string, string> = {
  A: 'á', B: 'bê', C: 'cê', D: 'dê', E: 'é', F: 'éfe', G: 'gê', H: 'agá', I: 'i', J: 'jota', K: 'cá', L: 'éle', M: 'eme',
  N: 'ene', O: 'ó', P: 'pê', Q: 'quê', R: 'érre', S: 'ésse', T: 'tê', U: 'u', V: 'vê', W: 'dáblio', X: 'xis', Y: 'ípsilon', Z: 'zê',
}
export const spell = (s: string) => [...s.toUpperCase()].map((c) => SPELL[c] ?? c).join(' ')

const SPELLED = new Set([
  'IA', 'CVE', 'IPCA', 'AWS', 'GPU', 'URL', 'PDF', 'HTML', 'CSS', 'SQL', 'CEO', 'CTO', 'CFO', 'UE', 'BC', 'CVM', 'STF', 'TSE',
  'VPN', 'DNS', 'SSH', 'AMD', 'IBM', 'OCR', 'RAG', 'MCP', 'CLI', 'NPM', 'IPO', 'ETF', 'CDI', 'CDB', 'LCI', 'LCA', 'B3', 'TI',
  'HTTP', 'HTTPS', 'TLS', 'SSL', 'XSS', 'RCE', 'SDK', 'LLM', 'UI', 'UX', 'PC', 'TV', 'EUA', 'FBI', 'CIA', 'OMS', 'OTAN', 'BBC',
  'CPU', 'RAM', 'SSD', 'USB', 'IoT', 'iOS', 'API', 'APIs', 'GPT', 'IAs',
])
const WORDS: [string, string][] = [
  ['iOS', 'ai ó és'],
  ['macOS', 'mac ó és'],
  ['iPadOS', 'aipéd ó és'],
  ['iPhone', 'aifone'],
  ['iPad', 'aipéd'],
  ['OpenAI', 'Ópen ei ai'],
  ['ChatGPT', 'tchat gê pê tê'],
  ['GitHub', 'Guit-râb'],
  ['GitLab', 'Guit-léb'],
  ['Google', 'Gúgol'],
  ['Claude', 'Clód'],
  ['Anthropic', 'Ântropic'],
  ['Gemini', 'Jêmini'],
  ['Gemma', 'Djêma'],
  ['Llama', 'Lhama'],
  ['Nvidia', 'Envídia'],
  ['NVIDIA', 'Envídia'],
  ['React', 'Riéct'],
  ['Rust', 'Râst'],
  ['TypeScript', 'Taipscrípt'],
  ['JavaScript', 'Jávascrípt'],
  ['Node\\.js', 'Nôud jêi és'],
  ['Next\\.js', 'Nékst jêi és'],
  ['Docker', 'Dóquer'],
  ['Kubernetes', 'Cubernétis'],
  ['Cloudflare', 'Claudflér'],
  ['Vercel', 'Vérssel'],
  ['Supabase', 'Supabêise'],
  ['Notion', 'Nôxan'],
  ['Slack', 'Islék'],
  ['Spotify', 'Spótifai'],
  ['YouTube', 'Iutúbi'],
  ['Twitter', 'Tuíter'],
  ['LinkedIn', 'Lincedin'],
  ['Amazon', 'Ámazon'],
  ['Ethereum', 'Etérium'],
  ['Bitcoin', 'Bitcóin'],
  ['Elon Musk', 'Ilon Mâsk'],
  ['Musk', 'Mâsk'],
  ['Trump', 'Trâmp'],
  ['Wi-?Fi', 'uai-fai'],
  ['JSON', 'jêison'],
  ['SaaS', 'sás'],
  ['startups?', 'startáps'],
  ['apps?', 'éps'],
  ['hackers?', 'réquers'],
  ['phishing', 'fíxin'],
  ['ransomware', 'rensomuér'],
  ['malware', 'maluér'],
  ['spyware', 'spaiuér'],
  ['firmware', 'firmuér'],
  ['framework', 'fréimuork'],
  ['frameworks', 'fréimuorks'],
  ['open source', 'ópen sórss'],
  ['deepfakes?', 'dípfêiks'],
  ['backend', 'béquend'],
  ['frontend', 'frontend'],
  ['benchmark', 'bêntchmark'],
  ['benchmarks', 'bêntchmarks'],
  ['prompt', 'prômpt'],
  ['prompts', 'prômpts'],
  ['chatbot', 'tchatbót'],
  ['chatbots', 'tchatbóts'],
  ['streaming', 'istrímin'],
  ['feedback', 'fídbéc'],
  ['upgrade', 'apigrêid'],
  ['download', 'daunlôud'],
  ['login', 'lóguin'],
  ['e-mails?', 'imêils'],
  ['emails?', 'imêils'],
  ['token', 'tôquen'],
  ['tokens', 'tôquens'],
  ['bug', 'bâg'],
  ['bugs', 'bâgs'],
  ['patch', 'pétch'],
  ['patches', 'pétches'],
  ['cloud', 'claud'],
  ['data center', 'dáta cênter'],
  ['data centers', 'dáta cênters'],
  ['big techs?', 'big tékis'],
  ['big tech', 'big ték'],
]

const MASC_A = new Set(['dia', 'dias', 'problema', 'problemas', 'sistema', 'sistemas', 'programa', 'programas', 'mapa', 'mapas', 'tema', 'temas', 'clima', 'planeta', 'planetas', 'idioma', 'idiomas', 'esquema', 'esquemas', 'cinema', 'drama', 'dramas', 'telefonema', 'diploma', 'poema', 'poemas', 'sofá', 'gigas', 'megas', 'pontos', 'mil'])
const FEM_END = /(?:a|as|ção|ções|são|sões|dade|dades|gem|gens|ise|ises|vezes)$/u

export function feminineNext(rest: string): boolean {
  const w = rest.match(/^\s+([\p{L}-]+)/u)?.[1]?.toLowerCase()
  if (!w || MASC_A.has(w)) return false
  return FEM_END.test(w)
}

const plainNumber = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

function spokenAmount(raw: string, fem = false): string {
  const t = raw.trim()
  if (/^\d{1,3}(\.\d{3})+$/.test(t) || /^\d+$/.test(t)) return numberWords(plainNumber(t), fem)
  const m = t.match(/^(\d+),(\d+)$/)
  if (m) {
    const dec = m[2].replace(/0+$/, '')
    if (!dec) return numberWords(Number(m[1]), fem)
    const decWords = dec.length <= 2 && !dec.startsWith('0') ? numberWords(Number(dec)) : [...dec].map((d) => UNITS[Number(d)]).join(' ')
    return `${numberWords(Number(m[1]), fem)} vírgula ${decWords}`
  }
  return t
}

const SCALE = '(mil|milhão|milhões|bilhão|bilhões|trilhão|trilhões|mi|bi|tri)'
const SCALE_WORD: Record<string, string> = { mi: 'milhões', bi: 'bilhões', tri: 'trilhões' }
const NUM = '(\\d{1,3}(?:\\.\\d{3})+|\\d+(?:,\\d+)?)'

function money(amount: string, scale: string | undefined, one: string, many: string, cents: string): string {
  const sc = scale ? (SCALE_WORD[scale.toLowerCase()] ?? scale.toLowerCase()) : ''
  const value = plainNumber(amount)
  if (sc) {
    const big = sc !== 'mil'
    return `${spokenAmount(amount)} ${sc} ${big ? 'de ' : ''}${many}`
  }
  const m = amount.match(/^(\d{1,3}(?:\.\d{3})*|\d+),(\d{1,2})$/)
  if (m) {
    const whole = plainNumber(m[1])
    const c = Number(m[2].padEnd(2, '0'))
    const w = whole === 0 ? '' : `${numberWords(whole)} ${whole === 1 ? one : many}`
    if (!c) return w || `zero ${many}`
    return w ? `${w} e ${numberWords(c)}${cents ? ` ${cents}` : ''}` : `${numberWords(c)} ${cents || 'centavos'}`
  }
  const isMillions = value >= 1e6 && value % 1e6 === 0
  return `${numberWords(value)} ${isMillions ? 'de ' : ''}${value === 1 ? one : many}`
}

export function toSpeech(input: string): string {
  let s = ` ${input} `
  s = s.replace(/https?:\/\/\S+/gi, ' ')
  s = s.replace(/CVE-(\d{4})-(\d{3,7})/g, (_, y, n) => `cê vê é ${numberWords(Number(y))}, ${[...n].map((d) => UNITS[Number(d)]).join(' ')}`)
  s = s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
  s = s.replace(/[*_`#~^|<>[\]{}]/g, ' ')
  s = s.replace(/[“”"«»]/g, '').replace(/(?<![\p{L}])['‘’]|['‘’](?![\p{L}])/gu, '')
  s = s.replace(/\s*[—–]\s*/g, ', ').replace(/\s+-\s+/g, ', ')
  s = s.replace(/\s*\(\s*/g, ', ').replace(/\s*\)\s*/g, ', ')
  s = s.replace(new RegExp(`R\\$\\s?${NUM}(?:\\s${SCALE})?(?![\\p{L}])`, 'gu'), (_, a, sc) => money(a, sc, 'real', 'reais', 'centavos'))
  s = s.replace(new RegExp(`(?:US\\$|U\\$|\\$)\\s?${NUM}(?:\\s${SCALE})?(?![\\p{L}])`, 'gu'), (_, a, sc) => money(a, sc, 'dólar', 'dólares', 'centavos'))
  s = s.replace(new RegExp(`€\\s?${NUM}(?:\\s${SCALE})?(?![\\p{L}])`, 'gu'), (_, a, sc) => money(a, sc, 'euro', 'euros', 'centavos'))
  s = s.replace(new RegExp(`([+−-])?${NUM}\\s?%`, 'gu'), (_, sign, a) => `${sign === '+' ? 'mais ' : sign ? 'menos ' : ''}${spokenAmount(a)} por cento`)
  s = s.replace(/(\d+)\s?°\s?C?/g, (_, a) => `${numberWords(Number(a))} ${a === '1' ? 'grau' : 'graus'}`)
  s = s.replace(/(?<![\d,.])(\d{1,2})h(\d{2})(?!\d)/g, (_, h, m) => `${numberWords(Number(h), true)} e ${numberWords(Number(m))}`)
  s = s.replace(/(?<![\d,.])(\d{1,2})\s?h(?![\p{L}\d])/gu, (_, h) => `${numberWords(Number(h), true)} ${h === '1' ? 'hora' : 'horas'}`)
  s = s.replace(/(\d+)\s?x(?![\p{L}\d])/gu, (_, a) => `${spokenAmount(a, true)} vezes`)
  s = s.replace(/(\d+(?:,\d+)?)\s?(GB|TB|MB|KB|GHz|MHz|km|kg|ms)(?![\p{L}])/gu, (_, a, u) => {
    const unit: Record<string, string> = { GB: 'gigas', TB: 'terabytes', MB: 'megas', KB: 'kilobytes', GHz: 'gigahertz', MHz: 'megahertz', km: 'quilômetros', kg: 'quilos', ms: 'milissegundos' }
    return `${spokenAmount(a)} ${unit[u]}`
  })
  s = s.replace(new RegExp(`(\\p{Lu}[\\p{L}]*)-(\\d+(?:\\.\\d+)?)(?![\\d])`, 'gu'), '$1 $2')
  s = s.replace(/(?<![\d.,])(\d+)\.(\d{1,2})(?![\d])/g, (_, a, b) => `${numberWords(Number(a))} ponto ${numberWords(Number(b))}`)
  s = s.replace(/(?<![\d.,])(\d+)(o|º|ª)(?![\p{L}\d])/gu, (_, a, o) => {
    const ord = ['', 'primeir', 'segund', 'terceir', 'quart', 'quint', 'sext', 'sétim', 'oitav', 'non', 'décim'][Number(a)]
    return ord ? `${ord}${o === 'ª' ? 'a' : 'o'}` : `${a}${o}`
  })
  for (const [src, say] of WORDS) s = s.replace(word(src, 'gu'), say)
  s = s.replace(word('[A-Z][A-Za-z]{0,4}s?'), (m) => {
    if (SPELLED.has(m)) {
      if (m === 'APIs' || m === 'IAs') return `${spell(m.slice(0, -1))}s`
      if (m === 'IoT') return 'i ó tê'
      if (m === 'iOS') return 'ai ó és'
      return spell(m)
    }
    if (/^[A-Z]{2,5}$/.test(m) && !/[AEIOU]/.test(m)) return spell(m)
    return m
  })
  s = s.replace(new RegExp(`(?<![\\d.,])${NUM}(?![\\d])`, 'gu'), (m, _a, off: number, all: string) => {
    if (/^\d{4}$/.test(m) && Number(m) >= 1900 && Number(m) <= 2100) return numberWords(Number(m))
    const fem = feminineNext(all.slice(off + m.length, off + m.length + 30))
    return spokenAmount(m, fem)
  })
  s = s.replace(/\s*&\s*/g, ' e ').replace(/\s\+\s/g, ' mais ').replace(/(?<=[\p{L}])\/(?=[\p{L}])/gu, ' ou ').replace(/\//g, ' ')
  s = s.replace(/\s*;\s*/g, ', ').replace(/\s*:\s*(?=\S)/g, ': ')
  s = s.replace(/,(\s*,)+/g, ',').replace(/,\s*([.!?…])/g, '$1').replace(/\s+([,.!?…:])/g, '$1').replace(/([,.!?…:])(?=[\p{L}])/gu, '$1 ')
  s = s.replace(/^[\s,]+/, '').replace(/\s{2,}/g, ' ').trim()
  return s
}

const ABBR = /(?:^|\s)(?:sr|sra|dr|dra|prof|profa|av|nº|n|p|pág|ex|etc|vs|aprox|tel|cia|ltda|jr)\.$/i

export function splitSentences(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const raw: string[] = []
  let start = 0
  const re = /[.!?…]+["”’)]*(?=\s+["“'(\p{Lu}\d¿¡])/gu
  for (const m of clean.matchAll(re)) {
    const end = m.index + m[0].length
    const piece = clean.slice(start, end)
    if (ABBR.test(piece) || /\d\.$/.test(piece) && /^\s*\d/.test(clean.slice(end))) continue
    raw.push(piece.trim())
    start = end
  }
  if (start < clean.length) raw.push(clean.slice(start).trim())
  const out: string[] = []
  for (const s of raw) {
    if (s.length <= max) {
      out.push(s)
      continue
    }
    let rest = s
    while (rest.length > max) {
      const window = rest.slice(0, max)
      const cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(', '))
      const at = cut > max * 0.35 ? cut + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : max
      out.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    if (rest) out.push(rest)
  }
  return out.filter((x) => /[\p{L}\d]/u.test(x))
}

export function hashText(s: string): string {
  let h1 = 0xdeadbeef ^ s.length
  let h2 = 0x41c6ce57 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)
}
