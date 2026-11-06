import { useMemo } from 'react'
import { addDays, parseCivil } from '../../shared/dates'
import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import { DayMap } from './Copilot'
import { computeMetrics, deliveryWeeks, fmtDur, itemTimeMs, rangeTimeMs, shortDay, sumTime, weekStart, type Health, type Scope } from './logic'
import { openItem } from './store'
import { Odometer } from './Odometer'
import type { WorkState } from './types'

const fmtWeek = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
const wk = (d: string) => fmtWeek.format(parseCivil(d)).replace(/\./g, '')

export function Delivered({ state, today, scope, health }: { state: WorkState; today: string; scope: Scope; health: Health }) {
  const m = useMemo(() => computeMetrics(state, today, scope), [state, today, scope])
  const weeks = useMemo(() => deliveryWeeks(state, scope), [state, scope])
  const companies = new Map(state.companies.map((c) => [c.id, c]))
  const max = Math.max(1, ...m.weeks.map((w) => w.total))
  const cur = weekStart(today)
  const order = state.companies.map((c) => c.id)
  const nowMs = Date.now()
  const weekTime = rangeTimeMs(state.sessions, state.items, cur, today, nowMs, scope)
  const weekTotal = sumTime(weekTime)
  const monthKey = today.slice(0, 7)
  const monthCount = weeks.reduce((n, w) => n + w.cycles.filter((c) => c.deliveredAt.slice(0, 7) === monthKey).length, 0)
  const doneCount = weeks.reduce((n, w) => n + w.cycles.filter((c) => c.doneAt || c.validatedAt).length, 0)
  return (
    <div className="wk-delivered is-v2">
      <section className="wk-dv-board reveal" style={{ ['--i' as string]: 1 }} aria-label="Placar de entregas">
        <div className="wk-dv-big">
          <span className="wk-dv-k">
            <i aria-hidden="true" />
            Entregas no mês
          </span>
          <Odometer value={monthCount} digits={2} label="Entregas no mês" />
          <span className="wk-dv-sub">
            <b>{m.thisWeek}</b> esta semana · <b>{doneCount}</b> fechadas
          </span>
        </div>
        <div className="wk-dv-eq" role="img" aria-label={`Entregas por semana: ${m.weeks.map((w) => w.total).join(', ')}`}>
          {m.weeks.map((w, i) => (
            <div key={w.start} className={`wk-dv-col ${w.start === cur ? 'is-now' : ''}`} title={`Semana de ${wk(w.start)}: ${w.total}`}>
              <span className="wk-dv-n">{w.total || ''}</span>
              <div className="wk-dv-bar">
                <div className="wk-dv-fill" style={{ height: `${(w.total / max) * 100}%`, ['--i' as string]: i }}>
                  {order
                    .filter((id) => w.byCompany[id])
                    .map((id) => (
                      <span key={id} style={{ flexGrow: w.byCompany[id], ...coStyle(companies.get(id)) }} />
                    ))}
                </div>
              </div>
              <span className="wk-dv-x">{w.start === cur ? 'esta' : wk(w.start)}</span>
            </div>
          ))}
        </div>
        <dl className="wk-dv-kpis">
          <div>
            <dt>Retorno</dt>
            <dd>{m.returnRate.pct === null ? '—' : `${m.returnRate.pct}%`}</dd>
            <small>{m.returnRate.delivered ? `${m.returnRate.returned} de ${m.returnRate.delivered} em 60 dias` : 'sem entregas ainda'}</small>
          </div>
          <div>
            <dt>Até validar</dt>
            <dd>{m.validation.avgDays === null ? '—' : `${String(m.validation.avgDays).replace('.', ',')} d`}</dd>
            <small>{m.validation.n ? `média de ${m.validation.n}` : 'sem validações'}</small>
          </div>
          <div>
            <dt>Tempo na semana</dt>
            <dd>{weekTotal ? fmtDur(weekTotal) : '—'}</dd>
            <small>
              {weekTotal
                ? Object.entries(weekTime)
                    .map(([co, ms]) => `${companies.get(co)?.name ?? co} ${fmtDur(ms)}`)
                    .join(' · ')
                : `${m.doneLast7} concluídos em 7 dias`}
            </small>
          </div>
        </dl>
      </section>

      <section className="panel wk-dv-more reveal" style={{ ['--i' as string]: 2 }}>
        <div className="wk-metrics-days">
          <span className="wk-tips-title">Constância</span>
          <DayMap state={state} today={today} health={health} weeks={18} />
        </div>
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
        <div className="wk-empty reveal" style={{ ['--i' as string]: 3 }}>
          <Icon name="spark" size={20} />
          <h3 className="display">Suas entregas aparecem aqui</h3>
          <p>Cada vez que algo vai para Entregue, ganha um bilhete aqui e recebe um carimbo a cada etapa: testado, validado, concluído.</p>
        </div>
      ) : (
        weeks.map((w, wi) => (
          <section key={w.start} className="wk-dv-week reveal" style={{ ['--i' as string]: wi + 3 }}>
            <header className="wk-dv-week-h">
              <h3 className="display">{w.start === cur ? 'Esta semana' : w.start === addDays(cur, -7) ? 'Semana passada' : `Semana de ${wk(w.start)}`}</h3>
              <span className="wk-dv-count">
                {w.cycles.length} {w.cycles.length === 1 ? 'entrega' : 'entregas'}
                {w.cycles.some((c) => c.returned) && ` · ${w.cycles.filter((c) => c.returned).length} voltou`}
              </span>
            </header>
            <ul className="wk-dv-list">
              {w.cycles.map((c, ci) => {
                const co = companies.get(c.item.companyId)
                const steps = [
                  { k: 'Entregue', at: c.deliveredAt },
                  { k: 'Testado', at: c.testedAt },
                  { k: 'Validado', at: c.validatedSeparately ? c.validatedAt : null },
                  { k: 'Concluído', at: c.doneAt },
                ]
                const last = c.returned ? null : [...steps].reverse().find((x) => x.at) ?? steps[0]
                const stamp = c.returned ? 'Voltou' : last!.k
                const stampAt = c.returned ? null : last!.at
                const tone = c.returned ? 'ret' : c.doneAt ? 'done' : c.validatedAt ? 'ok' : c.testedAt ? 'test' : 'sent'
                const spent = itemTimeMs(state.sessions, c.itemId, nowMs)
                return (
                  <li key={`${c.itemId}-${c.deliveredAt}`} className={`wk-tk is-${tone}`} style={{ ...coStyle(co), ['--k' as string]: ci }}>
                    <button className="wk-tk-main" onClick={() => openItem(c.itemId)}>
                      <span className="wk-tk-top">
                        <CompanyMark company={co} size={16} />
                        {c.item.ticket && <span className="wk-tk-code">{c.item.ticket}</span>}
                        <span className="wk-tk-co">{co?.name}</span>
                        {spent >= 60000 && (
                          <span className="wk-tk-time">
                            <Icon name="clock" size={11} />
                            {fmtDur(spent)}
                          </span>
                        )}
                      </span>
                      <span className="wk-tk-title">{c.item.title}</span>
                      <ol className="wk-tk-rail" aria-label="Etapas">
                        {steps.map((s) => (
                          <li key={s.k} className={s.at ? 'is-on' : ''} title={`${s.k}: ${s.at ? shortDay(s.at, today) : 'ainda não'}`}>
                            <i aria-hidden="true" />
                            <span>{s.k}</span>
                          </li>
                        ))}
                      </ol>
                      {c.returned && (
                        <span className="wk-tk-note">
                          <Icon name="back" size={11} /> voltou: {c.returnReason}
                        </span>
                      )}
                      {c.pending > 0 && <span className="wk-tk-note is-quiet">entregue com {c.pending} pendência{c.pending > 1 ? 's' : ''} no checklist</span>}
                    </button>
                    <div className="wk-tk-stub" aria-label={`Situação: ${stamp}`}>
                      {tone === 'done' ? (
                        <span className="wk-tk-check" title="Concluído">
                          <svg viewBox="0 0 36 36" aria-hidden="true">
                            <circle cx="18" cy="18" r="15" />
                            <path d="M11.5 18.5l4.6 4.6 8.6-9.4" />
                          </svg>
                        </span>
                      ) : (
                        <span className="wk-tk-stamp">{stamp}</span>
                      )}
                      <span className="wk-tk-date">{stampAt ? shortDay(stampAt, today) : 'reabrir'}</span>
                    </div>
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
