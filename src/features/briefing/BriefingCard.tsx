import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openExternal } from '../../shared/openExternal'
import { areaCounts, estimateSeconds } from './assemble.ts'
import { direction, fmtChange, fmtValue } from './market.ts'
import { ensureToday, prepare, useBriefing, vote, type BriefState } from './store.ts'
import { AREA_LABEL, type BriefItem, type Edition } from './types.ts'
import {
  AreaDot, IconCards, IconCheck, IconChevron, IconExternal, IconMore, IconPlay, IconRedo, IconStar, IconUser, VoiceOrb,
  useOutside,
} from './ui.tsx'
import './briefing.css'

const Presentation = lazy(() => import('./Presentation.tsx'))
const Triage = lazy(() => import('./Triage.tsx'))
const ProfileSheet = lazy(() => import('./ProfileSheet.tsx'))

type Overlay = { kind: 'show'; listen: boolean; startKey?: string } | { kind: 'triage' } | { kind: 'profile' } | null

const SHORT_DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function BriefingCard() {
  const st = useBriefing()
  const [overlay, setOverlay] = useState<Overlay>(null)
  useEffect(() => {
    void ensureToday()
  }, [])
  useEffect(() => {
    const onFocus = () => void ensureToday()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const busy = st.phase === 'checking' || st.phase === 'waiting' || st.phase === 'collecting' || st.phase === 'judging' || st.phase === 'assembling'
  const edition = st.edition
  const showPreparing = busy && (st.phase !== 'checking' || !edition)

  return (
    <>
      <section className={`panel brf-card reveal ${showPreparing ? 'is-preparing' : ''}`} style={{ ['--i' as string]: 2 }} aria-label="Briefing do dia" aria-busy={busy}>
        {showPreparing ? (
          <Preparing st={st} />
        ) : st.phase === 'error' || !edition ? (
          <Failed message={st.error} />
        ) : (
          <Ready edition={edition} st={st} open={setOverlay} />
        )}
      </section>
      {overlay &&
        edition &&
        createPortal(
          <Suspense fallback={<div className="brf-overlay-loading" />}>
            {overlay.kind === 'show' && (
              <Presentation edition={edition} listen={overlay.listen} startKey={overlay.startKey} onClose={() => setOverlay(null)} onTriage={() => setOverlay({ kind: 'triage' })} />
            )}
            {overlay.kind === 'triage' && <Triage edition={edition} onClose={() => setOverlay(null)} onProfile={() => setOverlay({ kind: 'profile' })} />}
            {overlay.kind === 'profile' && <ProfileSheet onClose={() => setOverlay(null)} />}
          </Suspense>,
          document.body,
        )}
    </>
  )
}

const STEPS = ['Buscando notícias', 'O juiz está lendo', 'Montando']

function useTick(ms: number, on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms, on])
}

function Preparing({ st }: { st: BriefState }) {
  const p = st.progress
  useTick(500, true)
  const step = st.phase === 'judging' ? 1 : st.phase === 'assembling' ? 2 : 0
  const fetchFrac = p.total ? p.done / p.total : 0
  const judgeFrac = p.judgeStartedAt ? Math.min(0.97, (Date.now() - p.judgeStartedAt) / p.judgeExpectedMs) : 0
  const frac = step === 0 ? fetchFrac * 0.45 : step === 1 ? 0.45 + judgeFrac * 0.47 : 0.96
  const elapsed = Math.round((Date.now() - p.startedAt) / 1000)
  const detail =
    st.phase === 'waiting'
      ? 'Já está sendo preparado em outra janela…'
      : st.phase === 'checking'
        ? 'Conferindo o de hoje…'
        : step === 0
          ? p.total
            ? `${p.done} de ${p.total} fontes${p.current ? ` · ${p.current}` : ''}`
            : 'Separando as fontes…'
          : step === 1
            ? `${p.current} · uns ${Math.max(5, Math.round((p.judgeExpectedMs - (Date.now() - (p.judgeStartedAt ?? Date.now()))) / 1000))} s`
            : 'Ordenando as telas e a narração…'
  return (
    <div className="brf-prep">
      <VoiceOrb size={72} thinking className="brf-card-orb" />
      <div className="brf-prep-body">
        <div className="kicker">Briefing do dia</div>
        <h2 className="brf-card-title display">Preparando seu briefing…</h2>
        <ol className="brf-steps" aria-label="Etapas">
          {STEPS.map((label, i) => (
            <li key={label} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
              <span className="brf-step-mark">{i < step ? <IconCheck /> : <i />}</span>
              {label}
            </li>
          ))}
        </ol>
        <div className="brf-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
          <span style={{ transform: `scaleX(${Math.max(0.02, frac)})` }} />
        </div>
        <p className="brf-prep-detail">
          <span>{detail}</span>
          <span className="brf-muted">{elapsed > 2 ? `${elapsed} s` : ''}</span>
        </p>
      </div>
    </div>
  )
}

