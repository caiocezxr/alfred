import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { compareRef, globalFraction, type Bible, type VerseRef } from '../data/bible'
import { readingRange } from '../data/readingPlan'
import { dailyStore, today } from '../data/stores'

const WPM = 180

function streakOf(dates: Set<string>) {
  const d = new Date()
  if (!dates.has(today(d))) d.setDate(d.getDate() - 1)
  let n = 0
  while (dates.has(today(d))) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

export function ReadingMeter({ bible, first, last, visible }: { bible: Bible; first: VerseRef | null; last: VerseRef | null; visible: boolean }) {
  const s = useSyncExternalStore(dailyStore.subscribe, dailyStore.get)
  const day = today()
  const doneToday = s.log.some((l) => l.date === day && !l.extra)
  const range = useMemo(() => readingRange(bible, s.cursor, s.goal.unit, s.goal.amount), [bible, s.cursor, s.goal])
  const streak = useMemo(() => streakOf(new Set(s.log.map((l) => l.date))), [s.log])
  const [moment, setMoment] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  const chapter = useMemo(() => {
    if (!first || !last) return null
    const verses = bible.books[last.book].chapters[last.chapter]
    let left = 0
    for (let v = last.verse + 1; v < verses.length; v++) left += verses[v].split(' ').length
    return {
      name: `${bible.books[last.book].name} ${last.chapter + 1}`,
      progress: (last.verse + 1) / verses.length,
      minutes: Math.ceil(left / WPM),
    }
  }, [bible, first, last])

  const goal = useMemo(() => {
    if (doneToday) return 1
    if (!last || !first || compareRef(first, range.to) > 0) return 0
    const n = bible.counts.verses
    const a = globalFraction(bible, range.from) * n
    const b = globalFraction(bible, range.to) * n + 1
    const c = globalFraction(bible, last) * n + 1
    return Math.max(0, Math.min(1, (c - a) / Math.max(1, b - a)))
  }, [bible, doneToday, first, last, range])

  const reached = !doneToday && !!first && !!last && compareRef(first, range.to) <= 0 && compareRef(last, range.to) >= 0
  const conclude = () => {
    const st = dailyStore.get()
    dailyStore.set({ ...st, log: [...st.log, { date: day, from: range.from, to: range.to }], cursor: range.next ?? st.cursor })
    setMoment(true)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMoment(false), 3600)
  }

  if (!chapter) return null
  const R = 9
  const L = 2 * Math.PI * R
  return (
    <div className={`reading-meter ${visible ? '' : 'is-hidden'} ${doneToday ? 'is-done' : ''} ${moment ? 'is-moment' : ''}`}>
      <span className="meter-ring" title={doneToday ? 'Meta de hoje concluída' : `Meta de hoje: ${Math.round(goal * 100)}%`}>
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r={R} className="ring-track" />
          <circle cx="12" cy="12" r={R} className="ring-fill" style={{ strokeDasharray: L, strokeDashoffset: L * (1 - goal) }} />
        </svg>
      </span>
      <span className="meter-text">
        <span className="meter-chapter">
          {chapter.name}
          <i className="meter-bar"><b style={{ transform: `scaleX(${chapter.progress})` }} /></i>
        </span>
        <span className="meter-sub">
          {moment
            ? streak > 1 ? `Leitura de hoje concluída · ${streak} dias seguidos` : 'Leitura de hoje concluída'
            : chapter.progress >= 1 ? 'Fim do capítulo' : chapter.minutes <= 1 ? 'Menos de 1 min para o fim do capítulo' : `≈ ${chapter.minutes} min para o fim do capítulo`}
          {!moment && streak > 1 && <span className="meter-streak"> · {streak} dias seguidos</span>}
        </span>
      </span>
      {reached && (
        <button className="meter-done" onClick={conclude}>
          Concluir a leitura de hoje
        </button>
      )}
    </div>
  )
}
