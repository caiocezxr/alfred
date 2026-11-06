import { useEffect, useState } from 'react'
import { civil } from '../../shared/dates'
import { MOODS, type Mood } from './api'
import { patchToday, useToday } from './store'
import './mood.css'

const REPLIES = [
  'Agora sim. O dia começou.',
  'Café 14 na mão, código no ponto.',
  'Boa. Hoje rende.',
  'Combustível no tanque, chefe.',
  'Perfeito. Bora pra cima.',
  'Esse é o espírito.',
]

const pickReply = (date: string) => REPLIES[Math.abs([...date].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % REPLIES.length]

export function Face({ level, size = 22 }: { level: Mood; size?: number }) {
  const mouth: Record<Mood, string> = {
    1: 'M7 15.2 Q10 11.6 13 15.2',
    2: 'M7.4 14.6 Q10 13.2 12.6 14.6',
    3: 'M7.4 13.8 H12.6',
    4: 'M7.2 12.6 Q10 15.6 12.8 12.6',
    5: 'M6.8 12 Q10 17.4 13.2 12 Z',
  }
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="7.3" cy="8.2" r="1" fill="currentColor" />
      <circle cx="12.7" cy="8.2" r="1" fill="currentColor" />
      <path d={mouth[level]} fill={level === 5 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const CoffeeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6.5h8v3.3a3.2 3.2 0 0 1-3.2 3.2H6.2A3.2 3.2 0 0 1 3 9.8z" />
    <path d="M11 7.5h1.1a1.6 1.6 0 0 1 0 3.2H11" />
    <path className="ck-steam" d="M5.5 4.6c0-.9.8-.9.8-1.8M8.2 4.6c0-.9.8-.9.8-1.8" />
  </svg>
)

export function CheckIn({ onOpenYear, index = 1 }: { onOpenYear: () => void; index?: number }) {
  const { today } = useToday()
  const date = civil()
  const hour = new Date().getHours()
  const morning = hour >= 5 && hour < 13
  const [note, setNote] = useState(today?.note ?? '')
  const [justNow, setJustNow] = useState(false)

  useEffect(() => setNote(today?.note ?? ''), [today?.note])

  const mood = today?.mood ?? null
  const label = mood ? MOODS[mood - 1].label : null
  const saveNote = () => {
    if ((today?.note ?? '') !== note.trim()) void patchToday({ note })
  }

  return (
    <div className="ck reveal" style={{ ['--i' as string]: index }}>
      {morning && (
        <div className={`ck-row ck-coffee ${today?.coffee ? 'is-done' : ''}`}>
          <span className="ck-ico">
            <CoffeeIcon />
          </span>
          {today?.coffee ? (
            <span className={`ck-q ${justNow ? 'is-new' : ''}`}>{pickReply(date)}</span>
          ) : (
            <>
              <span className="ck-q">{today?.coffee === false ? 'Vai lá pegar o café 14, eu espero.' : 'Já pegou o café intensidade 14?'}</span>
              <button
                className="ck-btn is-yes"
                onClick={() => {
                  setJustNow(true)
                  void patchToday({ coffee: true })
                }}
              >
                Já peguei
              </button>
              {today?.coffee !== false && (
                <button className="ck-btn" onClick={() => void patchToday({ coffee: false })}>
                  Ainda não
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="ck-row ck-mood">
        <span className="ck-q">{label ? <>Hoje você está <b style={{ color: MOODS[mood! - 1].color }}>{label.toLowerCase()}</b></> : 'Como você está hoje?'}</span>
        <div className="ck-faces" role="radiogroup" aria-label="Humor de hoje">
          {MOODS.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mood === m.id}
              className={`ck-face ${mood === m.id ? 'is-on' : ''} ${mood && mood !== m.id ? 'is-dim' : ''}`}
              style={{ ['--mc' as string]: m.color }}
              onClick={() => void patchToday({ mood: mood === m.id ? null : m.id })}
              title={m.label}
              aria-label={m.label}
            >
              <Face level={m.id} />
            </button>
          ))}
        </div>
        <button className="ck-link" onClick={onOpenYear}>
          seu ano
        </button>
      </div>

      {mood && (
        <input
          className="ck-note"
          value={note}
          maxLength={280}
          placeholder="Uma linha sobre o dia (opcional)"
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              saveNote()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          aria-label="Nota do dia"
        />
      )}
    </div>
  )
}

export function MoodChip({ onOpen, onOpenYear }: { onOpen: () => void; onOpenYear: () => void }) {
  const { today } = useToday()
  const mood = today?.mood ?? null
  const m = mood ? MOODS[mood - 1] : null
  return (
    <div className="mchip reveal" style={{ ['--i' as string]: 1 }}>
      <button className="mchip-main" onClick={onOpen} style={m ? { ['--mc' as string]: m.color } : undefined} title="Mudar humor de hoje">
        {m ? (
          <>
            <span className="mchip-face">
              <Face level={m.id} size={16} />
            </span>
            {m.label}
          </>
        ) : (
          'Como você está?'
        )}
        {today?.coffee && (
          <span className="mchip-coffee" title="Café 14 tomado">
            <CoffeeIcon />
          </span>
        )}
      </button>
      <button className="mchip-year" onClick={onOpenYear}>
        seu ano
      </button>
    </div>
  )
}
