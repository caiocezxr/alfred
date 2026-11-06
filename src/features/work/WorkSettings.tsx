import { useEffect, useRef, useState } from 'react'
import { CompanyMark, logoUrl } from './brand'
import { Modal } from './Dialogs'
import { SecretsBlock } from './Drawer'
import { Icon } from './icons'
import { checklistFor } from './logic'
import { askPermission, permission, testNotification, type Permission } from './notify'
import {
  checklistAdd, checklistRemove, checklistRename, checklistReorder, companyCreate, companyDelete, companyUpdate, readUi, saveSettings, toast,
  writeUi,
} from './store'
import type { Company, Settings, WorkState } from './types'

type Tab = 'alerts' | 'notify' | 'companies' | 'checklist'

export function WorkSettings({ state, tab: initial, onClose }: { state: WorkState; tab?: Tab; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(initial ?? 'alerts')
  const tabs: { id: Tab; label: string }[] = [
    { id: 'alerts', label: 'Alertas' },
    { id: 'notify', label: 'Notificações' },
    { id: 'companies', label: 'Espaços' },
    { id: 'checklist', label: 'Checklist' },
  ]
  return (
    <Modal label="Ajustes da Workstation" onClose={onClose} className="is-settings">
      <header className="wk-set-head">
        <h2 className="display">Ajustes</h2>
        <button className="btn quiet" onClick={onClose} aria-label="Fechar">
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="wk-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="wk-set-body">
        {tab === 'alerts' && <AlertsTab settings={state.settings} />}
        {tab === 'notify' && <NotifyTab settings={state.settings} />}
        {tab === 'companies' && <CompaniesTab state={state} />}
        {tab === 'checklist' && <ChecklistTab state={state} />}
      </div>
    </Modal>
  )
}

function NumberRow({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="wk-set-row">
      <span>
        <b>{label}</b>
        <em>{hint}</em>
      </span>
      <span className="wk-stepper-num">
        <button onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Diminuir ${label}`} disabled={value <= min}>
          −
        </button>
        <output>{value}</output>
        <button onClick={() => onChange(Math.min(max, value + 1))} aria-label={`Aumentar ${label}`} disabled={value >= max}>
          +
        </button>
      </span>
    </label>
  )
}

function AlertsTab({ settings }: { settings: Settings }) {
  const set = (patch: Partial<Settings>) => void saveSettings({ ...settings, ...patch })
  const days = (n: number) => (n === 0 ? 'na hora' : n === 1 ? '1 dia' : `${n} dias`)
  return (
    <div className="wk-set-list">
      <NumberRow label="Limite em andamento" hint={`Alerta quando houver mais de ${settings.wipLimit} itens em Fazendo`} value={settings.wipLimit} min={1} max={20} onChange={(n) => set({ wipLimit: n })} />
      <NumberRow label="Cobrar validação" hint={`Entregue e sem validação há ${days(settings.validationDays)}`} value={settings.validationDays} min={0} max={60} onChange={(n) => set({ validationDays: n })} />
      <NumberRow label="Aguardando alguém" hint={`Bloqueado há ${days(settings.waitingDays)} sem resposta`} value={settings.waitingDays} min={0} max={60} onChange={(n) => set({ waitingDays: n })} />
      <NumberRow label="Voltou e parado" hint={`Retorno sem retomada há ${days(settings.returnDays)}`} value={settings.returnDays} min={0} max={60} onChange={(n) => set({ returnDays: n })} />
      <NumberRow label="Parado em Fazendo" hint={`Sem nenhum movimento há ${days(settings.staleDays)}`} value={settings.staleDays} min={1} max={60} onChange={(n) => set({ staleDays: n })} />
      <NumberRow label="Validado e aberto" hint={`Falta concluir há ${days(settings.closeDays)}`} value={settings.closeDays} min={0} max={60} onChange={(n) => set({ closeDays: n })} />
    </div>
  )
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="wk-set-row">
      <span>
        <b>{label}</b>
        <em>{hint}</em>
      </span>
      <span className={`wk-switch ${on ? 'is-on' : ''}`}>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span aria-hidden="true" />
      </span>
    </label>
  )
}

function NotifyTab({ settings }: { settings: Settings }) {
  const set = (patch: Partial<Settings>) => void saveSettings({ ...settings, ...patch })
  const [perm, setPerm] = useState<Permission>('default')
  const [sound, setSound] = useState(!!readUi().sound)
  useEffect(() => {
    void permission().then(setPerm)
  }, [])
  const permText: Record<Permission, string> = {
    granted: 'Notificações do sistema permitidas.',
    denied: 'Notificações bloqueadas. Libere em Ajustes do Sistema › Notificações.',
    default: 'Ainda não permitido.',
    unsupported: 'Este ambiente não tem notificações do sistema; os alertas ficam só na tela.',
  }
  return (
    <div className="wk-set-list">
      <div className={`wk-perm is-${perm}`}>
        <Icon name="bell" size={15} />
        <span>{permText[perm]}</span>
        {perm !== 'granted' && perm !== 'unsupported' && (
          <button className="btn" onClick={async () => setPerm(await askPermission())}>
            Permitir
          </button>
        )}
        {perm === 'granted' && (
          <button className="btn quiet" onClick={async () => !(await testNotification()) && toast('Não consegui enviar a notificação', { tone: 'error' })}>
            Testar
          </button>
        )}
      </div>
      <Toggle on={settings.notifyReminders} onChange={(v) => set({ notifyReminders: v })} label="Lembretes de to-dos" hint="Na hora marcada, incluindo os “não pode esquecer”" />
      <Toggle on={settings.notifyDue} onChange={(v) => set({ notifyDue: v })} label="Prazos do dia" hint="Um aviso de manhã com o que vence hoje e o que atrasou" />
      <Toggle on={settings.notifyValidation} onChange={(v) => set({ notifyValidation: v })} label="Cobrar validação" hint="Um aviso de manhã com entregas paradas sem validação" />
      <NumberRow label="Hora do aviso da manhã" hint={`Prazos e validações a partir das ${String(settings.notifyHour).padStart(2, '0')}h`} value={settings.notifyHour} min={0} max={23} onChange={(n) => set({ notifyHour: n })} />
      <Toggle
        on={sound}
        onChange={(v) => {
          setSound(v)
          writeUi({ sound: v })
        }}
        label="Som ao concluir"
        hint="Um toque curto e baixo ao validar, concluir ou resolver"
      />
      <p className="wk-muted">As notificações rodam enquanto o app está aberto. Nenhum segredo aparece nelas.</p>
    </div>
  )
}

function CompanyRow({ c, state }: { c: Company; state: WorkState }) {
  const [name, setName] = useState(c.name)
  const [confirm, setConfirm] = useState(false)
  const [secrets, setSecrets] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => setName(c.name), [c.name])
  const upload = (f: File | undefined) => {
    if (!f) return
    if (f.size > 400 * 1024) return toast('Logo grande demais (até 400 KB)', { tone: 'error' })
    const r = new FileReader()
    r.onload = () => void companyUpdate(c.id, { logo: String(r.result) })
    r.readAsDataURL(f)
  }
  const logo = logoUrl(c)
  return (
    <li className="wk-co-row">
      <div className="wk-co-main">
        <CompanyMark company={c} size={30} />
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== c.name && void companyUpdate(c.id, { name: name.trim() })} aria-label="Nome do espaço" />
        <label className="wk-color" title="Cor">
          <input type="color" value={c.color} onChange={(e) => void companyUpdate(c.id, { color: e.target.value })} aria-label={`Cor de ${c.name}`} />
          <span style={{ background: c.color }} />
        </label>
        <button className="btn quiet" onClick={() => file.current?.click()}>
          Logo
        </button>
        {c.logo && (
          <button className="btn quiet" onClick={() => void companyUpdate(c.id, { logo: null })}>
            Remover logo
          </button>
        )}
        <button className="btn quiet" onClick={() => setSecrets((v) => !v)} aria-expanded={secrets}>
          <Icon name="key" size={13} />
          {state.secrets.filter((s) => s.companyId === c.id).length || ''}
        </button>
        <button className={`btn quiet wk-danger ${confirm ? 'is-confirm' : ''}`} onClick={() => (confirm ? void companyDelete(c.id) : setConfirm(true))} onBlur={() => setConfirm(false)}>
          {confirm ? 'Excluir?' : <Icon name="trash" size={13} />}
        </button>
        <input ref={file} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {logo && <img className="wk-co-logo" src={logo} alt={`Logo ${c.name}`} />}
      {secrets && <SecretsBlock owner={{ companyId: c.id }} secrets={state.secrets.filter((s) => s.companyId === c.id)} />}
    </li>
  )
}

function CompaniesTab({ state }: { state: WorkState }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#3FA7A0')
  return (
    <div className="wk-set-list">
      <ul className="wk-co-list">
        {state.companies.map((c) => (
          <CompanyRow key={c.id} c={c} state={state} />
        ))}
      </ul>
      <div className="wk-co-new">
        <input className="field" value={name} placeholder="Novo espaço (ex.: Freela)" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && (void companyCreate(name.trim(), color), setName(''))} />
        <label className="wk-color">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Cor do novo espaço" />
          <span style={{ background: color }} />
        </label>
        <button
          className="btn"
          disabled={!name.trim()}
          onClick={() => {
            void companyCreate(name.trim(), color)
            setName('')
          }}
        >
          Adicionar
        </button>
      </div>
      <p className="wk-muted">O atalho de captura usa o nome: @{state.companies[0]?.id ?? 'statix'}. Logos em src/assets/companies/&lt;id&gt;-mark.svg são detectados sozinhos.</p>
    </div>
  )
}

function ChecklistTab({ state }: { state: WorkState }) {
  const work = state.companies
  const [co, setCo] = useState(work[0]?.id ?? '')
  const [draft, setDraft] = useState('')
  const list = checklistFor(co, state.checklist)
  const move = (i: number, d: number) => {
    const ids = list.map((x) => x.id)
    const [x] = ids.splice(i, 1)
    ids.splice(i + d, 0, x)
    void checklistReorder(co, ids)
  }
  return (
    <div className="wk-set-list">
      <div className="wk-chips-pick">
        {work.map((c) => (
          <button key={c.id} className={`wk-chip-btn ${co === c.id ? 'is-on' : ''}`} onClick={() => setCo(c.id)} aria-pressed={co === c.id}>
            <CompanyMark company={c} size={13} />
            {c.name}
          </button>
        ))}
      </div>
      <p className="wk-muted">Ao marcar Entregue com algo em aberto, eu pergunto antes. Pendências (tipo “pendência”) não passam pelo checklist.</p>
      <ul className="wk-ck-edit">
        {list.map((c, i) => (
          <ChecklistEditRow key={c.id} id={c.id} label={c.label} first={i === 0} last={i === list.length - 1} onUp={() => move(i, -1)} onDown={() => move(i, 1)} />
        ))}
      </ul>
      <div className="wk-co-new">
        <input
          className="field"
          value={draft}
          placeholder="Novo item (ex.: Conferi o plano de execução)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              void checklistAdd(co, draft.trim())
              setDraft('')
            }
          }}
        />
        <button
          className="btn"
          disabled={!draft.trim()}
          onClick={() => {
            void checklistAdd(co, draft.trim())
            setDraft('')
          }}
        >
          Adicionar
        </button>
      </div>
    </div>
  )
}

function ChecklistEditRow({ id, label, first, last, onUp, onDown }: { id: string; label: string; first: boolean; last: boolean; onUp: () => void; onDown: () => void }) {
  const [v, setV] = useState(label)
  useEffect(() => setV(label), [label])
  return (
    <li className="wk-ck-row">
      <input className="field" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v.trim() !== label && void checklistRename(id, v.trim())} aria-label="Item do checklist" />
      <button className="wk-icon-btn" onClick={onUp} disabled={first} aria-label="Subir">
        <Icon name="up" size={13} />
      </button>
      <button className="wk-icon-btn" onClick={onDown} disabled={last} aria-label="Descer">
        <Icon name="down" size={13} />
      </button>
      <button className="wk-icon-btn" onClick={() => void checklistRemove(id)} aria-label="Remover">
        <Icon name="trash" size={13} />
      </button>
    </li>
  )
}
