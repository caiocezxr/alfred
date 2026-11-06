import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { openExternal } from '../../../shared/openExternal'
import { Icon } from '../icons'
import { dropBoard, gh, type CheckCtx, type OpenPr, type PrDetail } from './api'

const rel = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 60) return `${Math.max(1, m)} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} d`
}

const tone = (c: CheckCtx) => {
  const v = c.__typename === 'CheckRun' ? (c.status !== 'COMPLETED' ? 'PENDING' : c.conclusion ?? 'NEUTRAL') : c.state
  if (v === 'SUCCESS' || v === 'NEUTRAL' || v === 'SKIPPED') return 'ok'
  if (v === 'PENDING' || v === 'EXPECTED' || v === 'QUEUED' || v === 'IN_PROGRESS') return 'run'
  return 'bad'
}

const REVIEW: Record<string, string> = { APPROVED: 'aprovou', CHANGES_REQUESTED: 'pediu ajustes', COMMENTED: 'comentou', DISMISSED: 'review descartada' }

function Diff({ patch }: { patch: string }) {
  if (!patch) return <p className="prs-muted">Sem diff para mostrar (arquivo binário ou grande demais).</p>
  return (
    <pre className="prs-diff">
      {patch.split('\n').map((l, i) => (
        <span key={i} className={l.startsWith('@@') ? 'is-hunk' : l.startsWith('+') ? 'is-add' : l.startsWith('-') ? 'is-del' : ''}>
          {l || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

export function PrSheet({ login, repo, number, review, onClose, onChanged }: { login: string; repo: string; number: number; review: boolean; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<PrDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'resumo' | 'arquivos'>('resumo')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [arm, setArm] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const close = () => {
    setLeaving(true)
    window.setTimeout(onClose, 220)
  }

  useEffect(() => {
    gh.prDetail(login, repo, number)
      .then((x) => {
        setD(x)
        if (x.files.length <= 3) setOpen(new Set(x.files.map((f) => f.filename)))
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [login, repo, number])

  const pr = d?.pr
  const roll = pr?.commits.nodes[0]?.commit.statusCheckRollup ?? null
  const checks = roll?.contexts.nodes ?? []
  const canMerge = !!pr && !review && pr.state === 'OPEN' && !pr.isDraft && pr.mergeable === 'MERGEABLE' && (roll?.state === 'SUCCESS' || !roll) && pr.reviewDecision !== 'CHANGES_REQUESTED' && pr.reviewDecision !== 'REVIEW_REQUIRED'

  const act = async (what: 'approve' | 'merge') => {
    if (what === 'merge' && !arm) return setArm(true)
    setBusy(what)
    setNote(null)
    try {
      if (what === 'approve') {
        await gh.review(login, repo, number, 'APPROVE')
        setNote('Aprovado')
      } else {
        await gh.mergePr(login, repo, number)
        setNote('Mesclado')
      }
      onChanged()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setArm(false)
    }
  }

  const links = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    if (a.href.startsWith('http')) void openExternal(a.href)
  }

  return createPortal(
    <div className={`prs-scrim ${leaving ? 'is-leaving' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="prs" role="dialog" aria-label={`PR #${number}`}>
        <header className="prs-head">
          <div className="prs-top">
            <span className="prs-repo">{repo}</span>
            <span className="prs-num">#{number}</span>
            {pr && <span className={`prs-state is-${pr.merged ? 'merged' : pr.isDraft ? 'draft' : pr.state.toLowerCase()}`}>{pr.merged ? 'mesclado' : pr.isDraft ? 'rascunho' : pr.state === 'OPEN' ? 'aberto' : 'fechado'}</span>}
            <span className="prs-grow" />
            <button className="prs-x" onClick={close} aria-label="Fechar">
              <Icon name="x" size={13} />
            </button>
          </div>
          <h2 className="display">{pr?.title ?? 'Carregando…'}</h2>
          {pr && (
            <div className="prs-meta">
              {pr.author && <img src={pr.author.avatarUrl} alt="" />}
              <span>
                @{pr.author?.login} · há {rel(pr.createdAt)}
              </span>
              <code>
                {pr.headRefName} → {pr.baseRefName}
              </code>
              <span className="prs-diffn">
                <i>+{pr.additions}</i> <s>−{pr.deletions}</s> · {pr.changedFiles} arquivos
              </span>
            </div>
          )}
          <nav className="prs-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'resumo'} className={tab === 'resumo' ? 'is-on' : ''} onClick={() => setTab('resumo')}>
              Resumo
            </button>
            <button role="tab" aria-selected={tab === 'arquivos'} className={tab === 'arquivos' ? 'is-on' : ''} onClick={() => setTab('arquivos')}>
              Arquivos {d && <em>{d.files.length}</em>}
            </button>
            <i className={`prs-tab-pill is-${tab}`} aria-hidden="true" />
          </nav>
        </header>

        <div className="prs-body" key={tab}>
          {err && <p className="prs-err">{err}</p>}
          {!d && !err && (
            <div className="prs-skel">
              <i />
              <i />
              <i />
            </div>
          )}
          {d && tab === 'resumo' && (
            <>
              <section className="prs-sec">
                <h3>
                  Checks
                  <span className={`prs-roll is-${roll?.state?.toLowerCase() ?? 'none'}`}>{roll ? (roll.state === 'SUCCESS' ? 'tudo verde' : roll.state === 'FAILURE' || roll.state === 'ERROR' ? 'falhando' : 'rodando') : 'sem checks'}</span>
                </h3>
                {checks.length > 0 && (
                  <ul className="prs-checks">
                    {checks.map((c, i) => {
                      const name = c.__typename === 'CheckRun' ? c.name : c.context
                      const url = c.__typename === 'CheckRun' ? c.detailsUrl : c.targetUrl
                      return (
                        <li key={`${name}-${i}`} className={`is-${tone(c)}`} style={{ ['--k' as string]: i } as CSSProperties}>
                          <i aria-hidden="true" />
                          <span>{name}</span>
                          {url && (
                            <button onClick={() => void openExternal(url)} title="Ver o log">
                              log <Icon name="arrow" size={10} />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
              <section className="prs-sec">
                <h3>Descrição</h3>
                {pr!.bodyHTML ? <div className="prs-md" onClick={links} dangerouslySetInnerHTML={{ __html: pr!.bodyHTML }} /> : <p className="prs-muted">Sem descrição.</p>}
              </section>
              {(pr!.reviews.nodes.length > 0 || pr!.comments.nodes.length > 0) && (
                <section className="prs-sec">
                  <h3>Conversa</h3>
                  <ul className="prs-talk">
                    {[
                      ...pr!.reviews.nodes.map((r) => ({ who: r.author, at: r.submittedAt, text: r.bodyText, tag: REVIEW[r.state] ?? r.state.toLowerCase(), cls: r.state.toLowerCase() })),
                      ...pr!.comments.nodes.map((c) => ({ who: c.author, at: c.createdAt, text: c.bodyText, tag: 'comentou', cls: 'comment' })),
                    ]
                      .sort((a, b) => a.at.localeCompare(b.at))
                      .map((t, i) => (
                        <li key={i} className={`is-${t.cls}`} style={{ ['--k' as string]: i } as CSSProperties}>
                          {t.who && <img src={t.who.avatarUrl} alt="" />}
                          <div>
                            <span className="prs-who">
                              @{t.who?.login} <em>{t.tag}</em> · {rel(t.at)}
                            </span>
                            {t.text && <p>{t.text}</p>}
                          </div>
                        </li>
                      ))}
                  </ul>
                </section>
              )}
            </>
          )}
          {d && tab === 'arquivos' && (
            <ul className="prs-files">
              {d.files.map((f, i) => {
                const on = open.has(f.filename)
                return (
                  <li key={f.filename} className={`${on ? 'is-open' : ''} is-${f.status}`} style={{ ['--k' as string]: i } as CSSProperties}>
                    <button
                      className="prs-file"
                      onClick={() =>
                        setOpen((s) => {
                          const n = new Set(s)
                          if (n.has(f.filename)) n.delete(f.filename)
                          else n.add(f.filename)
                          return n
                        })
                      }
                    >
                      <Icon name="chevron" size={11} />
                      <span className="prs-fname">{f.filename}</span>
                      <span className="prs-fst">{f.status === 'added' ? 'novo' : f.status === 'removed' ? 'removido' : f.status === 'renamed' ? 'renomeado' : ''}</span>
                      <span className="prs-diffn">
                        <i>+{f.additions}</i> <s>−{f.deletions}</s>
                      </span>
                    </button>
                    <div className="prs-fbody">
                      <div>{on && <Diff patch={f.patch} />}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="prs-foot">
          <button className="prs-ghost" onClick={() => pr && void openExternal(pr.url)}>
            Abrir no GitHub <Icon name="arrow" size={11} />
          </button>
          <span className="prs-grow" />
          {note && <span className="prs-note">{note}</span>}
          {review && pr?.state === 'OPEN' && (
            <button className="prs-ok" onClick={() => void act('approve')} disabled={!!busy}>
              {busy === 'approve' ? 'Aprovando…' : 'Aprovar'}
            </button>
          )}
          {canMerge && (
            <button className={`prs-merge ${arm ? 'is-arm' : ''}`} onClick={() => void act('merge')} onBlur={() => setArm(false)} disabled={!!busy}>
              {busy === 'merge' ? 'Mesclando…' : arm ? 'Confirmar merge' : 'Mesclar'}
            </button>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  )
}

export function PrHost() {
  const [p, setP] = useState<OpenPr | null>(null)
  useEffect(() => {
    const on = (e: Event) => setP((e as CustomEvent<OpenPr>).detail)
    window.addEventListener('gh:open-pr', on)
    return () => window.removeEventListener('gh:open-pr', on)
  }, [])
  if (!p) return null
  return <PrSheet key={`${p.repo}#${p.number}`} login={p.login} repo={p.repo} number={p.number} review={p.review} onClose={() => setP(null)} onChanged={() => dropBoard(p.login)} />
}
