import { useMemo, useState, useSyncExternalStore } from 'react'
import type { Bible, VerseRef } from '../data/bible'
import { formatRange, readingRange } from '../data/readingPlan'
import { addGratitude, dailyStore, removeGratitude, today, type GoalUnit } from '../data/stores'

const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })

function parseDay(d: string) {
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(y, m - 1, dd)
}

export function TodayPanel({ bible, current, onClose, onGo }: {
  bible: Bible
  current: VerseRef
  onClose: () => void
  onGo: (ref: VerseRef) => void
}) {
  const s = useSyncExternalStore(dailyStore.subscribe, dailyStore.get)
  const [grat, setGrat] = useState('')
  const day = today()
  const doneToday = s.log.some((l) => l.date === day && !l.extra)
  const range = useMemo(() => readingRange(bible, s.cursor, s.goal.unit, s.goal.amount), [bible, s.cursor, s.goal])

  const last7 = useMemo(() => {
    const out: { d: string; read: boolean; label: string }[] = []
    const base = new Date()
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i)
      const d = today(dt)
      out.push({ d, read: s.log.some((l) => l.date === d), label: 'dstqqss'[dt.getDay()] })
    }
    return out
  }, [s.log])

  const setGoal = (unit: GoalUnit, amount: number) =>
    dailyStore.set({ ...s, goal: { unit, amount: Math.max(1, Math.min(unit === 'chapters' ? 10 : 60, amount)) } })

  const markRead = (extra = false) => {
    dailyStore.set({
      ...s,
      log: [...s.log, { date: day, from: range.from, to: range.to, extra }],
      cursor: range.next ?? s.cursor,
    })
  }

  const todaysGratitude = s.gratitude.filter((g) => g.date === day)
  const older = s.gratitude.filter((g) => g.date !== day).slice(0, 12)

  return (
    <aside className="side-panel" aria-label="Hoje">
      <div className="panel-head">
        <div>
          <div className="panel-kicker">{longDate.format(new Date())}</div>
          <h2>Hoje</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">×</button>
      </div>

      <section className="today-block">
        <h3>Leitura do dia</h3>
        <div className="reading-card">
          <div className="reading-ref">{formatRange(bible, range.from, range.to)}</div>
          {doneToday ? (
            <p className="reading-done">Leitura de hoje concluída. Amanhã continua daqui.</p>
          ) : (
            <p className="reading-hint">Continua de onde você parou. Sem pressa, sem atraso acumulado.</p>
          )}
          <div className="reading-actions">
            <button className="btn ghost" onClick={() => onGo(range.from)}>Abrir trecho</button>
            {doneToday ? (
              <button className="btn" onClick={() => markRead(true)}>Registrar leitura extra</button>
            ) : (
              <button className="btn primary" onClick={() => markRead(false)}>Marcar como lida</button>
            )}
          </div>
        </div>

        <div className="goal-row">
          <span>Meta</span>
          <div className="stepper">
            <button onClick={() => setGoal(s.goal.unit, s.goal.amount - 1)} aria-label="Menos">−</button>
            <span>{s.goal.amount}</span>
            <button onClick={() => setGoal(s.goal.unit, s.goal.amount + 1)} aria-label="Mais">+</button>
          </div>
          <div className="segmented small">
            <button aria-selected={s.goal.unit === 'chapters'} onClick={() => setGoal('chapters', s.goal.amount)}>
              {s.goal.amount === 1 ? 'capítulo' : 'capítulos'}
            </button>
            <button aria-selected={s.goal.unit === 'verses'} onClick={() => setGoal('verses', s.goal.amount)}>
              {s.goal.amount === 1 ? 'versículo' : 'versículos'}
            </button>
          </div>
        </div>
        <button
          className="link-btn"
          onClick={() => dailyStore.set({ ...s, cursor: { book: current.book, chapter: current.chapter, verse: 0 } })}
        >
          Começar o plano a partir de {bible.books[current.book].name} {current.chapter + 1}
        </button>

        <div className="week" aria-label="Últimos 7 dias">
          {last7.map((d) => (
            <div key={d.d} className={`week-day ${d.read ? 'is-read' : ''} ${d.d === day ? 'is-today' : ''}`} title={shortDate.format(parseDay(d.d))}>
              <span className="week-dot" />
              <span className="week-label">{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="today-block">
        <h3>Gratidão</h3>
        <form
          className="grat-form"
          onSubmit={(e) => {
            e.preventDefault()
            addGratitude(grat)
            setGrat('')
          }}
        >
          <textarea
            placeholder="Pelo que você é grato hoje?"
            value={grat}
            rows={2}
            onChange={(e) => setGrat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) {
                e.preventDefault()
                addGratitude(grat)
                setGrat('')
              }
            }}
          />
          <button className="btn" type="submit" disabled={!grat.trim()}>Guardar</button>
        </form>
        {todaysGratitude.length > 0 && (
          <ul className="grat-list">
            {todaysGratitude.map((g) => (
              <li key={g.id}>
                <span>{g.text}</span>
                <button className="link-btn" onClick={() => removeGratitude(g.id)} aria-label="Remover">×</button>
              </li>
            ))}
          </ul>
        )}
        {older.length > 0 && (
          <>
            <h4>Dias anteriores</h4>
            <ul className="grat-list older">
              {older.map((g) => (
                <li key={g.id}>
                  <span className="grat-date">{shortDate.format(parseDay(g.date))}</span>
                  <span>{g.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </aside>
  )
}
