import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { defineConfig, type Plugin } from 'vite'
import { BRIEFING_SOURCES } from './src/features/briefing/sources.ts'
import { SEED_SOURCES } from './src/features/radar/seed.ts'

function radarFeedProxy(): Plugin {
  const TIMEOUT_MS = 10_000
  const MAX_BYTES = 3 * 1024 * 1024
  const MAX_REDIRECTS = 3
  const UA = 'PersonalSpace-Radar/1.0'
  const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'

  class Fail extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }

  const isLocalHost = (h: string) => {
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
    const v = isIP(h)
    if (v === 4) {
      const [a, b] = h.split('.').map(Number)
      return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) ||
        (a === 169 && b === 254) || (a === 100 && b >= 64 && b < 128) || h === '255.255.255.255'
    }
    if (v === 6) {
      const x = h.toLowerCase()
      return x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('::ffff:')
    }
    return /^[\d.x]+$/i.test(h)
  }

  const validate = (raw: string): string => {
    const s = raw.trim()
    if (!s) throw new Fail(400, '[url] informe o endereço do feed')
    if (s.length > 2048) throw new Fail(400, '[url] endereço longo demais')
    let u: URL
    try {
      u = new URL(s)
    } catch {
      throw new Fail(400, '[url] endereço inválido')
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Fail(400, '[url] use um endereço que comece com http:// ou https://')
    if (u.username || u.password) throw new Fail(400, '[url] endereços com usuário e senha não são aceitos')
    if (isLocalHost(u.hostname.replace(/^\[|\]$/g, '').toLowerCase())) throw new Fail(400, '[url] endereços locais ou de rede interna não são aceitos')
    return u.toString()
  }

  const statusError = (status: number) =>
    status === 404 || status === 410 ? `[http ${status}] o feed não existe mais neste endereço`
    : status === 401 || status === 403 ? `[http ${status}] a fonte recusou o acesso`
    : status === 429 ? '[http 429] a fonte pediu para esperar (limite de acessos)'
    : status >= 500 ? `[http ${status}] a fonte está com problemas no momento`
    : `[http ${status}] resposta inesperada da fonte`

  const charsetOf = (contentType: string | null, head: Buffer) => {
    const m = contentType?.match(/charset\s*=\s*["']?([\w-]+)/i)
    if (m) return m[1].toLowerCase()
    const decl = head.subarray(0, 200).toString('latin1').match(/^<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i)
    return decl ? decl[1].toLowerCase() : 'utf-8'
  }

  const looksLikeFeed = (text: string) => {
    const head = text.slice(0, 4096).replace(/^﻿/, '').trimStart().toLowerCase()
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) return false
    return head.includes('<rss') || head.includes('<feed') || head.includes('<rdf:rdf')
  }

  const netError = (e: unknown): Fail => {
    if (e instanceof Fail) return e
    const err = e as { name?: string; cause?: { code?: string } }
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return new Fail(504, '[tempo] a fonte demorou demais para responder')
    const code = err?.cause?.code ?? ''
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new Fail(502, '[rede] domínio não encontrado — sem conexão?')
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return new Fail(502, '[rede] não foi possível conectar à fonte')
    if (code.startsWith('ERR_TLS') || code.includes('CERT')) return new Fail(502, '[rede] falha na conexão segura (TLS)')
    return new Fail(502, '[rede] não foi possível buscar o feed')
  }

  async function fetchFeed(target: string, signal: AbortSignal): Promise<string> {
    let current = validate(target)
    for (let hops = 0; ; hops++) {
      const r = await fetch(current, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': UA, accept: ACCEPT, 'accept-encoding': 'gzip, deflate' },
      })
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        await r.body?.cancel()
        if (hops >= MAX_REDIRECTS) throw new Fail(502, '[rede] a fonte redireciona demais')
        const loc = r.headers.get('location')
        if (!loc) throw new Fail(502, '[rede] redirecionamento sem destino')
        current = validate(new URL(loc, current).toString())
        continue
      }
      if (!r.ok) {
        await r.body?.cancel()
        throw new Fail(502, statusError(r.status))
      }
      if (Number(r.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Fail(502, '[tamanho] o feed passa do limite de 3 MB')
      const chunks: Buffer[] = []
      let total = 0
      if (r.body) {
        const reader = r.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > MAX_BYTES) {
            await reader.cancel()
            throw new Fail(502, '[tamanho] o feed passa do limite de 3 MB')
          }
          chunks.push(Buffer.from(value))
        }
      }
      const buf = Buffer.concat(chunks)
      if (buf[0] === 0x1f && buf[1] === 0x8b) throw new Fail(502, '[formato] a fonte enviou conteúdo compactado sem avisar')
      let text: string
      try {
        text = new TextDecoder(charsetOf(r.headers.get('content-type'), buf)).decode(buf)
      } catch {
        text = new TextDecoder('utf-8').decode(buf)
      }
      if (!looksLikeFeed(text)) throw new Fail(502, '[formato] o endereço respondeu, mas não é um feed RSS ou Atom')
      return text
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: string) => {
      res.statusCode = status
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(body)
    }
    if (req.method !== 'GET') return send(405, '[url] use GET')
    const site = req.headers['sec-fetch-site']
    if (site && site !== 'same-origin' && site !== 'none') return send(403, '[url] origem não permitida')
    const target = new URL(req.url ?? '/', 'http://localhost').searchParams.get('url') ?? ''
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      send(200, await fetchFeed(target, ctrl.signal))
    } catch (e) {
      const f = netError(e)
      send(f.status, f.message)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    name: 'radar-feed-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__radar', (req, res) => {
        void handle(req, res)
      })
    },
  }
}

