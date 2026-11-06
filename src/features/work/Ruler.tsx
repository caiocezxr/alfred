import { CompanyMark, coStyle } from './brand'
import { Icon } from './icons'
import type { RulerModel, RulerPin } from './logic'
import { openDialog, openItemFrom } from './store'
import type { Company } from './types'

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function prefillCapture(text: string) {
  window.dispatchEvent(new CustomEvent('wk:prefill', { detail: text }))
}

export function Ruler({ model, companies }: { model: RulerModel; companies: Company[] }) {
  const span = model.endMin - model.startMin
  const pct = (m: number) => `${((Math.min(model.endMin, Math.max(model.startMin, m)) - model.startMin) / span) * 100}%`
  const hours: number[] = []
  for (let h = Math.ceil(model.startMin / 60); h * 60 <= model.endMin; h++) hours.push(h)
  const co = (id: string) => companies.find((c) => c.id === id)
  const open = (p: RulerPin) => (p.todoId ? openDialog({ kind: 'todo', todoId: p.todoId }) : p.itemId && openItemFrom(p.itemId, document.querySelector<HTMLElement>(`[data-card="${p.itemId}"]`)))
  return (
    <div className="wk-ruler" aria-label="Seu dia">
      {model.allDay.length > 0 && (
        <div className="wk-ruler-allday">
          {model.allDay.slice(0, 2).map((p) => (
            <button key={p.id} className={`wk-ruler-chip is-${p.kind}`} style={coStyle(co(p.companyId))} onClick={() => open(p)} title={`Hoje: ${p.title}`}>
              <Icon name="flag" size={10} />
              <CompanyMark company={co(p.companyId)} size={11} />
              <span>{p.title}</span>
            </button>
          ))}
          {model.allDay.length > 2 && <span className="wk-ruler-more">+{model.allDay.length - 2}</span>}
        </div>
      )}
      <div
        className="wk-ruler-track"
        title="Clique num horário para capturar algo para essa hora"
        onClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('wk-ruler-past')) return
          const r = e.currentTarget.getBoundingClientRect()
          const m = Math.round((model.startMin + ((e.clientX - r.left) / r.width) * span) / 15) * 15
          const h = Math.floor(m / 60)
          const mm = m % 60
          prefillCapture(`às ${h}h${mm ? String(mm).padStart(2, '0') : ''}`)
        }}
      >
        {hours.map((h) => (
          <span key={h} className={`wk-ruler-hour ${h % 2 === 0 ? 'is-major' : ''}`} style={{ left: pct(h * 60) }}>
            {h % 2 === 0 && <em>{h}h</em>}
          </span>
        ))}
        {model.segments.map((s) => (
          <button
            key={s.id}
            className={`wk-ruler-seg ${s.running ? 'is-running' : ''}`}
            style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})`, ...coStyle(co(s.companyId)) }}
            onClick={() => openItemFrom(s.itemId, document.querySelector<HTMLElement>(`[data-card="${s.itemId}"]`))}
            title={`${hhmm(s.start)}–${hhmm(s.end)}`}
            aria-label={`Tempo de ${hhmm(s.start)} a ${hhmm(s.end)}`}
          />
        ))}
        <span className="wk-ruler-past" style={{ width: pct(model.nowMin) }} aria-hidden="true" />
        <span className="wk-ruler-now" style={{ left: pct(model.nowMin) }}>
          <em>{hhmm(model.nowMin)}</em>
        </span>
        {model.pins.map((p) => (
          <button
            key={p.id}
            className={`wk-ruler-pin is-${p.kind} ${p.done ? 'is-done' : ''} ${p.minute! < model.nowMin && !p.done ? 'is-due' : ''}`}
            style={{ left: pct(p.minute!), ...coStyle(co(p.companyId)) }}
            onClick={() => open(p)}
            aria-label={`${hhmm(p.minute!)} ${p.title}`}
          >
            {p.done ? <Icon name="check" size={10} /> : <Icon name="alarm" size={10} />}
            <span className="wk-ruler-tip">
              <b>{hhmm(p.minute!)}</b> {p.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
