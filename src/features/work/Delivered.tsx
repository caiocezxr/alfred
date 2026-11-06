import { useMemo } from 'react'
import { addDays, parseCivil } from '../../shared/dates'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import { computeMetrics, deliveryWeeks, fmtDur, itemTimeMs, rangeTimeMs, shortDay, sumTime, weekStart, type Scope } from './logic'
import { openItem } from './store'
import type { WorkState } from './types'

const fmtWeek = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
const wk = (d: string) => fmtWeek.format(parseCivil(d)).replace(/\./g, '')

export function Delivered({ state, today, scope }: { state: WorkState; today: string; scope: Scope }) {
  const m = useMemo(() => computeMetrics(state, today, scope), [state, today, scope])
  const weeks = useMemo(() => deliveryWeeks(state, scope), [state, scope])
  const companies = new Map(state.companies.map((c) => [c.id, c]))
  const max = Math.max(1, ...m.weeks.map((w) => w.total))
  const cur = weekStart(today)
  const order = state.companies.map((c) => c.id)
  const nowMs = Date.now()
  const weekTime = rangeTimeMs(state.sessions, state.items, cur, today, nowMs, scope)
  const weekTotal = sumTime(weekTime)
  return (
    <div className="wk-delivered">
      <section className="panel wk-metrics reveal" style={{ ['--i' as string]: 1 }} aria-label="Métricas">
        <div className="wk-chart" role="img" aria-label={`Entregas por semana: ${m.weeks.map((w) => w.total).join(', ')}`}>
          {m.weeks.map((w, i) => (
            <div key={w.start} className={`wk-bar-col ${w.start === cur ? 'is-now' : ''}`} title={`Semana de ${wk(w.start)}: ${w.total}`}>
              <span className="wk-bar-n">{w.total || ''}</span>
              <div className="wk-bar-stack" style={{ height: `${(w.total / max) * 100}%`, ['--i' as string]: i }}>
                {order
                  .filter((id) => w.byCompany[id])
                  .map((id) => (
                    <span key={id} style={{ flexGrow: w.byCompany[id], ...coStyle(companies.get(id)) }} />
                  ))}
              </div>
              <span className="wk-bar-x">{w.start === cur ? 'esta' : wk(w.start)}</span>
            </div>
          ))}
        </div>
        <dl className="wk-kpis">
          <div>
            <dt>Esta semana</dt>
            <dd>
              {m.thisWeek} <small>{m.thisWeek === 1 ? 'entrega' : 'entregas'}</small>
            </dd>
          </div>
          <div>
            <dt>Taxa de retorno</dt>
            <dd>
              {m.returnRate.pct === null ? '—' : `${m.returnRate.pct}%`}
              <small>{m.returnRate.delivered ? `${m.returnRate.returned} de ${m.returnRate.delivered} em 60 dias` : 'sem entregas ainda'}</small>
            </dd>
          </div>
          <div>
            <dt>Entrega → validação</dt>
            <dd>
              {m.validation.avgDays === null ? '—' : `${String(m.validation.avgDays).replace('.', ',')} d`}
              <small>{m.validation.n ? `média de ${m.validation.n}` : 'sem validações separadas'}</small>
            </dd>
          </div>
          <div>
            <dt>Tempo esta semana</dt>
            <dd>
              {weekTotal ? fmtDur(weekTotal) : '—'}
              <small>
                {weekTotal
                  ? Object.entries(weekTime)
                      .map(([co, ms]) => `${companies.get(co)?.name ?? co} ${fmtDur(ms)}`)
                      .join(' · ')
                  : `${m.doneLast7} concluídos em 7 dias`}
              </small>
            </dd>
          </div>
        </dl>
        {m.systems.length > 0 && (
          <div className="wk-systems">
            <span className="wk-tips-title">Onde seu tempo foi (30 dias)</span>
            {m.systems.map((s) => (
              <span key={s.name} className="wk-sys">
                <span className="wk-sys-bar" style={{ transform: `scaleX(${s.count / m.systems[0].count})` }} />
                <b>{s.name}</b>
                <em>{s.count}</em>
              </span>
            ))}
          </div>
        )}
      </section>

      {weeks.length === 0 ? (
        <div className="wk-empty reveal" style={{ ['--i' as string]: 2 }}>
          <Icon name="spark" size={20} />
          <h3 className="display">Suas entregas aparecem aqui</h3>
          <p>Cada vez que algo vai para Entregue, entra nesta linha do tempo com as datas de teste e validação.</p>
        </div>
      ) : (
        weeks.map((w, wi) => (
          <section key={w.start} className="panel wk-week reveal" style={{ ['--i' as string]: wi + 2 }}>
            <header className="wk-week-head">
              <h3 className="display">{w.start === cur ? 'Esta semana' : w.start === addDays(cur, -7) ? 'Semana passada' : `Semana de ${wk(w.start)}`}</h3>
              <span>
                {w.cycles.length} {w.cycles.length === 1 ? 'entrega' : 'entregas'}
                {w.cycles.some((c) => c.returned) && ` · ${w.cycles.filter((c) => c.returned).length} voltou`}
              </span>
            </header>
            <ul className="wk-week-list">
              {w.cycles.map((c) => {
                const co = companies.get(c.item.companyId)
                const steps = [
                  { k: 'Entregue', at: c.deliveredAt },
                  { k: 'Testado', at: c.testedAt },
                  { k: 'Validado', at: c.validatedSeparately ? c.validatedAt : null },
                  { k: 'Concluído', at: c.doneAt },
                ]
                return (
                  <li key={`${c.itemId}-${c.deliveredAt}`} className={`wk-dl ${c.returned ? 'is-returned' : ''} ${c.doneAt || c.validatedAt ? 'is-closed' : ''}`} style={coStyle(co)}>
                    <button className="wk-dl-main" onClick={() => openItem(c.itemId)}>
                      <CompanyMark company={co} size={16} />
                      <span className="wk-dl-title">
                        {c.item.ticket && <span className="wk-ticket">{c.item.ticket}</span>}
                        {c.item.title}
                      </span>
                    </button>
                    <ol className="wk-dl-track" aria-label="Datas">
                      {steps.map((s) => (
                        <li key={s.k} className={s.at ? 'is-on' : ''}>
                          <span className="wk-dl-dot" aria-hidden="true" />
                          <span className="wk-dl-k">{s.k}</span>
                          <span className="wk-dl-at">{s.at ? shortDay(s.at, today) : '—'}</span>
                        </li>
                      ))}
                    </ol>
                    {itemTimeMs(state.sessions, c.itemId, nowMs) >= 60000 && (
                      <span className="wk-dl-time">
                        <Icon name="clock" size={11} />
                        {fmtDur(itemTimeMs(state.sessions, c.itemId, nowMs))}
                      </span>
                    )}
                    {c.returned && (
                      <span className="wk-dl-ret">
                        <Icon name="back" size={11} />
                        voltou: {c.returnReason}
                      </span>
                    )}
                    {c.pending > 0 && <span className="wk-dl-ret is-quiet">entregue com {c.pending} pendência{c.pending > 1 ? 's' : ''} no checklist</span>}
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
