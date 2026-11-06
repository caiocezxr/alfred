import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { openExternal } from '../../../shared/openExternal'
import { CompanyMark, coStyle } from '../brand'
import { Icon } from '../icons'
import type { Scope } from '../logic'
import { createItem } from '../store'
import { PERSONAL_ID, type Company, type WorkState } from '../types'
import { checkOf, dropBoard, getGh, gh, loadBoard, noreply, openPr, setGh, talkOf, useBoards, useGhSettings, useSeen, type Branches, type GhAccount, type Issue, type LocalRepo, type Pr, type Repo } from './api'
import './github.css'

const rel = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 60) return `${Math.max(1, m)} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} d`
}

function useDashboard(login: string | null) {
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const list = useBoards(login ? [login] : [])
  const data = list[0]?.data ?? null
  const load = async (force = false) => {
    if (!login) return
    setBusy(true)
    setErr(null)
    try {
      await loadBoard(login, force)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [login])
  return { data, err, busy, reload: () => load(true) }
}

export function GitHubView({ state, scope }: { state: WorkState; scope: Scope }) {
  const s = useGhSettings()
  const [accounts, setAccounts] = useState<GhAccount[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pr, setPr] = useState<{ company: Company; login: string } | null>(null)
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem('ps.github.account')
    } catch {
      return null
    }
  })
  const [switching, setSwitching] = useState<string | null>(null)
  const [setup, setSetup] = useState(false)
  const seg = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)

  const loadAccounts = () => {
    setErr(null)
    gh.accounts()
      .then(setAccounts)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }
  useEffect(loadAccounts, [])

  const companies = state.companies
  const logins = (accounts ?? []).map((a) => a.login)
  const locked = scope !== 'all' && scope !== PERSONAL_ID
  const scoped = locked ? s.stations[scope] : null
  const only = (scoped && logins.includes(scoped) ? scoped : null) ?? (picked && logins.includes(picked) ? picked : null) ?? logins.find((l) => Object.values(s.stations).includes(l)) ?? logins[0] ?? null
  const pick = (l: string) => {
    setPicked(l)
    try {
      localStorage.setItem('ps.github.account', l)
    } catch {}
    if (scope === PERSONAL_ID) setGh({ stations: { ...s.stations, [PERSONAL_ID]: l } })
    if (accounts && accounts.find((a) => a.active)?.login !== l) void makeActive(l)
  }
  const owned = companies.filter((c) => only && s.stations[c.id] === only)
  const visible = scope === 'all' ? owned : companies.filter((c) => c.id === scope && only && (scope === PERSONAL_ID || s.stations[c.id] === only)).map((c) => c)
  const tint = owned[0] ?? null
  const active = accounts?.find((a) => a.active)?.login ?? null
  useLayoutEffect(() => {
    const box = seg.current
    const btn = box?.querySelector<HTMLElement>(`[data-login="${only}"]`)
    if (!box || !btn) return setPill(null)
    setPill({ x: btn.offsetLeft, w: btn.offsetWidth })
  }, [only, accounts, s.stations])
  const linked = Object.values(s.stations).some(Boolean)
  const makeActive = async (login: string) => {
    setSwitching(login)
    try {
      setAccounts(await gh.switchTo(login))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div className="gh">
      {accounts && accounts.length > 0 && (
        <section className="gh-accts reveal" style={{ ['--i' as string]: 0 }} aria-label="Contas do GitHub">
          {locked ? (
            <span className="gh-locked">
              Perfil {companies.find((c) => c.id === scope)?.name}: só o GitHub desta estação
            </span>
          ) : (
          <div className="gh-acct-seg" role="tablist" aria-label="Conta do GitHub" ref={seg}>
            {pill && <i className="gh-acct-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />}
            {accounts.map((a) => {
              const st = companies.filter((c) => s.stations[c.id] === a.login)
              return (
                <button
                  key={a.login}
                  role="tab"
                  aria-selected={only === a.login}
                  className={only === a.login ? 'is-on' : ''}
                  style={st[0] ? coStyle(st[0]) : undefined}
                  data-login={a.login}
                  onClick={() => pick(a.login)}
                >
                  <img src={`https://github.com/${a.login}.png?size=48`} alt="" />
                  <span>
                    @{a.login}
                    <small>{st.length ? st.map((c) => c.name).join(' · ') : 'sem estação'}</small>
                  </span>
                </button>
              )
            })}
          </div>
          )}
          <div className="gh-active">
            <span className={`gh-term ${switching ? 'is-busy' : ''}`}>
              <i aria-hidden="true" />
              {switching ? `trocando o terminal para @${switching}…` : `terminal em @${active ?? '—'}`}
            </span>
            <button className={`gh-ghost ${setup || !linked ? 'is-on' : ''}`} onClick={() => setSetup((v) => !v)}>
              <Icon name="gear" size={12} /> Estações
            </button>
          </div>
        </section>
      )}

      {(() => {
        const used = new Set(Object.values(s.stations).filter(Boolean))
        const fresh = (accounts ?? []).filter((a) => a.ok && !used.has(a.login))
        const free = companies.filter((c) => !s.stations[c.id])
        if (!fresh.length || !free.length) return null
        const target = free.find((c) => fresh[0].login.toLowerCase().includes(c.id) || fresh[0].login.toLowerCase().includes(c.name.toLowerCase())) ?? free[0]
        return (
          <section className="gh-newacct reveal" style={coStyle(target)}>
            <img src={`https://github.com/${fresh[0].login}.png?size=64`} alt="" />
            <span>
              Conta nova no gh: <b>@{fresh[0].login}</b>. Ligar à estação <b>{target.name}</b>?
            </span>
            <span className="gh-grow" />
            <select defaultValue={target.id} id="gh-newacct-target" aria-label="Estação">
              {free.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="gh-new"
              onClick={() => {
                const sel = (document.getElementById('gh-newacct-target') as HTMLSelectElement | null)?.value ?? target.id
                setGh({ stations: { ...s.stations, [sel]: fresh[0].login } })
              }}
            >
              Ligar
            </button>
          </section>
        )
      })()}

      {(setup || !linked || err || (accounts && accounts.length === 0) || (locked && !scoped)) && (
      <section className="gh-stations reveal" style={{ ['--i' as string]: 1 }}>
        <header className="gh-h">
          <span className="gh-k">Estações</span>
          <span className="gh-hint">cada empresa com a sua conta do GitHub, sem trocar de conta</span>
          <button className="gh-icon" onClick={loadAccounts} title="Recarregar contas do gh" aria-label="Recarregar contas">
            <Icon name="refresh" size={13} />
          </button>
        </header>
        {err ? (
          <div className="gh-setup">
            <b>{err}</b>
          </div>
        ) : accounts && accounts.length === 0 ? (
          <div className="gh-setup">
            <b>Nenhuma conta no GitHub CLI.</b> No Terminal, rode uma vez por conta: <code>gh auth login</code>
          </div>
        ) : (
          <div className="gh-st-grid">
            {companies.map((c) => {
              const login = s.stations[c.id] ?? null
              return (
                <div key={c.id} className={`gh-st ${login ? 'is-on' : ''}`} style={coStyle(c)}>
                  <CompanyMark company={c} size={26} />
                  <div className="gh-st-t">
                    <b>{c.name}</b>
                    <select
                      value={login ?? ''}
                      onChange={(e) => setGh({ stations: { ...s.stations, [c.id]: e.target.value } })}
                      aria-label={`Conta do GitHub para ${c.name}`}
                    >
                      <option value="">sem conta</option>
                      {(accounts ?? []).map((a) => (
                        <option key={a.login} value={a.login}>
                          @{a.login}
                          {a.ok ? '' : ' (precisa logar)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className={`gh-st-led ${login ? 'is-on' : ''}`} aria-hidden="true" />
                </div>
              )
            })}
          </div>
        )}
        {accounts && accounts.length > 0 && <p className="gh-foot">Outra conta? No Terminal: <code>gh auth login</code> e depois recarregue aqui.</p>}
      </section>
      )}

      {only && (
        <section className="gh-acct-head reveal" style={tint ? coStyle(tint) : undefined} key={only}>
          <img src={`https://github.com/${only}.png?size=96`} alt="" />
          <div>
            <span className="gh-k">Você está em</span>
            <h2 className="display">@{only}</h2>
            <span className="gh-muted">{owned.length ? `estação ${owned.map((c) => c.name).join(' e ')}` : 'esta conta ainda não está ligada a nenhuma empresa: escolha acima em Estações'}</span>
          </div>
          <span className="gh-grow" />
          {only === active ? <span className="gh-pill is-on">ativa no terminal</span> : <span className="gh-pill">o terminal está em @{active}</span>}
        </section>
      )}

      {visible.map((c, i) => (
        <Station
          key={`${only}-${c.id}`}
          company={c}
          login={c.id === PERSONAL_ID && scope === PERSONAL_ID && only ? only : s.stations[c.id]}
          index={i}
          state={state}
          onNewPr={() => setPr({ company: c, login: only ?? s.stations[c.id] })}
          onOpen={(p, review) => openPr({ login: only ?? s.stations[c.id], repo: p.repository.nameWithOwner, number: p.number, review })}
        />
      ))}

      {only && <Guardian companies={companies} login={only} key={`g-${only}`} />}

      {pr && <NewPr company={pr.company} login={pr.login} onClose={() => setPr(null)} />}

    </div>
  )
}

function Station({ company, login, index, state, onNewPr, onOpen }: { company: Company; login: string; index: number; state: WorkState; onNewPr: () => void; onOpen: (p: Pr, review: boolean) => void }) {
  const { data, err, busy, reload } = useDashboard(login)
  const s = useGhSettings()
  const person = s.people[login]
  const [editing, setEditing] = useState(false)
  const [nm, setNm] = useState('')
  const [em, setEm] = useState('')

  useEffect(() => {
    if (!data || getGh().people[login]) return
    setGh({ people: { ...getGh().people, [login]: { name: data.viewer.name || login, email: noreply(data.viewer) } } })
  }, [data])

  const counts = data ? { mine: data.mine.nodes.length, review: data.review.nodes.length, issues: data.issues.nodes.length } : null
  const imported = useMemo(() => new Set(state.items.map((i) => i.url).filter(Boolean) as string[]), [state.items])

  return (
    <section className="gh-sta reveal" style={{ ...coStyle(company), ['--i' as string]: index + 2 }}>
      <header className="gh-sta-h">
        <CompanyMark company={company} size={22} />
        <h3 className="display">{company.name}</h3>
        {data && <img className="gh-ava" src={data.viewer.avatarUrl} alt="" />}
        <span className="gh-login">@{login}</span>
        {person && !editing && (
          <button
            className="gh-who"
            onClick={() => {
              setNm(person.name)
              setEm(person.email)
              setEditing(true)
            }}
            title="Nome e e-mail usados nos commits desta estação"
          >
            commits como <b>{person.name}</b> &lt;{person.email}&gt;
          </button>
        )}
        {editing && (
          <form
            className="gh-who-form"
            onSubmit={(e) => {
              e.preventDefault()
              setGh({ people: { ...s.people, [login]: { name: nm.trim() || login, email: em.trim() } } })
              setEditing(false)
            }}
          >
            <input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="Nome" aria-label="Nome nos commits" />
            <input value={em} onChange={(e) => setEm(e.target.value)} placeholder="E-mail" aria-label="E-mail nos commits" />
            <button type="submit">Salvar</button>
          </form>
        )}
        <span className="gh-grow" />
        <button className="gh-icon" onClick={() => void reload()} disabled={busy} aria-label="Atualizar" title="Atualizar">
          <Icon name="refresh" size={13} />
        </button>
        <button className="gh-new" onClick={onNewPr}>
          <Icon name="plus" size={12} /> Novo PR
        </button>
      </header>
      {err && <p className="gh-err">{err}</p>}
      {!data && !err && <p className="gh-muted">Carregando o GitHub de @{login}…</p>}
      {data && (
        <div className="gh-cols">
          <Col title="Meus PRs" n={counts!.mine} empty="Nenhum PR seu aberto.">
            {data.mine.nodes.map((p) => (
              <PrCard key={p.url} pr={p} login={login} onDone={reload} onOpen={() => onOpen(p, false)} />
            ))}
          </Col>
          <Col title="Pra você revisar" n={counts!.review} empty="Ninguém pediu sua revisão.">
            {data.review.nodes.map((p) => (
              <PrCard key={p.url} pr={p} login={login} review onDone={reload} onOpen={() => onOpen(p, true)} />
            ))}
          </Col>
          <Col title="Issues com você" n={counts!.issues} empty="Nenhuma issue atribuída.">
            {data.issues.nodes.map((i) => (
              <IssueCard key={i.url} issue={i} company={company} imported={imported.has(i.url)} />
            ))}
          </Col>
        </div>
      )}
    </section>
  )
}

function Col({ title, n, empty, children }: { title: string; n: number; empty: string; children: ReactNode }) {
  const [all, setAll] = useState(false)
  const list = Array.isArray(children) ? (children as ReactNode[]) : [children]
  const first = list.slice(0, 3)
  const rest = list.slice(3)
  return (
    <div className="gh-col">
      <h4>
        {title} <em>{n}</em>
      </h4>
      {n === 0 ? (
        <p className="gh-muted">{empty}</p>
      ) : (
        <>
          <ul>{first}</ul>
          {rest.length > 0 && (
            <>
              <div className={`gh-more-wrap ${all ? 'is-open' : ''}`}>
                <div>
                  <ul>{all && rest}</ul>
                </div>
              </div>
              <button className={`gh-more ${all ? 'is-open' : ''}`} onClick={() => setAll((v) => !v)}>
                <Icon name="chevron" size={11} />
                {all ? 'Recolher' : `Ver todos (${n})`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

const CHECK_LABEL: Record<string, string> = { SUCCESS: 'checks ok', FAILURE: 'checks falhando', ERROR: 'checks com erro', PENDING: 'checks rodando', EXPECTED: 'checks esperando' }
const REVIEW_LABEL: Record<string, string> = { APPROVED: 'aprovado', CHANGES_REQUESTED: 'pediram ajustes', REVIEW_REQUIRED: 'aguardando review' }

function PrCard({ pr, login, review, onDone, onOpen }: { pr: Pr; login: string; review?: boolean; onDone: () => void; onOpen: () => void }) {
  const check = checkOf(pr)
  const [arm, setArm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const canMerge = !review && !pr.isDraft && pr.mergeable === 'MERGEABLE' && (check === 'SUCCESS' || check === null) && pr.reviewDecision !== 'CHANGES_REQUESTED' && pr.reviewDecision !== 'REVIEW_REQUIRED'
  useSeen()
  const talk = talkOf(pr, login)
  const head = talk[0]
  const merge = async () => {
    if (!arm) return setArm(true)
    setBusy(true)
    try {
      await gh.mergePr(login, pr.repository.nameWithOwner, pr.number)
      setMsg('Mesclado')
      window.setTimeout(onDone, 800)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setArm(false)
    }
  }
  return (
    <li className={`gh-pr is-${(check ?? 'none').toLowerCase()} ${head ? `has-talk is-talk-${head.kind}` : ''}`}>
      {head && (
        <span className="gh-talk-badge" aria-label={`${talk.length} ${talk.length === 1 ? 'novidade' : 'novidades'} para ver`}>
          <Icon name="chat" size={11} />
          {talk.length}
        </span>
      )}
      <button className="gh-pr-main" onClick={onOpen} title={head ? 'Tem comentário novo: abrir o PR' : 'Ver o PR'}>
        <span className="gh-pr-top">
          <span className="gh-repo">{pr.repository.nameWithOwner.split('/')[1]}</span>
          <span className="gh-num">#{pr.number}</span>
          {pr.isDraft && <span className="gh-tag">rascunho</span>}
          <span className="gh-when">{rel(pr.updatedAt)}</span>
        </span>
        <span className="gh-pr-title">{pr.title}</span>
        <span className="gh-pr-meta">
          <span className="gh-branch">
            {pr.headRefName} → {pr.baseRefName}
          </span>
          <span className="gh-diff">
            <i>+{pr.additions}</i> <s>−{pr.deletions}</s>
          </span>
        </span>
        {head && (
          <span className="gh-talk">
            {head.avatar ? <img src={head.avatar} alt="" /> : <i aria-hidden="true" />}
            <span className="gh-talk-body">
              <b>
                @{head.who} {head.kind === 'changes' ? 'pediu ajustes' : head.kind === 'approved' ? 'aprovou' : head.kind === 'review' ? 'revisou' : 'comentou'}
                <em>{rel(head.at)}</em>
              </b>
              {head.text && <span className="gh-talk-text">{head.text.replace(/\s+/g, ' ')}</span>}
            </span>
          </span>
        )}
      </button>
      <div className="gh-pr-foot">
        <span className={`gh-check is-${(check ?? 'none').toLowerCase()}`}>
          <i aria-hidden="true" />
          {check ? CHECK_LABEL[check] : 'sem checks'}
        </span>
        {pr.reviewDecision && <span className={`gh-rev is-${pr.reviewDecision.toLowerCase()}`}>{REVIEW_LABEL[pr.reviewDecision]}</span>}
        {pr.mergeable === 'CONFLICTING' && <span className="gh-rev is-changes_requested">conflito</span>}
        {review && <span className="gh-rev">de @{pr.author?.login}</span>}
        <span className="gh-grow" />
        {msg ? (
          <span className="gh-msg">{msg}</span>
        ) : canMerge ? (
          <button className={`gh-merge ${arm ? 'is-arm' : ''}`} onClick={() => void merge()} onBlur={() => setArm(false)} disabled={busy}>
            {busy ? 'Mesclando…' : arm ? 'Confirmar merge' : 'Mesclar'}
          </button>
        ) : null}
      </div>
    </li>
  )
}

function IssueCard({ issue, company, imported }: { issue: Issue; company: Company; imported: boolean }) {
  const [done, setDone] = useState(imported)
  const repo = issue.repository.nameWithOwner.split('/')[1]
  return (
    <li className="gh-issue">
      <button className="gh-pr-main" onClick={() => void openExternal(issue.url)} title="Abrir no GitHub">
        <span className="gh-pr-top">
          <span className="gh-repo">{repo}</span>
          <span className="gh-num">#{issue.number}</span>
          <span className="gh-when">{rel(issue.updatedAt)}</span>
        </span>
        <span className="gh-pr-title">{issue.title}</span>
        {issue.labels.nodes.length > 0 && (
          <span className="gh-labels">
            {issue.labels.nodes.map((l) => (
              <i key={l.name} style={{ ['--lc' as string]: `#${l.color}` } as CSSProperties}>
                {l.name}
              </i>
            ))}
          </span>
        )}
      </button>
      <div className="gh-pr-foot">
        <span className="gh-grow" />
        <button
          className={`gh-to-board ${done ? 'is-done' : ''}`}
          disabled={done}
          onClick={async () => {
            const it = await createItem({ companyId: company.id, title: issue.title, url: issue.url, ticket: `#${issue.number}`, system: repo, kind: 'pendencia' })
            if (it) setDone(true)
          }}
        >
          {done ? 'No Quadro' : 'Levar pro Quadro'}
        </button>
      </div>
    </li>
  )
}

function NewPr({ company, login, onClose }: { company: Company; login: string; onClose: () => void }) {
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [q, setQ] = useState('')
  const [repo, setRepo] = useState<string | null>(null)
  const [br, setBr] = useState<Branches['repository'] | null>(null)
  const [head, setHead] = useState('')
  const [base, setBase] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [made, setMade] = useState<{ number: number; url: string } | null>(null)

  useEffect(() => {
    gh.repos(login)
      .then(setRepos)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [login])

  useEffect(() => {
    if (!repo) return
    setBr(null)
    setHead('')
    gh.branches(login, repo)
      .then((b) => {
        setBr(b.repository)
        setBase(b.repository.defaultBranchRef?.name ?? 'main')
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [repo])

  const open = new Map((br?.pullRequests.nodes ?? []).map((p) => [p.headRefName, p]))
  const heads = (br?.refs.nodes ?? []).filter((r) => r.name !== base)
  const list = (repos ?? []).filter((r) => r.nameWithOwner.toLowerCase().includes(q.toLowerCase())).slice(0, 40)

  const pickHead = (name: string) => {
    setHead(name)
    const ref = br?.refs.nodes.find((r) => r.name === name)
    const human = name.replace(/^(feat|fix|chore|feature|bugfix|hotfix)[/-]/i, '').replace(/[-_/]+/g, ' ').trim()
    setTitle(ref?.target.messageHeadline || human.charAt(0).toUpperCase() + human.slice(1))
  }

  const submit = async () => {
    if (!repo || !head || !base || !title.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const r = await gh.createPr(login, repo, head, base, title, body, draft)
      setMade(r)
      dropBoard(login)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="gh-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gh-dlg" role="dialog" aria-label="Novo PR" style={coStyle(company)}>
        <header>
          <CompanyMark company={company} size={20} />
          <h3 className="display">Novo PR</h3>
          <span className="gh-login">@{login}</span>
          <span className="gh-grow" />
          <button className="gh-icon" onClick={onClose} aria-label="Fechar">
            <Icon name="x" size={13} />
          </button>
        </header>
        {made ? (
          <div className="gh-made">
            <span className="gh-made-stamp">PR #{made.number} aberto</span>
            <p>
              {repo} · {head} → {base}
            </p>
            <div className="gh-made-act">
              <button className="gh-new" onClick={() => void openExternal(made.url)}>
                Abrir no GitHub
              </button>
              <button className="gh-ghost" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="gh-steps">
              <div className="gh-step">
                <span className="gh-step-n">1</span>
                <div className="gh-step-b">
                  <label>Repositório</label>
                  {repo ? (
                    <button className="gh-chosen" onClick={() => setRepo(null)}>
                      {repo} <small>trocar</small>
                    </button>
                  ) : (
                    <>
                      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={repos ? 'Buscar repositório…' : 'Carregando repositórios…'} />
                      <ul className="gh-pick">
                        {list.map((r) => (
                          <li key={r.nameWithOwner}>
                            <button onClick={() => setRepo(r.nameWithOwner)}>
                              <span>{r.nameWithOwner}</span>
                              <small>
                                {r.isPrivate ? 'privado · ' : ''}push há {rel(r.pushedAt)}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
              {repo && (
                <div className="gh-step">
                  <span className="gh-step-n">2</span>
                  <div className="gh-step-b">
                    <label>Branch com as mudanças</label>
                    {!br ? (
                      <p className="gh-muted">Carregando branches…</p>
                    ) : heads.length === 0 ? (
                      <p className="gh-muted">Nenhuma branch além da {base}. Faça push da sua branch e tente de novo.</p>
                    ) : (
                      <ul className="gh-pick is-branches">
                        {heads.slice(0, 20).map((r) => {
                          const has = open.get(r.name)
                          return (
                            <li key={r.name}>
                              <button className={head === r.name ? 'is-on' : ''} onClick={() => (has ? void openExternal(has.url) : pickHead(r.name))}>
                                <span>{r.name}</span>
                                <small>{has ? `já tem o PR #${has.number}` : r.target.committedDate ? `commit há ${rel(r.target.committedDate)} · ${r.target.messageHeadline ?? ''}` : ''}</small>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {head && (
                      <p className="gh-into">
                        <b>{head}</b> → <input value={base} onChange={(e) => setBase(e.target.value)} aria-label="Branch de destino" />
                      </p>
                    )}
                  </div>
                </div>
              )}
              {head && (
                <div className="gh-step">
                  <span className="gh-step-n">3</span>
                  <div className="gh-step-b">
                    <label>Título e descrição</label>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do PR" />
                    <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="O que muda, como testar, chamado relacionado…" />
                    <label className="gh-draft">
                      <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> abrir como rascunho
                    </label>
                  </div>
                </div>
              )}
            </div>
            {err && <p className="gh-err">{err}</p>}
            <footer>
              <span className="gh-muted">Sai pela conta @{login}, sem trocar a conta ativa do gh.</span>
              <button className="gh-new" disabled={!head || !title.trim() || busy} onClick={() => void submit()}>
                {busy ? 'Abrindo…' : 'Abrir PR'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function Guardian({ companies, login: account }: { companies: Company[]; login: string }) {
  const s = useGhSettings()
  const [base, setBase] = useState(s.base)
  const [repos, setRepos] = useState<LocalRepo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fixing, setFixing] = useState<string | null>(null)

  const scan = async () => {
    setBusy(true)
    setErr(null)
    try {
      setGh({ base })
      setRepos(await gh.scan(base))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const stationOf = (r: LocalRepo): string | null => {
    if (s.repos[r.path]) return s.repos[r.path]
    const owner = r.repo?.split('/')[0]?.toLowerCase()
    const hit = Object.entries(s.stations).find(([, login]) => login && login.toLowerCase() === owner)
    return hit ? hit[0] : null
  }

  const verdict = (r: LocalRepo) => {
    const co = stationOf(r)
    const login = co ? s.stations[co] : null
    if (!r.repo) return { tone: 'off', text: 'sem remoto no GitHub' }
    if (!co || !login) return { tone: 'off', text: 'escolha a estação' }
    const person = s.people[login]
    if (r.ssh) return { tone: 'warn', text: 'remoto SSH: o push usa a chave SSH, não a conta' }
    if (r.account !== login) return { tone: 'bad', text: r.account ? `push sairia como @${r.account}` : 'push sairia pela conta ativa do gh' }
    if (person && r.emailCfg !== person.email) return { tone: 'bad', text: `commits sairiam como ${r.emailCfg ?? 'sem e-mail'}` }
    return { tone: 'ok', text: `commits e push como @${login}` }
  }

  const fix = async (r: LocalRepo) => {
    const co = stationOf(r)
    const login = co ? s.stations[co] : null
    if (!co || !login) return
    const person = s.people[login] ?? { name: login, email: `${login}@users.noreply.github.com` }
    setFixing(r.path)
    try {
      const updated = await gh.applyIdentity(r.path, login, person.name, person.email)
      setRepos((list) => (list ?? []).map((x) => (x.path === r.path ? updated : x)))
      setGh({ repos: { ...s.repos, [r.path]: co } })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setFixing(null)
    }
  }

  const mine = (repos ?? []).filter((r) => {
    const co = stationOf(r)
    return !co || s.stations[co] === account
  })
  const others = (repos ?? []).length - mine.length
  const bad = mine.filter((r) => verdict(r).tone === 'bad').length

  return (
    <section className="gh-guard reveal" style={{ ['--i' as string]: 6 }}>
      <header className="gh-h">
        <span className="gh-k">Guardião de identidade · @{account}</span>
        <span className="gh-hint">repositórios locais desta conta commitam e fazem push com ela</span>
      </header>
      <form
        className="gh-scan"
        onSubmit={(e) => {
          e.preventDefault()
          void scan()
        }}
      >
        <input value={base} onChange={(e) => setBase(e.target.value)} aria-label="Pasta com os repositórios" />
        <button className="gh-new" disabled={busy}>
          {busy ? 'Procurando…' : repos ? 'Procurar de novo' : 'Procurar repositórios'}
        </button>
        {repos && (
          <span className="gh-muted">
            {mine.length} de @{account}
            {bad ? ` · ${bad} com a conta errada` : ' · tudo certo'}
            {others ? ` · ${others} de outras contas ocultos` : ''}
          </span>
        )}
      </form>
      {err && <p className="gh-err">{err}</p>}
      {mine.length > 0 && (
        <ul className="gh-locals">
          {mine.map((r) => {
            const v = verdict(r)
            const co = stationOf(r)
            return (
              <li key={r.path} className={`is-${v.tone}`}>
                <div className="gh-local-n">
                  <b>{r.name}</b>
                  <small>
                    {r.repo ?? r.remote ?? 'sem remoto'}
                    {r.branch ? ` · ${r.branch}` : ''}
                  </small>
                </div>
                <select value={co ?? ''} onChange={(e) => setGh({ repos: { ...s.repos, [r.path]: e.target.value } })} aria-label={`Estação de ${r.name}`}>
                  <option value="">estação…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {s.stations[c.id] ? ` · @${s.stations[c.id]}` : ' · sem conta'}
                    </option>
                  ))}
                </select>
                <span className={`gh-verdict is-${v.tone}`}>
                  <i aria-hidden="true" />
                  {v.text}
                </span>
                {v.tone === 'bad' && (
                  <button className="gh-fix" onClick={() => void fix(r)} disabled={fixing === r.path}>
                    {fixing === r.path ? 'Acertando…' : 'Acertar'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