function briefingDevProxy(): Plugin {
  const UA = 'PersonalSpace-Briefing/1.0'
  const MAX_BYTES = 3 * 1024 * 1024
  const allow = new Set<string>([...BRIEFING_SOURCES.map((s) => s[2]), ...SEED_SOURCES.map((s) => s[2])])

  const isPublicHttp = (raw: string) => {
    try {
      const u = new URL(raw)
      const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
      if (u.username || u.password || isIP(h) || h === 'localhost' || /\.(localhost|local|internal)$/.test(h)) return false
      return true
    } catch {
      return false
    }
  }

  async function get(url: string, accept: string, timeoutMs: number, maxBytes: number): Promise<{ buf: Buffer; type: string | null }> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      let current = url
      for (let hops = 0; ; hops++) {
        if (!isPublicHttp(current)) throw new Error('[url] endereço não permitido')
        const r = await fetch(current, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': UA, accept } })
        if ([301, 302, 303, 307, 308].includes(r.status)) {
          await r.body?.cancel()
          const loc = r.headers.get('location')
          if (!loc || hops >= 3) throw new Error('[rede] a fonte redireciona demais')
          current = new URL(loc, current).toString()
          continue
        }
        if (!r.ok) {
          await r.body?.cancel()
          throw new Error(`[http ${r.status}] resposta inesperada da fonte`)
        }
        const ab = await r.arrayBuffer()
        if (ab.byteLength > maxBytes) throw new Error('[tamanho] a resposta passa do limite')
        return { buf: Buffer.from(ab), type: r.headers.get('content-type') }
      }
    } catch (e) {
      const err = e as { name?: string; message?: string }
      if (err?.name === 'AbortError') throw new Error('[tempo] a fonte demorou demais para responder')
      throw new Error(err?.message?.startsWith('[') ? err.message : '[rede] não foi possível conectar à fonte')
    } finally {
      clearTimeout(timer)
    }
  }

  const decode = (buf: Buffer, type: string | null) => {
    const cs = type?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? buf.subarray(0, 200).toString('latin1').match(/^<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i)?.[1] ?? 'utf-8'
    try {
      return new TextDecoder(cs.toLowerCase()).decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  }

  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
    return Number.isFinite(n) ? n : null
  }
  const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)
  const iso = (secs: unknown) => (num(secs) === null ? null : new Date(num(secs)! * 1000).toISOString())
  const brDate = (s: unknown) => (typeof s === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(s) ? `${s.slice(6)}-${s.slice(3, 5)}-${s.slice(0, 2)}` : null)

  type Q = { id: string; label: string; value: number; unit: string; changePct: number | null; period: string; asOf: string | null; source: string }
  const json = async (url: string) => JSON.parse((await get(url, 'application/json', 8000, 512 * 1024)).buf.toString('utf8'))
  const jobs: [string, () => Promise<Q[]>][] = [
    ['cripto', async () => {
      const v = await json('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,brl&include_24hr_change=true&include_last_updated_at=true')
      return (['bitcoin', 'ethereum'] as const).filter((id) => num(v?.[id]?.usd) !== null).map((id) => ({
        id, label: id === 'bitcoin' ? 'Bitcoin' : 'Ethereum', value: num(v[id].usd)!, unit: 'usd', changePct: r2(num(v[id].usd_24h_change)),
        period: '24 h', asOf: iso(v[id].last_updated_at), source: 'CoinGecko',
      }))
    }],
    ['câmbio', async () => {
      const v = await json('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL')
      return ([['USDBRL', 'dolar', 'Dólar'], ['EURBRL', 'euro', 'Euro']] as const).filter(([k]) => num(v?.[k]?.bid) !== null).map(([k, id, label]) => ({
        id, label, value: num(v[k].bid)!, unit: 'brl', changePct: r2(num(v[k].pctChange)), period: 'dia', asOf: iso(v[k].timestamp), source: 'AwesomeAPI',
      }))
    }],
    ['Selic', async () => {
      const v = (await json('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json')).at(-1)
      return num(v?.valor) === null ? [] : [{ id: 'selic', label: 'Selic', value: num(v.valor)!, unit: 'pct', changePct: null, period: 'ao ano', asOf: brDate(v.data), source: 'Banco Central (SGS)' }]
    }],
    ['IPCA', async () => {
      const v = (await json('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json')).at(-1)
      return num(v?.valor) === null ? [] : [{ id: 'ipca', label: 'IPCA', value: num(v.valor)!, unit: 'pct', changePct: null, period: '12 meses', asOf: brDate(v.data), source: 'Banco Central (SGS)' }]
    }],
    ['Ibovespa', async () => {
      const m = (await json('https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?interval=1d&range=5d'))?.chart?.result?.[0]?.meta
      return num(m?.regularMarketPrice) === null ? [] : [{ id: 'ibovespa', label: 'Ibovespa', value: Math.round(num(m.regularMarketPrice)!), unit: 'pts', changePct: r2(num(m.regularMarketChangePercent)), period: 'dia', asOf: iso(m.regularMarketTime), source: 'Yahoo Finance' }]
    }],
  ]
  const ORDER = ['bitcoin', 'ethereum', 'dolar', 'euro', 'ibovespa', 'selic', 'ipca']

  const send = (res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8') => {
    res.statusCode = status
    res.setHeader('content-type', type)
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }
  const sameSite = (req: IncomingMessage) => {
    const site = req.headers['sec-fetch-site']
    return !site || site === 'same-origin' || site === 'none'
  }

  return {
    name: 'briefing-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__briefing/feed', (req, res) => {
        void (async () => {
          if (req.method !== 'GET' || !sameSite(req)) return send(res, 403, '[url] origem não permitida')
          const url = new URL(req.url ?? '/', 'http://localhost').searchParams.get('url') ?? ''
          if (!allow.has(url)) return send(res, 403, '[url] só fontes cadastradas podem ser buscadas')
          try {
            const { buf, type } = await get(url, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5', 10_000, MAX_BYTES)
            const text = decode(buf, type)
            const head = text.slice(0, 4096).trimStart().toLowerCase()
            if (head.startsWith('<!doctype html') || head.startsWith('<html') || !/<rss|<feed|<rdf:rdf/.test(head)) {
              return send(res, 502, '[formato] o endereço respondeu, mas não é um feed RSS ou Atom')
            }
            send(res, 200, text)
          } catch (e) {
            send(res, 502, (e as Error).message)
          }
        })()
      })
      server.middlewares.use('/__briefing/market', (req, res) => {
        void (async () => {
          if (req.method !== 'GET' || !sameSite(req)) return send(res, 403, '[url] origem não permitida')
          const results = await Promise.allSettled(jobs.map(([, f]) => f()))
          const quotes: Q[] = []
          const errors: string[] = []
          results.forEach((r, i) => (r.status === 'fulfilled' && r.value.length ? quotes.push(...r.value) : errors.push(`${jobs[i][0]}: indisponível`)))
          quotes.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
          send(res, 200, JSON.stringify({ quotes, errors }), 'application/json; charset=utf-8')
        })()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), radarFeedProxy(), briefingDevProxy()],
})
