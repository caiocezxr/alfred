import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { civil } from '../../shared/dates'
import { MOODS, moodApi, type DayCheckin } from './api'
import { Face } from './CheckIn'
import './mood.css'

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const fmtDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

const pad = (n: number) => String(n).padStart(2, '0')
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const fmt1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function readingDays(): Set<string> {
  try {
    const d = JSON.parse(localStorage.getItem('ps.bible.daily.v1') ?? 'null')
    return new Set((d?.log ?? []).map((l: { date: string }) => l.date))
  } catch {
    return new Set()
  }
}

function insights(days: DayCheckin[], today: string) {
  const rated = days.filter((d) => d.mood)
  const out: string[] = []
  if (rated.length < 7) return out
  const m = (xs: DayCheckin[]) => avg(xs.map((d) => d.mood!))
  const coffee = rated.filter((d) => d.coffee === true)
  const noCoffee = rated.filter((d) => d.coffee !== true)
  if (coffee.length >= 3 && noCoffee.length >= 3) {
    const a = m(coffee)
    const b = m(noCoffee)
    if (Math.abs(a - b) >= 0.2) out.push(`Nos dias com café 14, seu humor médio é ${fmt1(a)}; sem café, ${fmt1(b)}.`)
  }
  const read = readingDays()
  const withBible = rated.filter((d) => read.has(d.date))
  const without = rated.filter((d) => !read.has(d.date))
  if (withBible.length >= 3 && without.length >= 3) {
    const a = m(withBible)
    const b = m(without)
    if (Math.abs(a - b) >= 0.2) out.push(`Nos dias em que você leu a Bíblia, seu humor médio foi ${fmt1(a)}; nos outros, ${fmt1(b)}.`)
  }
  const byDow = new Map<number, number[]>()
  for (const d of rated) {
    const k = new Date(`${d.date}T12:00:00`).getDay()
    byDow.set(k, [...(byDow.get(k) ?? []), d.mood!])
  }
  const dows = [...byDow.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => [k, avg(v)] as const)
  if (dows.length >= 3) {
    const best = dows.reduce((a, b) => (b[1] > a[1] ? b : a))
    const worst = dows.reduce((a, b) => (b[1] < a[1] ? b : a))
    if (best[1] - worst[1] >= 0.4) out.push(`Seu melhor dia da semana é ${WEEKDAYS[best[0]]} (${fmt1(best[1])}); o mais pesado, ${WEEKDAYS[worst[0]]} (${fmt1(worst[1])}).`)
  }
  const ym = today.slice(0, 7)
  const prevDate = new Date(`${ym}-01T12:00:00`)
  prevDate.setMonth(prevDate.getMonth() - 1)
  const pm = `${prevDate.getFullYear()}-${pad(prevDate.getMonth() + 1)}`
  const cur = rated.filter((d) => d.date.startsWith(ym))
  const prev = rated.filter((d) => d.date.startsWith(pm))
  if (cur.length >= 4 && prev.length >= 4) {
    const diff = m(cur) - m(prev)
    if (Math.abs(diff) >= 0.2) out.push(diff > 0 ? `Este mês está mais leve que o anterior (${fmt1(m(cur))} contra ${fmt1(m(prev))}).` : `Este mês está mais pesado que o anterior (${fmt1(m(cur))} contra ${fmt1(m(prev))}). Vale cuidar de você.`)
  }
  return out
}

