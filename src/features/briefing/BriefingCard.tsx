import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openExternal } from '../../shared/openExternal'
import { Dossie } from './Dossie.tsx'
import { useCardPresence } from './MiniPlayer.tsx'
import { briefingPlayer, rateOfSpeed, speedOfRate, useBriefingPlayer, type PlayerState } from './player.ts'
import { ensureFloatingMiniPlayer } from './MiniPlayer.tsx'
import { estimateSeconds } from './assemble.ts'
import { cadernoLeads } from './dossie.ts'
import { localModelLabel } from './profile.ts'
import { ensureToday, prepare, retryToday, useBriefing, type BriefState } from './store.ts'
import { AREA_LABEL, type BriefItem, type Edition } from './types.ts'
import {
  AreaDot, IconCards, IconCheck, Interest, IconExternal, IconMore, IconRedo, IconUser,
  useOutside, Wave,
} from './ui.tsx'
import './briefing.css'

const Presentation = lazy(() => import('./Presentation.tsx'))
const Triage = lazy(() => import('./Triage.tsx'))
const ProfileSheet = lazy(() => import('./ProfileSheet.tsx'))

type Overlay = { kind: 'show'; listen: boolean; startKey?: string } | { kind: 'triage' } | { kind: 'profile' } | { kind: 'left' } | { kind: 'dossie' } | null


