import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { fmtShort, parseCivil } from '../../shared/dates'
import type { Checkin, Habit } from '../../shared/db/api'
import { daysOn, describeDays, isScheduled, monthGrid } from '../../shared/db/stores'
import { Odometer } from '../work/Odometer'
import { CATEGORIES, MILESTONES, generateTips, numbersOf, setMeta, useHabitMeta } from './meta'

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)

export function HabitSheet({ habit, checkins, today, onClose, onEdit }: { habit: Habit; checkins: Checkin[]; today: string; onClose: () => void; onEdit: () => void }) {
  const metaOf = useHabitMeta()
  const m = metaOf(habit)
  const n = useMemo(() => numbersOf(habit, checkins, today), [habit, checkins, today])
  const grid = useMemo(() => monthGrid(today, 12), [today])
  const map = useMemo(() => new Map(checkins.filter((c) => c.habitId === habit.id).map((c) => [c.date, c.status])), [checkins, habit.id])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const quit = m.kind === 'largar'
  const next = MILESTONES.find((x) => x > n.streak) ?? null

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const tips = async () => {
    setBusy(true)
    setErr(null)
    try {
      await generateTips(habit, m)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="hs-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="hs" role="dialog" aria-label={`Ficha: ${habit.name}`}>
        <header className="hs-head">
          <div>
            <div className="kicker">{quit ? 'Largar' : 'Construir'}{m.category ? ` · ${m.category}` : ''}</div>
            <h2 className="display">{habit.name}</h2>
            <p className="hs-sub">{describeDays(daysOn(habit, today) || 127)}{habit.cue ? ` · depois de ${habit.cue.replace(/^depois de\s*/i, '')}` : ''}</p>
          </div>
          <button className="hs-x" onClick={onClose} aria-label="Fechar">
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <section className="hs-class">
          <div className="hs-seg" role="radiogroup" aria-label="Tipo de hábito">
            {(['construir', 'largar'] as const).map((k) => (
              <button key={k} role="radio" aria-checked={m.kind === k} className={m.kind === k ? 'is-on' : ''} onClick={() => setMeta(habit.id, { kind: k }, m)}>
                {k === 'construir' ? 'Construir' : 'Largar'}
              </button>
            ))}
          </div>
          <div className="hs-cats">
            {CATEGORIES.map((c) => (
              <button key={c} className={m.category === c ? 'is-on' : ''} onClick={() => setMeta(habit.id, { category: m.category === c ? null : c }, m)}>
                {c}
              </button>
            ))}
          </div>
        </section>

        <section className="hs-board">
          <div className="hs-streak">
            <span className="hs-k">{quit ? 'Dias limpo' : 'Sequência'}</span>
            <Odometer value={n.streak} digits={n.streak > 99 ? 3 : 2} label={quit ? 'Dias limpo' : 'Sequência'} />
            <span className="hs-next">{next ? `faltam ${next - n.streak} para o marco de ${next}` : 'todos os marcos batidos'}</span>
          </div>
          <dl className="hs-nums">
            <div>
              <dt>Recorde</dt>
              <dd>{n.best} d</dd>
            </div>
            <div>
              <dt>{quit ? 'Dias limpo no total' : 'Feitos no total'}</dt>
              <dd>{n.total + n.minimum}</dd>
            </div>
            <div>
              <dt>7 dias</dt>
              <dd>{pct(n.rate7)}</dd>
            </div>
            <div>
              <dt>30 dias</dt>
              <dd>{pct(n.rate30)}</dd>
            </div>
            <div>
              <dt>{quit ? 'Recaídas' : 'Falhas'} · 30 d</dt>
              <dd>{n.failed30}</dd>
            </div>
            <div>
              <dt>Sem marcar · 30 d</dt>
              <dd className={n.unmarked30 ? 'is-warn' : ''}>{n.unmarked30}</dd>
            </div>
          </dl>
        </section>

        <section className="hs-sec">
          <h3>Marcos</h3>
          <ol className="hs-marks">
            {MILESTONES.map((x, i) => {
              const got = n.best >= x
              return (
                <li key={x} className={got ? 'is-got' : ''} style={{ ['--k' as string]: i } as CSSProperties} title={got ? `${x} dias: conquistado` : `${x} dias`}>
                  <span className="hs-medal">
                    <b>{x}</b>
                  </span>
                  <small>dias</small>
                </li>
              )
            })}
          </ol>
        </section>

        <section className="hs-sec">
          <h3>Últimas 12 semanas</h3>
          <div className="hs-heat" role="img" aria-label="Histórico">
            {grid.map((col, ci) => (
              <div key={ci}>
                {col.map((d) => {
                  const st = map.get(d)
                  const cls = d > today ? 'is-future' : st === 'done' ? 'is-done' : st === 'minimum' ? 'is-min' : m.missed?.includes(d) ? 'is-fail' : isScheduled(habit, d) && d < today && d >= habit.startDate ? 'is-miss' : 'is-off'
                  return <i key={d} className={`${cls} ${d === today ? 'is-today' : ''}`} title={fmtShort.format(parseCivil(d))} />
                })}
              </div>
            ))}
          </div>
        </section>

        <section className="hs-sec hs-tips">
          <h3>
            Dicas para {quit ? 'largar' : 'manter'}
            <button className="hs-gen" onClick={() => void tips()} disabled={busy}>
              {busy ? 'Gerando…' : m.tips.length ? 'Gerar outras' : 'Gerar com IA'}
            </button>
          </h3>
          {busy && <p className="hs-muted">O modelo local está pensando. Na primeira vez pode levar uns 30 segundos.</p>}
          {err && <p className="hs-err">{err}</p>}
          {m.tips.length > 0 ? (
            <ul>
              {m.tips.map((t, i) => (
                <li key={i} style={{ ['--k' as string]: i } as CSSProperties}>
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            !busy && <p className="hs-muted">Gere dicas feitas para este hábito, considerando o gatilho e a versão mínima que você definiu.</p>
          )}
        </section>

        <footer className="hs-foot">
          <button className="btn quiet sm" onClick={onEdit}>
            Editar hábito
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  )
}

export function Celebrate({ days, name, quit, onDone }: { days: number; name: string; quit: boolean; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 4200)
    const k = () => onDone()
    window.addEventListener('keydown', k)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('keydown', k)
    }
  }, [onDone])
  return createPortal(
    <div className="hc-cel" onClick={onDone} role="status">
      <div className="hc-cel-card">
        <span className="hc-cel-k">Marco batido</span>
        <span className="hc-cel-medal">
          <b>{days}</b>
          <small>dias</small>
        </span>
        <h3>{quit ? `${days} dias limpo.` : `${days} dias seguidos.`}</h3>
        <p>Parabéns. Continue firme.</p>
        <span className="hc-cel-name">{name}</span>
      </div>
    </div>,
    document.body,
  )
}