export function MoodYear({ onClose }: { onClose: () => void }) {
  const today = civil()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [days, setDays] = useState<DayCheckin[] | null>(null)
  const [hover, setHover] = useState<{ date: string; x: number; y: number } | null>(null)

  useEffect(() => {
    let alive = true
    setDays(null)
    void moodApi.range(`${year}-01-01`, `${year}-12-31`).then((d) => alive && setDays(d), () => alive && setDays([]))
    return () => {
      alive = false
    }
  }, [year])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const byDate = useMemo(() => new Map((days ?? []).map((d) => [d.date, d])), [days])
  const rated = (days ?? []).filter((d) => d.mood)
  const mean = avg(rated.map((d) => d.mood!))
  const streak = useMemo(() => {
    let n = 0
    const d = new Date(`${today}T12:00:00`)
    for (;;) {
      const k = civil(d)
      if (!byDate.get(k)?.mood) break
      n++
      d.setDate(d.getDate() - 1)
    }
    return n
  }, [byDate, today])
  const lines = useMemo(() => insights(days ?? [], today), [days, today])
  const hovered = hover ? byDate.get(hover.date) : null

  return createPortal(
    <div className="my-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="my-panel" role="dialog" aria-label="Seu ano em humor">
        <header className="my-head">
          <div>
            <div className="kicker">Seu ano em humor</div>
            <div className="my-year">
              <button className="my-nav" onClick={() => setYear((y) => y - 1)} aria-label="Ano anterior">‹</button>
              <h2 className="display">{year}</h2>
              <button className="my-nav" onClick={() => setYear((y) => y + 1)} disabled={year >= Number(today.slice(0, 4))} aria-label="Próximo ano">›</button>
            </div>
          </div>
          <div className="my-stats">
            <div>
              <b>{rated.length}</b>
              <span>dias registrados</span>
            </div>
            <div>
              <b>{rated.length ? fmt1(mean) : '–'}</b>
              <span>humor médio</span>
            </div>
            <div>
              <b>{streak}</b>
              <span>{streak === 1 ? 'dia seguido' : 'dias seguidos'}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <div className="my-grid" onPointerLeave={() => setHover(null)}>
          <div className="my-daynums" aria-hidden="true">
            {Array.from({ length: 31 }, (_, i) => (
              <span key={i}>{(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}</span>
            ))}
          </div>
          {MONTHS.map((mName, mi) => {
            const len = new Date(year, mi + 1, 0).getDate()
            return (
              <div key={mName} className="my-month">
                <span className="my-mname">{mName}</span>
                {Array.from({ length: 31 }, (_, di) => {
                  if (di >= len) return <i key={di} className="my-cell is-void" />
                  const date = `${year}-${pad(mi + 1)}-${pad(di + 1)}`
                  const d = byDate.get(date)
                  const future = date > today
                  const color = d?.mood ? MOODS[d.mood - 1].color : undefined
                  return (
                    <i
                      key={di}
                      className={`my-cell ${d?.mood ? 'is-set' : ''} ${date === today ? 'is-today' : ''} ${future ? 'is-future' : ''}`}
                      style={color ? { ['--mc' as string]: color, animationDelay: `${(mi * 31 + di) * 2}ms` } : undefined}
                      onPointerEnter={(e) => {
                        const r = (e.target as HTMLElement).getBoundingClientRect()
                        setHover({ date, x: r.left + r.width / 2, y: r.top })
                      }}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>

        <footer className="my-foot">
          <div className="my-legend">
            {MOODS.map((m) => (
              <span key={m.id} style={{ ['--mc' as string]: m.color }}>
                <i />
                {m.label}
              </span>
            ))}
          </div>
          <div className="my-insights">
            {days && lines.length === 0 && <p className="my-empty">Registre o humor por uma semana e as descobertas aparecem aqui: café, leitura da Bíblia, dias da semana.</p>}
            {lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        </footer>

        {hover && (
          <div className="my-tip" style={{ left: hover.x, top: hover.y }}>
            <div className="my-tip-date">{fmtDay.format(new Date(`${hover.date}T12:00:00`))}</div>
            {hovered?.mood ? (
              <div className="my-tip-mood" style={{ color: MOODS[hovered.mood - 1].color }}>
                <Face level={hovered.mood} size={16} />
                {MOODS[hovered.mood - 1].label}
                {hovered.coffee ? <span className="my-tip-coffee">· café 14</span> : null}
              </div>
            ) : (
              <div className="my-tip-none">{hover.date > today ? 'ainda não chegou' : 'sem registro'}</div>
            )}
            {hovered?.note && <div className="my-tip-note">{hovered.note}</div>}
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