function Failed({ message }: { message: string | null }) {
  const [trying, setTrying] = useState(false)
  return (
    <div className="brf-failed">
      <VoiceOrb size={64} className="brf-card-orb is-dim" />
      <div>
        <div className="kicker">Briefing do dia</div>
        <h2 className="brf-card-title display">Não deu para preparar o briefing</h2>
        <p className="brf-muted">{message ?? 'Algo deu errado no preparo.'}</p>
      </div>
      <button
        className="btn primary"
        disabled={trying}
        onClick={() => {
          setTrying(true)
          void prepare(false).finally(() => setTrying(false))
        }}
      >
        <IconRedo /> Tentar de novo
      </button>
    </div>
  )
}

function Ready({ edition, st, open }: { edition: Edition; st: BriefState; open: (o: Overlay) => void }) {
  const [menu, setMenu] = useState(false)
  const [left, setLeft] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const leftBtn = useRef<HTMLButtonElement>(null)
  useOutside(menu, () => setMenu(false), menuRef)
  useOutside(left, () => setLeft(false), leftRef, leftBtn)
  const wpm = st.profile?.voice.rate ?? 185
  const minutes = Math.max(1, Math.round(estimateSeconds(edition, wpm) / 60))
  const n = edition.items.length
  const counts = useMemo(() => areaCounts(edition.items), [edition])
  const date = new Date(`${edition.date}T12:00:00`)
  const interested = edition.leftOut.filter((i) => st.votes.get(i.key)?.signal === 'interest').length
  return (
    <>
      <div className="brf-hero">
        <div className="brf-aurora" aria-hidden="true">
          {counts.slice(0, 3).map((c, i) => (
            <i key={c.area} className={`brf-a-${c.area}`} style={{ ['--k' as string]: i }} />
          ))}
        </div>
        <div className="brf-hero-side">
          <button className="brf-orb-btn is-hero" onClick={() => open({ kind: 'show', listen: true })} aria-label="Ouvir o briefing" title="Ouvir">
            <VoiceOrb size={132} className="brf-card-orb" />
            <span className="brf-orb-play">
              <IconPlay size={16} />
            </span>
          </button>
          <button className="brf-listen" onClick={() => open({ kind: 'show', listen: true })}>
            <IconPlay size={11} /> Ouvir · {minutes} min
          </button>
        </div>
        <div className="brf-hero-body">
          <div className="brf-kicker-row">
            <span className="kicker">Briefing do dia · {SHORT_DAY.format(date).replace(/\./g, '')}</span>
            {edition.judge === 'fallback' && (
              <span className="brf-note" title={edition.judgeNote ? `Feito sem o juiz: ${edition.judgeNote}.` : 'Feito sem o juiz.'}>
                feito sem o juiz hoje
              </span>
            )}
            {st.redoError && (
              <span className="brf-note is-warn" title={st.redoError}>
                não deu para refazer
              </span>
            )}
            <div className="brf-menu-wrap" ref={menuRef}>
              <button className="btn quiet brf-icon-btn" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} aria-label="Mais opções">
                <IconMore />
              </button>
              {menu && (
                <div className="brf-menu" role="menu">
                  <button role="menuitem" onClick={() => (setMenu(false), open({ kind: 'triage' }))}>
                    <IconCards /> Triagem rápida
                  </button>
                  <button role="menuitem" onClick={() => (setMenu(false), open({ kind: 'profile' }))}>
                    <IconUser /> Meu perfil
                  </button>
                  <button role="menuitem" onClick={() => (setMenu(false), void prepare(true))}>
                    <IconRedo /> Refazer o briefing de hoje
                  </button>
                  <div className="brf-menu-foot">
                    {edition.judge === 'codex' ? `Juiz: Codex${edition.model ? ` (${edition.model})` : ''}` : `Sem o juiz${edition.judgeNote ? `: ${edition.judgeNote}` : ''}`}
                    <br />
                    {edition.stats.sourcesOk} de {edition.stats.sources} fontes · {edition.stats.entries} notícias lidas
                  </div>
                </div>
              )}
            </div>
          </div>
          <h2 className="brf-hero-title display">
            {n === 0 ? (
              'Nada passou na peneira desde ontem'
            ) : (
              <>
                <span className="brf-hero-n">{n}</span> {n === 1 ? 'coisa que importa' : 'coisas que importam'} <em>desde ontem</em>
              </>
            )}
          </h2>
          {n > 0 && (
            <ol className="brf-heads">
              {edition.items.slice(0, 3).map((it, i) => (
                <li key={it.key} className={`brf-a-${it.area}`} style={{ ['--i' as string]: i }}>
                  <button onClick={() => open({ kind: 'show', listen: false, startKey: it.key })}>
                    <span className="brf-head-n">{String(i + 1).padStart(2, '0')}</span>
                    <span className="brf-head-text">
                      <span className="brf-head-title">{it.title}</span>
                      <span className="brf-head-meta">
                        <i className="brf-head-dot" /> {AREA_LABEL[it.area]} · {it.source}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="brf-hero-actions">
            {n > 3 && <span className="brf-more">+ {n - 3} na apresentação</span>}
            <button className="btn" onClick={() => open({ kind: 'show', listen: false })}>
              Ver tudo
            </button>
          </div>
        </div>
      </div>
      <div className="brf-foot">
        <MarketStrip edition={edition} />
        {edition.leftOut.length > 0 && (
          <button ref={leftBtn} className={`brf-left-toggle ${left ? 'is-open' : ''}`} onClick={() => setLeft((v) => !v)} aria-expanded={left}>
            O que ficou de fora hoje <b>{edition.leftOut.length}</b>
            {interested > 0 && <span className="brf-left-star"><IconStar on /> {interested}</span>}
            <IconChevron open={left} />
          </button>
        )}
      </div>
      {left && (
        <div className="brf-left" ref={leftRef}>
          <LeftOut edition={edition} st={st} onTriage={() => (setLeft(false), open({ kind: 'triage' }))} />
        </div>
      )}
    </>
  )
}

function MarketStrip({ edition }: { edition: Edition }) {
  if (!edition.market.length) return <div className="brf-ticker is-empty">Sem cotações hoje</div>
  const at = edition.marketAt ? TIME.format(new Date(edition.marketAt)) : null
  return (
    <div className="brf-ticker" title={at ? `Cotações das ${at}` : undefined}>
      {edition.market.map((q) => {
        const d = direction(q.changePct)
        return (
          <span key={q.id} className="brf-tick">
            <span className="brf-tick-label">{q.label}</span>
            <span className="brf-tick-value">{fmtValue(q)}</span>
            {q.changePct !== null && <span className={`brf-delta is-${d}`}>{fmtChange(q.changePct)}</span>}
          </span>
        )
      })}
      {at && <span className="brf-tick-at">às {at}</span>}
    </div>
  )
}

function LeftOut({ edition, st, onTriage }: { edition: Edition; st: BriefState; onTriage: () => void }) {
  return (
    <>
      <header className="brf-left-head">
        <div>
          <h3>O que ficou de fora</h3>
          <p className="brf-muted">Marque o que te interessa: é o sinal mais forte para os próximos dias.</p>
        </div>
        <button className="btn sm" onClick={onTriage}>
          <IconCards /> Triagem rápida
        </button>
      </header>
      <ul className="brf-left-list">
        {edition.leftOut.map((it) => (
          <LeftRow key={it.key} item={it} on={st.votes.get(it.key)?.signal === 'interest'} />
        ))}
      </ul>
    </>
  )
}

function LeftRow({ item, on }: { item: BriefItem; on: boolean }) {
  return (
    <li className={`brf-left-row ${on ? 'is-on' : ''}`}>
      <AreaDot area={item.area} />
      <div className="brf-left-text">
        <span className="brf-left-title">{item.title}</span>
        <span className="brf-left-meta">
          {AREA_LABEL[item.area]} · {item.source}
          {item.reason ? ` · ${item.reason}` : ''}
        </span>
      </div>
      <button className={`brf-interest ${on ? 'is-on' : ''}`} onClick={() => void vote(item, 'interest', 'left_out', null, false)} aria-pressed={on}>
        <IconStar on={on} /> {on ? 'te interessa' : 'isso me interessa'}
      </button>
      <button className="brf-icon-link" onClick={() => void openExternal(item.url)} title="Abrir o original" aria-label={`Abrir o original de ${item.title}`}>
        <IconExternal />
      </button>
    </li>
  )
}
