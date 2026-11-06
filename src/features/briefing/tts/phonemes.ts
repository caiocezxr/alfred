const MAP: Record<string, string> = {
  'tʃ': 'ʧ',
  'dʒ': 'ʤ',
  'ts': 'ʦ',
  'dz': 'ʣ',
  'eɪ': 'A',
  'aɪ': 'I',
  'aʊ': 'W',
  'oʊ': 'O',
  'əʊ': 'Q',
  'ɔɪ': 'Y',
}

const PUNCT = /(\s*[;:,.!?¡¿—…"«»“”()]+\s*)+/g

export function ipaToKokoro(ipa: string): string {
  return ipa
    .split('\n')
    .filter((l) => l.trim())
    .map((l) =>
      l
        .trim()
        .split(/\s+/)
        .map((w) =>
          w
            .split('_')
            .filter(Boolean)
            .map((p) => {
              const m = p.match(/^([ˈˌ]*)(.*)$/)!
              return m[1] + (MAP[m[2]] ?? m[2])
            })
            .join(''),
        )
        .join(' '),
    )
    .join(' ')
    .replace(/-/g, '')
}

export function phonemize(text: string, toIpa: (chunk: string) => string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(PUNCT)) {
    if (m.index > last) out += ipaToKokoro(toIpa(text.slice(last, m.index)))
    out += m[0].replace(/[«»“”"()]/g, (c) => (c === '(' ? '«' : c === ')' ? '»' : c))
    last = m.index + m[0].length
  }
  if (last < text.length) out += ipaToKokoro(toIpa(text.slice(last)))
  return out.replace(/\s+/g, ' ').trim()
}

export function trimSilence(pcm: Float32Array, sr: number, pad = 0.03, threshold = 0.004): Float32Array {
  let a = 0
  let b = pcm.length - 1
  while (a < b && Math.abs(pcm[a]) < threshold) a++
  while (b > a && Math.abs(pcm[b]) < threshold) b--
  const p = Math.round(pad * sr)
  return pcm.slice(Math.max(0, a - p), Math.min(pcm.length, b + p + 1))
}