export default function BriefingCard() {
  const st = useBriefing()
  const [overlay, setOverlay] = useState<Overlay>(null)
  useEffect(() => {
    if (st.phase === 'idle') void ensureToday()
  }, [st.phase])
  useEffect(() => {
    const onFocus = () => void ensureToday()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const edition = st.edition
  const voice = st.profile?.voice
  useEffect(() => {
    if (edition && st.phase === 'ready' && edition.items.length) briefingPlayer.prepare(edition, voice?.voice ?? 'pf_dora')
  }, [edition, st.phase, voice?.voice])
  useEffect(() => {
    if (voice) briefingPlayer.setSpeed(speedOfRate(voice.rate))
  }, [voice])
  useEffect(() => {
    const open = () => edition && setOverlay({ kind: 'show', listen: true })
    window.addEventListener('briefing:open', open)
    return () => window.removeEventListener('briefing:open', open)
  }, [edition])

  const busy = st.phase === 'checking' || st.phase === 'waiting' || st.phase === 'collecting' || st.phase === 'judging' || st.phase === 'assembling'
  const showPreparing = busy && (st.phase !== 'checking' || !edition)

  return (
    <>
      <section className={`panel brf-card reveal ${showPreparing ? 'is-preparing' : ''}`} style={{ ['--i' as string]: 2 }} aria-label="Briefing do dia" aria-busy={busy}>
        {showPreparing ? (
          <Preparing st={st} />
        ) : st.phase === 'idle' && !edition ? (
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
            {overlay.kind === 'dossie' && (
              <div className="dz-full-scrim">
                <Dossie edition={edition} st={st} mode="full" onClose={() => setOverlay(null)} />
              </div>
            )}
            {overlay.kind === 'left' && <LeftSheet edition={edition} st={st} onClose={() => setOverlay(null)} onTriage={() => setOverlay({ kind: 'triage' })} />}
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
      : st.phase === 'checking' || st.phase === 'idle'
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
      <Wave size="lg" live />
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
      <Wave size="lg" />
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
          void retryToday().finally(() => setTrying(false))
        }}
      >
        <IconRedo /> Tentar de novo
      </button>
    </div>
  )
}

const listening = (p: PlayerState, e: Edition) => p.date === e.date && (p.status === 'playing' || p.status === 'loading' || p.status === 'paused')

function judgeLabel(e: Edition) {
  const parts = [e.judge === 'codex' ? `Juiz: Codex${e.model ? ` (${e.model})` : ''}` : `Sem o juiz${e.judgeNote ? `: ${e.judgeNote}` : ''}`]
  if (e.translatedBy) parts.push(`Tradução local: ${localModelLabel(e.translatedBy)}`)
  if (e.taste) parts.push(`Gosto pessoal: ${e.taste.positives + e.taste.negatives} sinais (${e.taste.method})`)
  return parts.join(' · ')
}

function Ready({ edition, st, open }: { edition: Edition; st: BriefState; open: (o: Overlay) => void }) {
  const [menu, setMenu] = useState(false)
  const [card, setCard] = useState<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const player = useBriefingPlayer()
  useOutside(menu, () => setMenu(false), menuRef)
  useCardPresence(card)
  const on = listening(player, edition)

  const speed = speedOfRate(st.profile?.voice.rate ?? 185)
  const minutes = Math.max(1, Math.round(estimateSeconds(edition, rateOfSpeed(speed)) / 60))
  const tops = cadernoLeads(edition)
  const playing = on && player.status !== 'paused'
  const listen = () => {
    ensureFloatingMiniPlayer()
    if (on) briefingPlayer.toggle()
    else briefingPlayer.play(edition, { resume: player.resume?.date === edition.date, voice: st.profile?.voice.voice ?? 'pf_dora', speed })
  }
  const menuEl = (
          <div className="brf-menu-wrap" ref={menuRef}>
            <button className="dz-icon" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} aria-label="Mais opções">
              <IconMore />
            </button>
            {menu && (
              <div className="brf-menu" role="menu">
                <button role="menuitem" onClick={() => (setMenu(false), open({ kind: 'show', listen: on }))}>
                  <IconCards /> Apresentação em tela cheia
                </button>
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
                  {judgeLabel(edition)}
                  <br />
                  {edition.stats.sourcesOk} de {edition.stats.sources} fontes · {edition.stats.entries} notícias lidas
                  {st.redoError ? (
                    <>
                      <br />
                      Não deu para refazer: {st.redoError}
                    </>
                  ) : null}
                  {player.voice.phase === 'ready' && player.prepared < player.total ? (
                    <>
                      <br />
                      Voz: {player.prepared} de {player.total} frases prontas
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
  )

  return (
    <div className="bc" ref={setCard}>
      <header className="bc-head">
        <span className="bc-k">Briefing do dia</span>
        <span className="bc-meta">
          {edition.items.length} notícias · {minutes} min
        </span>
        {menuEl}
      </header>
      <p className="bc-open">{edition.opening}</p>
      <ol className="bc-tops">
        {tops.map(({ caderno, item }) => (
          <li key={item.key} data-c={caderno}>
            <button onClick={() => open({ kind: 'dossie' })}>
              <i aria-hidden="true" />
              <span>{item.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <footer className="bc-foot">
        <button className={`bc-play ${playing ? 'is-on' : ''}`} onClick={listen}>
          {playing ? (
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
              <path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
              <path d="M3 2v8l7-4z" fill="currentColor" />
            </svg>
          )}
          {playing ? 'Pausar' : on || player.resume?.date === edition.date ? 'Continuar' : `Ouvir · ${minutes} min`}
        </button>
        <button className="bc-read" onClick={() => open({ kind: 'dossie' })}>
          Ler o dossiê
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="M2 6h7.5M6.5 3 9.5 6 6.5 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </footer>
    </div>
  )
}

function LeftSheet({ edition, st, onClose, onTriage }: { edition: Edition; st: BriefState; onClose: () => void; onTriage: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="bx-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="bx-sheet" role="dialog" aria-modal="true" aria-label="O que ficou de fora">
        <LeftOut edition={edition} st={st} onTriage={onTriage} onClose={onClose} />
      </aside>
    </div>
  )
}

function LeftOut({ edition, st, onTriage, onClose }: { edition: Edition; st: BriefState; onTriage: () => void; onClose: () => void }) {
  return (
    <>
      <header className="brf-left-head">
        <div>
          <h3 className="display">O que ficou de fora</h3>
          <p className="brf-muted">Marque o que te interessa: é o sinal mais forte para os próximos dias.</p>
        </div>
        <button className="btn sm" onClick={onTriage}>
          <IconCards /> Triagem rápida
        </button>
        <button className="btn quiet brf-icon-btn" onClick={onClose} aria-label="Fechar">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
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
      <Interest item={item} origin="left_out" kept={false} variant="row" />
      <button className="brf-icon-link" onClick={() => void openExternal(item.url)} title="Abrir o original" aria-label={`Abrir o original de ${item.title}`}>
        <IconExternal />
      </button>
    </li>
  )
}
