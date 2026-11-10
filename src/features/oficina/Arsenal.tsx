import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { isTauri } from '../../shared/db/api'
import { Icon } from '../work/icons'
import { useGhSettings } from '../work/github/api'
import { ToolMark } from '../work/sessions/Sessions'
import { PERSONAL_ID, type Company } from '../work/types'
import { BASE_DEFAULT, MCP_PRESETS, cachedSkills, cofreOf, isBase as inBase, listSkills, loadSettings, patchCofre, patchSettings, slug, useSettings, type Mcp, type SkillInfo } from './cofre'
import { PERSONA, closeAgent, useOficina } from './store'

type Tab = 'contas' | 'jeito' | 'skills' | 'ferramentas' | 'motores'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'contas', label: 'Contas', hint: 'GitHub, Claude e Codex deste perfil' },
  { id: 'jeito', label: 'Jeito e fluxo', hint: 'Como o agente fala e trabalha' },
  { id: 'skills', label: 'Skills', hint: 'O que entra em cada conversa' },
  { id: 'ferramentas', label: 'Ferramentas', hint: 'Servidores MCP do perfil' },
  { id: 'motores', label: 'Motores', hint: 'Versões e atualização' },
]

function Section({ title, sub, children, aside }: { title: string; sub?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="ars-sec">
      <header>
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function Arsenal({ companies, scope }: { companies: Company[]; scope: string }) {
  const [tab, setTab] = useState<Tab>('contas')
  const co = scope === 'all' ? PERSONAL_ID : scope
  const company = companies.find((c) => c.id === co)
  useEffect(() => {
    void loadSettings()
  }, [])
  return (
    <section className="ars">
      <header className="ars-head">
        <div>
          <div className="ars-k">Arsenal do perfil</div>
          <h2 className="display">
            {company?.name ?? 'Pessoal'}
            {scope === 'all' && <em> · configurando o Pessoal</em>}
          </h2>
          <p>Tudo aqui vale só para as sessões deste perfil. Nada muda na configuração do Claude ou do Codex fora do Alfred.</p>
        </div>
      </header>
      <nav className="ars-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
            <b>{t.label}</b>
            <small>{t.hint}</small>
          </button>
        ))}
      </nav>
      <div className="ars-body" key={tab}>
        {tab === 'contas' && <Contas co={co} />}
        {tab === 'jeito' && <Jeito co={co} />}
        {tab === 'skills' && <Skills co={co} />}
        {tab === 'ferramentas' && <Ferramentas co={co} />}
        {tab === 'motores' && <Motores />}
      </div>
    </section>
  )
}

