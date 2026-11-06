import { useEffect, useMemo, useState } from 'react'
import { briefingApi } from './api.ts'
import { learn, type Learned } from './learn.ts'
import { ensureProfile, loadRatings, undoRating, updateProfile, useBriefing } from './store.ts'
import { historyLine } from './rating.ts'
import { AREA_LABEL, AREA_LONG, AREAS, REASON_LABEL, type BriefSource, type CodexStatus, type Feedback, type Profile } from './types.ts'
import { AreaDot, IconClose, IconPlay, VoiceOrb } from './ui.tsx'
import { listVoices, narrator } from './voice.ts'
import { rateOfSpeed, SPEEDS, speedOfRate, useBriefingPlayer, voiceProgressLabel } from './player.ts'
import { localModelLabel } from './profile.ts'

type Props = { onClose: () => void }

export default function ProfileSheet({ onClose }: Props) {
  const { profile } = useBriefing()
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [sources, setSources] = useState<BriefSource[]>([])
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([])
  const [saved, setSaved] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void ensureProfile().catch(() => {})
    void briefingApi.feedbackList(1000).then(setFeedback).catch(() => {})
    void briefingApi.sources().then(setSources).catch(() => {})
    void briefingApi.codexStatus().then(setCodex).catch(() => {})
    void listVoices().then(setVoices)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      narrator.stopSample()
    }
  }, [onClose])

  const learned = useMemo(() => learn(feedback, Date.now()), [feedback])

  const change = (fn: (p: Profile) => Profile, delay = 500) => {
    setSaved('saving')
    setError(null)
    updateProfile(fn, delay)
      .then(() => setSaved('ok'))
      .catch((e: unknown) => {
        setSaved('error')
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  return (
    <div className="brf-scrim is-side" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="brf-sheet" role="dialog" aria-modal="true" aria-label="Meu perfil do briefing">
        <header className="brf-sheet-head">
          <div>
            <div className="kicker">Briefing do dia</div>
            <h2 className="display">Meu perfil</h2>
          </div>
          <span className={`brf-save is-${saved}`}>{saved === 'saving' ? 'salvando…' : saved === 'ok' ? 'salvo' : saved === 'error' ? 'não salvou' : ''}</span>
          <button className="brf-round" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </header>
        {error && <p className="brf-sheet-error">{error}</p>}
        {!profile ? (
          <p className="brf-muted brf-sheet-pad">Carregando…</p>
        ) : (
          <div className="brf-sheet-body">
            <Learning learned={learned} feedback={feedback} profile={profile} change={change} />
            <Areas profile={profile} change={change} />
            <Terms profile={profile} change={change} />
            <section className="brf-sec">
              <h3>Sobre você</h3>
              <p className="brf-muted">Vai para o juiz junto com as áreas. Escreva do seu jeito.</p>
              <textarea className="field" rows={3} value={profile.about} maxLength={800} onChange={(e) => change((p) => ({ ...p, about: e.target.value }), 900)} />
            </section>
            <Sources profile={profile} sources={sources} setSources={setSources} change={change} />
            <History />
            <JudgeAndVoice profile={profile} codex={codex} voices={voices} change={change} refreshCodex={() => void briefingApi.codexStatus().then(setCodex)} />
          </div>
        )}
      </aside>
    </div>
  )
}

type Change = (fn: (p: Profile) => Profile, delay?: number) => void

function Bar({ value, max = 2 }: { value: number; max?: number }) {
  const pct = Math.min(1, Math.abs(value) / max) * 50
  return (
    <span className="brf-lbar" aria-hidden="true">
      <i className={value >= 0 ? 'is-pos' : 'is-neg'} style={{ width: `${pct}%`, [value >= 0 ? 'left' : 'right']: '50%' }} />
    </span>
  )
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`

function Learning({ learned, feedback, profile, change }: { learned: Learned; feedback: Feedback[]; profile: Profile; change: Change }) {
  const sources = [...learned.source.entries()].sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value)).slice(0, 8)
  const pin = (term: string, list: 'likes' | 'ignores') =>
    change((p) => ({ ...p, [list]: [...new Set([...p[list], term])], [list === 'likes' ? 'ignores' : 'likes']: p[list === 'likes' ? 'ignores' : 'likes'].filter((t) => t !== term) }), 0)
  return (
    <section className="brf-sec">
      <div className="brf-sec-head">
        <h3>O que aprendi com você</h3>
        <label className="brf-switch">
          <input type="checkbox" checked={profile.learning} onChange={(e) => change((p) => ({ ...p, learning: e.target.checked }), 0)} />
          <span /> usar o aprendizado
        </label>
      </div>
      {learned.total === 0 ? (
        <p className="brf-muted">Ainda nada. Use “gostei” e “não agregou” nas telas, a triagem rápida ou “isso me interessa” no que ficou de fora.</p>
      ) : (
        <>
          <p className="brf-muted">
            {learned.total} sinais. Cada um perde metade do peso em 45 dias; o que você ajusta abaixo vale mais que o aprendido.
          </p>
          <div className="brf-learn-grid">
            {AREAS.map((a) => (
              <div key={a} className="brf-learn-row">
                <AreaDot area={a} />
                <span>{AREA_LABEL[a]}</span>
                <Bar value={learned.area[a]} />
                <b>{signed(learned.area[a])}</b>
              </div>
            ))}
          </div>
          {sources.length > 0 && (
            <>
              <h4>Fontes</h4>
              <div className="brf-learn-grid">
                {sources.map(([id, s]) => (
                  <div key={id} className="brf-learn-row">
                    <span className="brf-learn-name">{s.name || id}</span>
                    <Bar value={s.value} />
                    <b>{signed(s.value)}</b>
                  </div>
                ))}
              </div>
            </>
          )}
          {learned.terms.length > 0 && (
            <>
              <h4>Termos</h4>
              <div className="brf-terms">
                {learned.terms.slice(0, 24).map((t) => (
                  <span key={t.term} className={`brf-term ${t.value >= 0 ? 'is-pos' : 'is-neg'}`}>
                    {t.term} <em>{signed(t.value)}</em>
                    <button onClick={() => pin(t.term, 'likes')} title="Sempre curtir">
                      +
                    </button>
                    <button onClick={() => pin(t.term, 'ignores')} title="Sempre ignorar">
                      −
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
          <h4>Últimos sinais</h4>
          <ul className="brf-recent">
            {feedback.slice(0, 6).map((f) => (
              <li key={f.id}>
                <span className={`brf-sig is-${f.signal}`}>{f.signal === 'interest' ? 'interessa' : f.signal === 'up' ? 'curtiu' : 'não agregou'}</span>
                <span className="brf-recent-title">{f.title}</span>
                {f.reason && <em>{REASON_LABEL[f.reason]}</em>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

const WEIGHT_LABEL = (w: number) => (w === 0 ? 'quase nada' : w < 0.75 ? 'menos' : w <= 1.25 ? 'normal' : w < 1.75 ? 'mais' : 'prioridade')

function Areas({ profile, change }: { profile: Profile; change: Change }) {
  return (
    <section className="brf-sec">
      <h3>Áreas</h3>
      <div className="brf-areas">
        {profile.areas.map((a) => (
          <div key={a.id} className={`brf-area ${a.enabled ? '' : 'is-off'}`}>
            <div className="brf-area-top">
              <label className="brf-switch">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  onChange={(e) => change((p) => ({ ...p, areas: p.areas.map((x) => (x.id === a.id ? { ...x, enabled: e.target.checked } : x)) }), 0)}
                />
                <span />
              </label>
              <AreaDot area={a.id} />
              <b>{AREA_LONG[a.id]}</b>
              <span className="brf-area-w">{WEIGHT_LABEL(a.weight)}</span>
            </div>
            <input
              className="brf-range"
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={a.weight}
              disabled={!a.enabled}
              aria-label={`Peso de ${AREA_LONG[a.id]}`}
              onChange={(e) => change((p) => ({ ...p, areas: p.areas.map((x) => (x.id === a.id ? { ...x, weight: Number(e.target.value) } : x)) }))}
            />
            <textarea
              className="field brf-area-note"
              rows={2}
              maxLength={300}
              value={a.note}
              disabled={!a.enabled}
              onChange={(e) => change((p) => ({ ...p, areas: p.areas.map((x) => (x.id === a.id ? { ...x, note: e.target.value } : x)) }), 900)}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function TermList({ label, hint, list, onChange }: { label: string; hint: string; list: string[]; onChange: (l: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!t || t.length > 40) return
    onChange([...new Set([...list, t])])
    setDraft('')
  }
  return (
    <div className="brf-termlist">
      <h4>{label}</h4>
      <div className="brf-terms">
        {list.map((t) => (
          <span key={t} className="brf-term">
            {t}
            <button onClick={() => onChange(list.filter((x) => x !== t))} aria-label={`Tirar ${t}`}>
              ×
            </button>
          </span>
        ))}
        <input
          className="brf-term-input"
          placeholder={hint}
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
        />
      </div>
    </div>
  )
}

function Terms({ profile, change }: { profile: Profile; change: Change }) {
  return (
    <section className="brf-sec">
      <h3>Termos</h3>
      <p className="brf-muted">Termo terminado em * casa como prefixo (ex.: agent*). Ignorados no título somem do briefing.</p>
      <TermList label="Curto" hint="ex.: tauri, claude code" list={profile.likes} onChange={(likes) => change((p) => ({ ...p, likes }), 0)} />
      <TermList label="Ignoro" hint="ex.: futebol, eleições" list={profile.ignores} onChange={(ignores) => change((p) => ({ ...p, ignores }), 0)} />
    </section>
  )
}

function Sources({ profile, sources, setSources, change }: { profile: Profile; sources: BriefSource[]; setSources: (s: BriefSource[]) => void; change: Change }) {
  const patch = async (s: BriefSource, p: { enabled?: boolean; weight?: number }) => {
    setSources(sources.map((x) => (x.id === s.id ? { ...x, ...p } : x)))
    try {
      const saved = await briefingApi.sourceUpdate(s.id, p)
      setSources(sources.map((x) => (x.id === s.id ? saved : x)))
    } catch {
      setSources(sources)
    }
  }
  return (
    <section className="brf-sec">
      <div className="brf-sec-head">
        <h3>Fontes</h3>
        <label className="brf-switch">
          <input type="checkbox" checked={profile.useRadarSources} onChange={(e) => change((p) => ({ ...p, useRadarSources: e.target.checked }), 0)} />
          <span /> usar também as do Radar
        </label>
      </div>
      {AREAS.map((a) => {
        const list = sources.filter((s) => s.area === a)
        if (!list.length) return null
        return (
          <div key={a} className="brf-src-group">
            <h4>
              <AreaDot area={a} /> {AREA_LONG[a]}
            </h4>
            {list.map((s) => (
              <div key={s.id} className={`brf-src ${s.enabled ? '' : 'is-off'}`}>
                <label className="brf-switch">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => void patch(s, { enabled: e.target.checked })} />
                  <span />
                </label>
                <span className="brf-src-name">
                  {s.name}
                  <em>{s.lang === 'pt' ? 'pt' : 'en'}</em>
                  {s.lastStatus === 'error' && (
                    <i className="brf-src-err" title={s.lastError ?? ''}>
                      falhou na última busca
                    </i>
                  )}
                </span>
                <select className="brf-select" value={s.weight >= 1.3 ? 1.5 : s.weight <= 0.7 ? 0.5 : 1} disabled={!s.enabled} onChange={(e) => void patch(s, { weight: Number(e.target.value) })} aria-label={`Peso de ${s.name}`}>
                  <option value={0.5}>menos</option>
                  <option value={1}>normal</option>
                  <option value={1.5}>mais</option>
                </select>
              </div>
            ))}
          </div>
        )
      })}
    </section>
  )
}

function JudgeAndVoice({ profile, codex, voices, change, refreshCodex }: { profile: Profile; codex: CodexStatus | null; voices: { id: string; name: string }[]; change: Change; refreshCodex: () => void }) {
  const [path, setPath] = useState(profile.codexPath ?? '')
  const [model, setModel] = useState(profile.translateModel)
  const [speaking, setSpeaking] = useState(false)
  const { voice: engine } = useBriefingPlayer()
  const v = profile.voice
  const speed = speedOfRate(v.rate)
  const sample = async () => {
    setSpeaking(true)
    await narrator.sample('Bom dia! Desde ontem, separei sete coisas que importam pra você. Vamos lá?', speed)
    setSpeaking(false)
  }
  const progress = voiceProgressLabel(engine)
  return (
    <section className="brf-sec">
      <h3>Juiz e voz</h3>
      <div className="brf-judge">
        <p>
          {codex === null ? 'Procurando o Codex…' : codex.found ? (
            <>
              Codex encontrado{codex.configured ? ' (caminho dos ajustes)' : ''}: <code>{codex.path}</code>
            </>
          ) : (
            <>Sem o Codex: {codex.error?.replace(/^\[[^\]]+\]\s*/, '')}</>
          )}
        </p>
        <div className="brf-field-row">
          <input
            className="field"
            placeholder="Caminho do Codex (vazio = encontrar sozinho)"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onBlur={() => change((p) => ({ ...p, codexPath: path.trim() || null }), 0)}
            spellCheck={false}
          />
          <button className="btn" onClick={() => (change((p) => ({ ...p, codexPath: path.trim() || null }), 0), setTimeout(refreshCodex, 400))}>
            Conferir
          </button>
        </div>
        <label className="brf-inline">
          Cuidado do juiz
          <select className="brf-select" value={profile.judgeEffort} onChange={(e) => change((p) => ({ ...p, judgeEffort: e.target.value as Profile['judgeEffort'] }), 0)}>
            <option value="low">rápido (~1 min)</option>
            <option value="medium">caprichado (mais lento)</option>
          </select>
        </label>
        <label className="brf-switch">
          <input type="checkbox" checked={profile.localAi} onChange={(e) => (change((p) => ({ ...p, localAi: e.target.checked }), 0), setTimeout(refreshCodex, 400))} />
          <span /> Modelos locais no seu Mac (Ollama): gosto pessoal e tradução
        </label>
        {profile.localAi && (
          <>
            <p className="brf-muted">
              {codex === null
                ? 'Conferindo o Ollama…'
                : `Gosto pessoal (${profile.embedModel}): ${codex.embedReady ? 'pronto' : 'indisponível'} · Tradução local (${localModelLabel(profile.translateModel)}): ${codex.translateReady ? 'pronta' : 'indisponível'}${!codex.embedReady || !codex.translateReady ? ` — ${codex.localError?.replace(/^\[[^\]]+\]\s*/, '') ?? 'o Ollama não respondeu'}` : ''}.`}
            </p>
            <div className="brf-field-row">
              <input
                className="field"
                placeholder="Modelo de tradução (ex.: gemma4:e2b)"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => change((p) => ({ ...p, translateModel: model.trim() || 'gemma4:e2b' }), 0)}
                spellCheck={false}
              />
              <button className="btn" onClick={() => (change((p) => ({ ...p, translateModel: model.trim() || 'gemma4:e2b' }), 0), setTimeout(refreshCodex, 400))}>
                Conferir
              </button>
            </div>
          </>
        )}
      </div>
      <div className="brf-voice-set">
        <VoiceOrb size={64} active={speaking} />
        <div className="brf-voice-fields">
          {voices.length > 0 && (
            <label className="brf-inline">
              Voz
              <select className="brf-select" value={voices.find((x) => x.id === v.voice)?.id ?? voices[0].id} onChange={(e) => change((p) => ({ ...p, voice: { ...p.voice, voice: e.target.value } }), 0)}>
                {voices.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · neural, no seu Mac
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="brf-inline">
            Velocidade
            <div className="brf-speeds" role="radiogroup" aria-label="Velocidade">
              {SPEEDS.map((s) => (
                <button key={s} role="radio" aria-checked={s === speed} className={s === speed ? 'is-on' : ''} onClick={() => change((p) => ({ ...p, voice: { ...p.voice, rate: rateOfSpeed(s) } }), 0)}>
                  {String(s).replace('.', ',')}×
                </button>
              ))}
            </div>
          </div>
          {progress && <p className="brf-muted">{progress}</p>}
          {engine.phase === 'error' && <p className="brf-muted">A voz neural não carregou: {engine.error}</p>}
          <button className="btn sm" onClick={() => void sample()} disabled={speaking}>
            <IconPlay size={11} /> {speaking && engine.phase !== 'ready' ? 'Preparando a voz…' : 'Ouvir amostra'}
          </button>
        </div>
      </div>
    </section>
  )
}

const LEVEL_WORD = { otimo: 'ótimo', ok: 'ok', fraco: 'fraco' } as const

function History() {
  const { ratings, profile } = useBriefing()
  useEffect(() => {
    void loadRatings()
  }, [])
  const tuning = profile?.tuning
  return (
    <section className="brf-sec">
      <h3>Como foram os briefings</h3>
      <p className="brf-muted">{historyLine(ratings)}</p>
      {tuning && (tuning.depth > 0 || tuning.fresh > 0) && (
        <p className="brf-muted">
          Ajustes ativos: {[tuning.depth ? `menos notícia rasa (nível ${tuning.depth})` : '', tuning.fresh ? `notícias mais frescas (nível ${tuning.fresh})` : ''].filter(Boolean).join(' · ')}
        </p>
      )}
      <ul className="brf-history">
        {ratings.slice(0, 7).map((r) => (
          <li key={r.editionDate} className={r.undone ? 'is-undone' : ''}>
            <span className="brf-history-d">{new Date(`${r.editionDate}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <b>{LEVEL_WORD[r.rating]}</b>
            <span className="brf-history-a">
              {r.undone ? 'ajuste desfeito' : r.adjustments.length ? r.adjustments.map((a) => a.label).join(', ') : 'sem ajuste'}
              {r.note ? ` · “${r.note}”` : ''}
            </span>
            {!r.undone && r.adjustments.length > 0 && (
              <button className="btn sm quiet" onClick={() => void undoRating(r.editionDate)}>
                desfazer
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
