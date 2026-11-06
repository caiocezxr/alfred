import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Segmented } from '../../shared/ui/Segmented'
import { ChevronIcon, CloseIcon, MinusIcon, PlusIcon, TrashIcon } from './icons.tsx'
import { parseError } from './normalize.ts'
import { fmtNum } from './relevance.ts'
import {
  addSource, deleteKeyword, probeSource, removeSource, retrySource, saveKeyword, updateSource, type ProbeResult, type RadarState,
} from './store.ts'
import { SOURCE_CATEGORY_LABEL, type FeedSource, type Keyword, type KeywordCategory, type KeywordKind, type SourceCategory } from './types.ts'

export type SettingsTab = 'sources' | 'keywords'

const SOURCE_CATS: SourceCategory[] = ['ai_dev', 'ai_content', 'stack', 'auto']
const CLOSE_MS = 200

export function RadarSettings({ tab, onTab, onClose, st, now }: {
  tab: SettingsTab
  onTab: (t: SettingsTab) => void
  onClose: () => void
  st: RadarState
  now: number
}) {
  const [closing, setClosing] = useState(false)
  const sheet = useRef<HTMLElement>(null)
  const close = () => {
    if (closing) return
    setClosing(true)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setTimeout(onClose, reduced ? 0 : CLOSE_MS)
  }
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
    if (e.key === 'Tab' && sheet.current) {
      const f = [...sheet.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')]
      if (!f.length) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  })
  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>('input, button')?.focus()
    const handler = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  return (
    <div className={`radar-sheet-scrim ${closing ? 'is-closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="radar-sheet" role="dialog" aria-modal="true" aria-labelledby="radar-sheet-title" ref={sheet}>
        <header className="radar-sheet-head">
          <div>
            <div className="kicker">Radar</div>
            <h2 id="radar-sheet-title" className="display">Ajustes</h2>
          </div>
          <button className="radar-icon-btn" onClick={close} aria-label="Fechar ajustes">
            <CloseIcon />
          </button>
        </header>
        <div className="radar-sheet-tabs">
          <Segmented
            label="Seção dos ajustes"
            value={tab}
            onChange={onTab}
            options={[
              { id: 'sources', label: 'Fontes', count: st.sources.length },
              { id: 'keywords', label: 'Palavras-chave', count: st.keywords.length },
            ]}
          />
        </div>
        <div className="radar-sheet-body" key={tab}>
          {tab === 'sources' ? <SourcesTab st={st} now={now} /> : <KeywordsTab keywords={st.keywords} />}
        </div>
      </aside>
    </div>
  )
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

function ago(iso: string, now: number) {
  const m = Math.round((now - Date.parse(iso)) / 6e4)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d <= 1 ? 'ontem' : `há ${d} dias`
}

function SourcesTab({ st, now }: { st: RadarState; now: number }) {
  return (
    <>
      <AddSource existing={st.sources} />
      <p className="radar-help">
        O peso multiplica a importância da fonte (1 = neutro). Categoria <b>Automática</b> decide item a item pelas palavras-chave —
        bom para fontes mistas, como Hacker News. Só RSS/Atom públicos; nada de raspar páginas.
      </p>
      <ul className="radar-src-list">
        {st.sources.map((s, i) => (
          <SourceRow key={s.id} s={s} st={st} now={now} index={i} />
        ))}
      </ul>
    </>
  )
}

function AddSource({ existing }: { existing: FeedSource[] }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<ProbeResult | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<SourceCategory>('auto')

  const reset = () => {
    setFound(null)
    setError(null)
    setName('')
    setCategory('auto')
  }

  const probe = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !url.trim()) return
    if (existing.some((s) => s.url === url.trim())) {
      setError('essa fonte já está no Radar')
      return
    }
    reset()
    setBusy(true)
    try {
      const r = await probeSource(url)
      setFound(r)
      setName((r.title || hostOf(r.url)).slice(0, 80))
    } catch (err) {
      setError(parseError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!found || busy) return
    setBusy(true)
    try {
      await addSource({ name: name.trim() || hostOf(found.url), url: found.url, category })
      setUrl('')
      reset()
    } catch (err) {
      setError(parseError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel radar-add" onSubmit={probe}>
      <label className="radar-label" htmlFor="radar-add-url">
        Adicionar fonte
      </label>
      <div className="radar-add-row">
        <input
          id="radar-add-url"
          className="field"
          type="url"
          inputMode="url"
          placeholder="https://exemplo.com/feed.xml"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (found || error) reset()
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn" type="submit" disabled={busy || !url.trim()}>
          {busy && !found ? 'Validando…' : 'Validar'}
        </button>
      </div>
      {error && (
        <p className="radar-add-error" role="alert">
          {error.charAt(0).toUpperCase() + error.slice(1)}.
        </p>
      )}
      {found && (
        <div className="radar-add-found">
          <p className="radar-add-ok">
            <span className="radar-ok-dot" aria-hidden="true" />
            Feed válido · {found.count} {found.count === 1 ? 'item' : 'itens'}
            {found.latest && <span className="radar-add-latest"> · mais recente: “{found.latest}”</span>}
          </p>
          <div className="radar-add-grid">
            <label className="radar-field">
              <span>Nome</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <label className="radar-field">
              <span>Categoria</span>
              <Select value={category} onChange={(v) => setCategory(v as SourceCategory)} options={SOURCE_CATS.map((c) => [c, SOURCE_CATEGORY_LABEL[c]])} label="Categoria da fonte" wide />
            </label>
          </div>
          <div className="radar-add-actions">
            <button className="btn quiet" type="button" onClick={reset}>
              Cancelar
            </button>
            <button className="btn primary" type="button" onClick={() => void add()} disabled={busy}>
              Adicionar ao Radar
            </button>
          </div>
        </div>
      )}
    </form>
  )
}

function SourceRow({ s, st, now, index }: { s: FeedSource; st: RadarState; now: number; index: number }) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const id = setTimeout(() => setConfirm(false), 2600)
    return () => clearTimeout(id)
  }, [confirm])
  const run = st.runs[s.id]
  const state = run?.state ?? (s.lastStatus === 'error' ? 'error' : s.lastStatus === 'ok' ? 'ok' : 'idle')
  const err = run?.error?.message ?? (s.lastError ? parseError(s.lastError).message : '')
  return (
    <li className={`radar-src ${s.enabled ? '' : 'is-off'}`} style={{ '--i': Math.min(index, 14) } as CSSProperties}>
      <Switch on={s.enabled} onChange={(v) => void updateSource(s.id, { enabled: v })} label={`${s.enabled ? 'Desativar' : 'Ativar'} ${s.name}`} />
      <div className="radar-src-main">
        <div className="radar-src-name">{s.name}</div>
        <div className={`radar-src-meta is-${state}`}>
          <span className="radar-src-dot" aria-hidden="true" />
          {state === 'loading' ? (
            'buscando…'
          ) : state === 'error' ? (
            <>
              <span className="radar-src-err">{err}</span>
              <button className="radar-link" onClick={() => void retrySource(s.id)} disabled={!s.enabled}>
                tentar de novo
              </button>
            </>
          ) : state === 'ok' && s.lastOkAt ? (
            `ok ${ago(s.lastOkAt, now)}`
          ) : (
            'ainda não buscada'
          )}
          <span className="radar-src-host">{hostOf(s.url)}</span>
        </div>
      </div>
      <Select
        value={s.category}
        onChange={(v) => void updateSource(s.id, { category: v as SourceCategory })}
        options={SOURCE_CATS.map((c) => [c, SOURCE_CATEGORY_LABEL[c]])}
        label={`Categoria de ${s.name}`}
      />
      <Stepper value={s.weight} min={0.2} max={2} step={0.1} onChange={(w) => void updateSource(s.id, { weight: w })} label={`Peso de ${s.name}`} />
      <button
        className={`radar-icon-btn is-ghost is-danger ${confirm ? 'is-confirm' : ''}`}
        onClick={() => (confirm ? void removeSource(s.id) : setConfirm(true))}
        aria-label={confirm ? `Confirmar remoção de ${s.name}` : `Remover ${s.name}`}
        title={confirm ? 'Clique de novo para remover (itens salvos ficam)' : 'Remover fonte'}
      >
        {confirm ? 'Remover?' : <TrashIcon />}
      </button>
    </li>
  )
}

type Group = { id: string; title: string; hint: string; kind: KeywordKind; category: KeywordCategory | null }
const GROUPS: Group[] = [
  { id: 'ai_dev', title: 'IA para desenvolvimento', hint: 'somam pontos e puxam o item para esta categoria', kind: 'boost', category: 'ai_dev' },
  { id: 'ai_content', title: 'IA para conteúdo', hint: 'vídeo, voz, imagem, criadores e plataformas', kind: 'boost', category: 'ai_content' },
  { id: 'stack', title: 'Stacks e ferramentas', hint: 'a sua stack e o que está em volta dela', kind: 'boost', category: 'stack' },
  { id: 'signal', title: 'Sinais acionáveis', hint: 'somam em qualquer categoria', kind: 'boost', category: null },
  { id: 'mute', title: 'Penalizar', hint: 'vagas, eventos, institucional, vendas', kind: 'mute', category: null },
]

function KeywordsTab({ keywords }: { keywords: Keyword[] }) {
  return (
    <>
      <p className="radar-help">
        Cada palavra soma o peso quando aparece no título e metade quando aparece só no trecho; as de penalizar subtraem.
        Termo com <b>*</b> no fim casa como prefixo (<i>agent*</i> pega agents e agentic). Ao dispensar um item, as palavras que mais
        somaram para ele perdem um pouco de peso — sempre com aviso e desfazer.
      </p>
      {GROUPS.map((g) => (
        <KeywordGroup key={g.id} group={g} keywords={keywords.filter((k) => k.kind === g.kind && (g.kind === 'mute' || k.category === g.category))} />
      ))}
    </>
  )
}

function KeywordGroup({ group, keywords }: { group: Group; keywords: Keyword[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sorted = [...keywords].sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
  const sel = sorted.find((k) => k.id === selected) ?? null

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const term = draft.trim()
    if (!term) return
    try {
      const k = await saveKeyword({ term, kind: group.kind, category: group.category, weight: group.kind === 'mute' ? 2 : 1.5 })
      setDraft('')
      setError(null)
      setSelected(k.id)
    } catch (err) {
      setError(parseError(err).message)
    }
  }

  const setWeight = async (k: Keyword, weight: number) => {
    try {
      await saveKeyword({ id: k.id, term: k.term, kind: k.kind, category: k.category, weight })
    } catch (err) {
      setError(parseError(err).message)
    }
  }

  return (
    <section className={`radar-kw-group is-${group.kind}`} data-cat={group.category ?? group.id}>
      <header className="radar-kw-head">
        <h3>{group.title}</h3>
        <span>{group.hint}</span>
      </header>
      <div className="radar-chips">
        {sorted.map((k) => (
          <button
            key={k.id}
            className={`radar-chip ${selected === k.id ? 'is-on' : ''}`}
            onClick={() => setSelected((s) => (s === k.id ? null : k.id))}
            aria-pressed={selected === k.id}
            title={`${group.kind === 'mute' ? '−' : '+'}${fmtNum(k.weight)} no título`}
          >
            {k.term}
            <span className="radar-chip-w">
              {group.kind === 'mute' ? '−' : '+'}
              {fmtNum(k.weight)}
            </span>
          </button>
        ))}
        <form className="radar-kw-add" onSubmit={add}>
          <input
            className="radar-kw-input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            placeholder="+ adicionar"
            aria-label={`Adicionar palavra em ${group.title}`}
            maxLength={60}
            spellCheck={false}
          />
        </form>
      </div>
      {error && (
        <p className="radar-add-error" role="alert">
          {error.charAt(0).toUpperCase() + error.slice(1)}.
        </p>
      )}
      {sel && (
        <div className="radar-kw-edit">
          <span className="radar-kw-term">{sel.term}</span>
          <Stepper value={sel.weight} min={0.25} max={5} step={0.25} onChange={(w) => void setWeight(sel, w)} label={`Peso de ${sel.term}`} />
          <span className="radar-kw-note">{sel.builtin ? 'da lista inicial' : 'sua'}</span>
          <button
            className="btn quiet radar-btn-sm is-danger"
            onClick={() => {
              void deleteKeyword(sel.id)
              setSelected(null)
            }}
          >
            Remover
          </button>
        </div>
      )}
    </section>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="radar-switch" role="switch" aria-checked={on} aria-label={label} title={label} onClick={() => onChange(!on)} />
}

function Stepper({ value, min, max, step, onChange, label }: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  label: string
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: step < 0.1 || step % 0.1 ? 2 : 1, maximumFractionDigits: 2 })
  return (
    <div className="radar-stepper" role="group" aria-label={label}>
      <button onClick={() => onChange(Math.round(clamp(value - step) * 100) / 100)} disabled={value <= min + 1e-9} aria-label={`Diminuir ${label.toLowerCase()}`}>
        <MinusIcon />
      </button>
      <span className="radar-stepper-val" aria-live="polite">
        {fmt(value)}
      </span>
      <button onClick={() => onChange(Math.round(clamp(value + step) * 100) / 100)} disabled={value >= max - 1e-9} aria-label={`Aumentar ${label.toLowerCase()}`}>
        <PlusIcon />
      </button>
    </div>
  )
}

function Select({ value, onChange, options, label, wide }: {
  value: string
  onChange: (v: string) => void
  options: [string, string][]
  label: string
  wide?: boolean
}) {
  return (
    <span className={`radar-select ${wide ? 'is-wide' : ''}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <ChevronIcon className="radar-select-chev" />
    </span>
  )
}