function Contas({ co }: { co: string }) {
  const s = useSettings()
  const gs = useGhSettings()
  const c = cofreOf(co)
  const [tokenFor, setTokenFor] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [has, setHas] = useState<Record<string, boolean>>({})
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'claude' | 'codex' | null>(null)

  useEffect(() => {
    if (!isTauri) return
    void Promise.all(s.accounts.claude.map(async (a) => [a.id, await invoke<boolean>('oficina_claude_token', { token: null, account: a.id }).catch(() => false)] as const)).then((l) => setHas(Object.fromEntries(l)))
  }, [s.accounts.claude.length, tokenFor])

  const saveToken = async (id: string) => {
    setMsg(null)
    try {
      await invoke('oficina_claude_token', { token, account: id })
      setToken('')
      setTokenFor(null)
      setMsg('Token salvo no Keychain.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const add = () => {
    if (!kind || !label.trim()) return
    const id = slug(label)
    const list = s.accounts[kind]
    if (list.some((a) => a.id === id)) return setMsg('Já existe uma conta com esse nome.')
    patchSettings({ accounts: { ...s.accounts, [kind]: [...list, { id, label: label.trim() }] } })
    setLabel('')
    setKind(null)
    if (kind === 'codex') void invoke('sessao_codex_account', { id }).catch(() => {})
  }

  const station = gs.stations[co]
  return (
    <div className="ars-grid">
      <Section title="GitHub" sub="A conta que abre PR e assina commits neste perfil. Muda em Workstation › GitHub › Estações.">
        <div className="ars-acct">
          <span className="ars-ic">
            <Icon name="link" size={14} />
          </span>
          <div>
            <b>{station ? `@${station}` : 'Nenhuma conta ligada'}</b>
            <small>{station ? 'estação deste perfil' : 'ligue uma conta na estação'}</small>
          </div>
        </div>
      </Section>

      <Section title="Claude" sub="Cada conta usa um token da assinatura (claude setup-token). Quando o limite estourar, a conversa continua em outra conta." aside={<button className="ars-btn" onClick={() => setKind('claude')}><Icon name="plus" size={11} /> Conta</button>}>
        {s.accounts.claude.map((a) => (
          <div key={a.id} className={`ars-acct ${c.claudeAccount === a.id ? 'is-on' : ''}`}>
            <ToolMark tool="claude" size={14} />
            <div>
              <b>{a.label}</b>
              <small>{has[a.id] ? 'token no Keychain' : 'sem token: usa o login do Claude Code'}</small>
            </div>
            <span className="ofc-grow" />
            {c.claudeAccount === a.id ? (
              <em className="ars-pill">padrão deste perfil</em>
            ) : (
              <button className="ars-link" onClick={() => patchCofre(co, { claudeAccount: a.id })}>
                Usar aqui
              </button>
            )}
            <button className="ars-link" onClick={() => setTokenFor(tokenFor === a.id ? null : a.id)}>
              {has[a.id] ? 'Trocar token' : 'Pôr token'}
            </button>
            {tokenFor === a.id && (
              <div className="ars-token">
                <button className="ars-btn" onClick={() => void invoke('oficina_claude_login').catch((e) => setMsg(String(e)))}>
                  <Icon name="key" size={11} /> Gerar no Terminal
                </button>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-ant-oat…" autoComplete="off" spellCheck={false} />
                <button className="ars-btn is-go" onClick={() => void saveToken(a.id)} disabled={!token.trim()}>
                  Salvar
                </button>
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title="Codex" sub="Cada conta tem a própria pasta de login, mas todas enxergam o mesmo histórico, então dá para continuar a conversa trocando de conta." aside={<button className="ars-btn" onClick={() => setKind('codex')}><Icon name="plus" size={11} /> Conta</button>}>
        {s.accounts.codex.map((a) => (
          <div key={a.id} className={`ars-acct ${c.codexAccount === a.id ? 'is-on' : ''}`}>
            <ToolMark tool="codex" size={14} />
            <div>
              <b>{a.label}</b>
              <small>{a.id === 'default' ? 'a conta já logada no Codex desta máquina' : 'pasta própria do Alfred'}</small>
            </div>
            <span className="ofc-grow" />
            {c.codexAccount === a.id ? (
              <em className="ars-pill">padrão deste perfil</em>
            ) : (
              <button className="ars-link" onClick={() => patchCofre(co, { codexAccount: a.id })}>
                Usar aqui
              </button>
            )}
            {a.id !== 'default' && (
              <button className="ars-link" onClick={() => void invoke('sessao_codex_login', { id: a.id }).catch((e) => setMsg(String(e)))}>
                Entrar
              </button>
            )}
          </div>
        ))}
      </Section>

      {kind && (
        <div className="ars-new">
          <ToolMark tool={kind} size={14} />
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={kind === 'claude' ? 'Nome da conta do Claude (ex.: Max pessoal)' : 'Nome da conta do Codex (ex.: ChatGPT pessoal)'} />
          <button className="ars-btn is-go" onClick={add} disabled={!label.trim()}>
            Adicionar
          </button>
          <button className="ars-link" onClick={() => setKind(null)}>
            Cancelar
          </button>
        </div>
      )}
      {msg && <p className="ars-msg">{msg}</p>}
    </div>
  )
}

function Jeito({ co }: { co: string }) {
  useSettings()
  const c = cofreOf(co)
  const [text, setText] = useState(c.persona ?? PERSONA)
  const dirty = text !== (c.persona ?? PERSONA)
  return (
    <div className="ars-grid">
      <Section title="Fluxo padrão" sub="Como uma desk nova trabalha. Dá para trocar em cada desk.">
        <div className="ars-flows">
          {(
            [
              ['livre', 'Livre', 'Conversa direta: você pede, o agente faz.'],
              ['maivado', 'mAIvado', 'O /maivado decide entre o fluxo rápido e o avançado, com travas e aprovação por etapa.'],
            ] as const
          ).map(([id, name, desc]) => (
            <button key={id} className={c.flow === id ? 'is-on' : ''} onClick={() => patchCofre(co, { flow: id })}>
              <b>{name}</b>
              <small>{desc}</small>
            </button>
          ))}
        </div>
      </Section>
      <Section
        title="Jeito do agente"
        sub="Entra junto de toda sessão deste perfil, nos três agentes."
        aside={
          <span className="ars-row">
            <button className="ars-link" onClick={() => setText(PERSONA)}>
              Voltar ao padrão
            </button>
            <button className="ars-btn is-go" disabled={!dirty} onClick={() => patchCofre(co, { persona: text.trim() === PERSONA.trim() ? null : text })}>
              Salvar
            </button>
          </span>
        }
      >
        <textarea className="ars-persona" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <p className="ars-note">Vale a partir da próxima sessão aberta. Agentes já abertos continuam com o jeito antigo até você fechar.</p>
      </Section>
    </div>
  )
}

function Skills({ co }: { co: string }) {
  const s = useSettings()
  useOficina()
  const c = cofreOf(co)
  const [list, setList] = useState<SkillInfo[] | null>(cachedSkills())
  const [q, setQ] = useState('')
  const [src, setSrc] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    void listSkills().then(setList)
  }, [])
  const on = new Set(c.skills.on)
  const groups = useMemo(() => {
    const out = new Map<string, SkillInfo[]>()
    for (const sk of list ?? []) {
      if (q && !`${sk.id} ${sk.description}`.toLowerCase().includes(q.toLowerCase())) continue
      const g = sk.source === 'user' ? 'Suas skills' : sk.source === 'alfred' ? 'Carregadas no Alfred' : sk.origin
      out.set(g, [...(out.get(g) ?? []), sk])
    }
    return [...out.entries()].sort((a, b) => (a[0] === 'Suas skills' ? -1 : b[0] === 'Suas skills' ? 1 : a[0].localeCompare(b[0])))
  }, [list, q])

  const toggle = (id: string) => {
    const next = new Set(c.skills.on)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    patchCofre(co, { skills: { mode: 'pick', on: [...next] } })
  }
  const toggleBase = (sk: SkillInfo) => patchSettings({ base: inBase(sk, s.base) ? s.base.filter((b) => !inBase(sk, [b])) : [...s.base, sk.id] })
  const missing = list ? BASE_DEFAULT.filter((d) => !list.some((x) => inBase(x, [d]))).map((d) => d.split(':').pop()) : []

  const load = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const names = await invoke<string[]>('sessao_skill_import', { source: src.trim() })
      setSrc('')
      setMsg(`Carregou: ${names.join(', ')}. Liga elas aqui embaixo para este perfil.`)
      setList(await listSkills(true))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ars-grid">
      <Section title="Carregar skill" sub="Cole o link de um repositório do GitHub ou o caminho de uma pasta. O Alfred acha todo SKILL.md lá dentro e guarda na biblioteca dele.">
        <div className="ars-load">
          <input value={src} onChange={(e) => setSrc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && src.trim() && void load()} placeholder="https://github.com/autor/repo  ou  ~/Projetos/minhas-skills" />
          <button className="ars-btn is-go" disabled={!src.trim() || busy} onClick={() => void load()}>
            {busy ? 'Carregando…' : 'Carregar'}
          </button>
        </div>
        {msg && <p className="ars-msg">{msg}</p>}
      </Section>

      <Section
        title="Escolha automática"
        sub="Enquanto você escreve, o Alfred cruza o pedido e os repositórios da desk com a descrição de cada skill ligada aqui e já manda junto as que combinam. Usa o modelo de embeddings do Ollama; sem ele, compara por palavras."
        aside={
          <button role="switch" aria-checked={s.autoSkills !== false} className={`ars-switch ${s.autoSkills !== false ? 'is-on' : ''}`} onClick={() => patchSettings({ autoSkills: s.autoSkills === false })}>
            <span />
          </button>
        }
      >
        <span />
      </Section>

      <Section
        title="Skills deste perfil"
        sub={c.skills.mode === 'all' ? 'Hoje o agente enxerga todas as skills instaladas. Ligue as que fazem sentido para escolher a dedo.' : `${c.skills.on.length} ligadas neste perfil, mais ${s.base.length} da base que vale para todo perfil.`}
        aside={
          <span className="ars-row">
            <label className="ars-find">
              <Icon name="search" size={12} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar skill…" />
            </label>
            {c.skills.mode === 'pick' && (
              <button className="ars-link" onClick={() => patchCofre(co, { skills: { mode: 'all', on: c.skills.on } })}>
                Liberar todas
              </button>
            )}
          </span>
        }
      >
        {!list && <p className="ars-note">Lendo as skills instaladas…</p>}
        {groups.map(([g, items]) => (
          <div key={g} className="ars-group">
            <div className="ars-group-k">
              {g} <em>{items.length}</em>
            </div>
            <div className="ars-skills">
              {items.map((sk, i) => {
                const isBase = inBase(sk, s.base)
                const isOn = isBase || on.has(sk.id) || c.skills.mode === 'all'
                return (
                  <div key={sk.id} className={`ars-skill ${isOn ? 'is-on' : ''} ${isBase ? 'is-base' : ''}`} style={{ ['--k' as string]: i } as CSSProperties}>
                    <button className="ars-skill-main" onClick={() => !isBase && toggle(sk.id)} disabled={isBase} title={isBase ? 'Faz parte da base: sempre ligada em todo chat de todo perfil' : isOn ? 'Desligar neste perfil' : 'Ligar neste perfil'}>
                      <i aria-hidden="true" />
                      <span>
                        <b>{sk.name}</b>
                        <small>{sk.description || 'sem descrição'}</small>
                      </span>
                    </button>
                    <button className={`ars-base ${isBase ? 'is-on' : ''}`} onClick={() => toggleBase(sk)} title={isBase ? 'Tirar da base' : 'Pôr na base: sempre ligada em todo chat'}>
                      base
                    </button>
                    {sk.source === 'alfred' && (
                      <button
                        className="ars-x"
                        onClick={() =>
                          void invoke('sessao_skill_remove', { name: sk.name })
                            .then(() => listSkills(true))
                            .then(setList)
                        }
                        title="Tirar da biblioteca do Alfred"
                      >
                        <Icon name="x" size={10} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {missing.length > 0 && <p className="ars-note">Faltam na base: {missing.join(', ')}. Carregue acima com o link do GitHub de cada uma.</p>}
      </Section>
    </div>
  )
}

function Ferramentas({ co }: { co: string }) {
  useSettings()
  const c = cofreOf(co)
  const [form, setForm] = useState<{ name: string; type: 'stdio' | 'http'; cmd: string; url: string } | null>(null)
  const set = (mcp: Mcp[]) => patchCofre(co, { mcp })
  const has = (name: string) => c.mcp.some((m) => m.name === name)
  const add = () => {
    if (!form || !/^[a-z0-9_-]{1,60}$/i.test(form.name)) return
    const parts = form.cmd.trim().split(/\s+/)
    set([...c.mcp, form.type === 'http' ? { id: crypto.randomUUID(), name: form.name, type: 'http', url: form.url.trim(), on: true } : { id: crypto.randomUUID(), name: form.name, type: 'stdio', command: parts[0], args: parts.slice(1), on: true }])
    setForm(null)
  }
  return (
    <div className="ars-grid">
      <Section title="Ferramentas deste perfil" sub="Servidores MCP que os agentes podem usar nas sessões deste perfil. Valem a partir da próxima sessão aberta." aside={<button className="ars-btn" onClick={() => setForm({ name: '', type: 'stdio', cmd: '', url: '' })}><Icon name="plus" size={11} /> Ferramenta</button>}>
        {c.mcp.length === 0 && <p className="ars-note">Nenhuma ainda. Comece por uma das prontas abaixo.</p>}
        {c.mcp.map((m) => (
          <div key={m.id} className={`ars-acct ${m.on ? 'is-on' : ''}`}>
            <span className="ars-ic">
              <Icon name="gear" size={13} />
            </span>
            <div>
              <b>{m.name}</b>
              <small>{m.type === 'http' ? m.url : [m.command, ...(m.args ?? [])].join(' ')}</small>
            </div>
            <span className="ofc-grow" />
            <button role="switch" aria-checked={m.on} className={`ars-switch ${m.on ? 'is-on' : ''}`} onClick={() => set(c.mcp.map((x) => (x.id === m.id ? { ...x, on: !x.on } : x)))}>
              <span />
            </button>
            <button className="ars-x" onClick={() => set(c.mcp.filter((x) => x.id !== m.id))} title="Remover">
              <Icon name="x" size={10} />
            </button>
          </div>
        ))}
        {form && (
          <div className="ars-mcpform">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="nome (ex.: banco-statix)" />
            <div className="ars-seg">
              {(['stdio', 'http'] as const).map((t) => (
                <button key={t} className={form.type === t ? 'is-on' : ''} onClick={() => setForm({ ...form, type: t })}>
                  {t === 'stdio' ? 'Comando' : 'URL'}
                </button>
              ))}
            </div>
            {form.type === 'stdio' ? <input value={form.cmd} onChange={(e) => setForm({ ...form, cmd: e.target.value })} placeholder="npx -y pacote-do-mcp" /> : <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://servidor/mcp" />}
            <button className="ars-btn is-go" onClick={add}>
              Adicionar
            </button>
            <button className="ars-link" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        )}
      </Section>
      <Section title="Prontas para ligar" sub="Rodam pelo npx: na primeira vez que o agente usar, o pacote é baixado.">
        <div className="ars-presets">
          {MCP_PRESETS.map((p) => (
            <button key={p.name} disabled={has(p.name)} onClick={() => set([...c.mcp, { ...p, id: crypto.randomUUID(), on: true }])}>
              <b>{p.name}</b>
              <small>{p.note}</small>
              <em>{has(p.name) ? 'ligada' : 'ligar'}</em>
            </button>
          ))}
        </div>
      </Section>
    </div>
  )
}

type Engine = { id: string; package: string; installed: string | null; latest: string | null }

function Motores() {
  const { mesas } = useOficina()
  const [data, setData] = useState<{ engines: Engine[]; canRollback: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const load = (check: boolean) =>
    isTauri
      ? invoke<{ engines: Engine[]; canRollback: boolean }>('sessao_engines', { check })
          .then(setData)
          .catch((e) => setMsg(String(e)))
      : Promise.resolve()
  useEffect(() => {
    void load(false)
  }, [])
  const closeAll = async () => {
    for (const m of mesas) for (const a of ['claude', 'codex'] as const) await closeAgent(m.id, a)
  }
  const update = async () => {
    setBusy('update')
    setMsg(null)
    try {
      await closeAll()
      const r = await invoke<{ engines: { id: string; version: string }[]; seconds: number }>('sessao_engines_update')
      setMsg(`Atualizado e testado em ${r.seconds}s: ${r.engines.map((e) => `${e.id} ${e.version}`).join(', ')}. A versão anterior ficou guardada.`)
      await load(true)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const rollback = async () => {
    setBusy('rollback')
    try {
      await closeAll()
      await invoke('sessao_engines_rollback')
      setMsg('Voltou para a versão anterior.')
      await load(false)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const outdated = data?.engines.some((e) => e.latest && e.installed && e.latest !== e.installed)
  return (
    <div className="ars-grid">
      <Section
        title="Motores"
        sub="Os adaptadores que ligam o Alfred ao Claude e ao Codex. Ficam com versão fixa; atualizar baixa a nova numa pasta separada, testa o aperto de mão com cada um e só troca se passar. Se der ruim, volta com um clique."
        aside={
          <span className="ars-row">
            <button className="ars-link" onClick={() => void load(true)} disabled={!!busy}>
              Ver se tem versão nova
            </button>
            {data?.canRollback && (
              <button className="ars-link" onClick={() => void rollback()} disabled={!!busy}>
                Voltar versão
              </button>
            )}
            <button className="ars-btn is-go" onClick={() => void update()} disabled={!!busy}>
              {busy === 'update' ? 'Atualizando…' : 'Atualizar'}
            </button>
          </span>
        }
      >
        {(data?.engines ?? []).map((e) => (
          <div key={e.id} className="ars-acct">
            <ToolMark tool={e.id === 'claude' ? 'claude' : 'codex'} size={14} />
            <div>
              <b>{e.package}</b>
              <small>
                instalado {e.installed ?? '—'}
                {e.latest ? (e.latest === e.installed ? ' · em dia' : ` · nova versão ${e.latest}`) : ''}
              </small>
            </div>
          </div>
        ))}
        {outdated && <p className="ars-note">Tem versão nova. Atualizar fecha os agentes abertos; as conversas continuam salvas.</p>}
        {msg && <p className="ars-msg">{msg}</p>}
      </Section>
    </div>
  )
}
