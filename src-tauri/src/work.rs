use crate::commands::{AppState, NOW, R, new_id, with_conn};
use crate::notes::{base64, sniff_image};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::State;

const STAGES: &[&str] = &["todo", "doing", "delivered", "tested", "validated", "done"];
const KINDS: &[&str] = &["chamado", "feature", "bug", "melhoria", "pendencia"];
const PRIORITIES: &[&str] = &["normal", "alta", "urgente"];
const FOCUS_MAX: i64 = 3;
const ASSET_DIR: &str = "work-assets";
const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
const KEYCHAIN_SERVICE: &str = "app.personalspace.work";
const SECRET_MAX: usize = 4000;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    id: String,
    name: String,
    color: String,
    logo: Option<String>,
    sort: f64,
    ticket_url: Option<String>,
    sla_response_min: Option<i64>,
    sla_resolution_min: Option<i64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub company_id: String,
    pub title: String,
    pub body: String,
    pub is_default: bool,
    pub sort: f64,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnippetInput {
    pub id: Option<String>,
    pub company_id: String,
    pub title: String,
    pub body: String,
    pub is_default: Option<bool>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistEntry {
    id: String,
    company_id: String,
    label: String,
    sort: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub wip_limit: i64,
    pub validation_days: i64,
    pub waiting_days: i64,
    pub stale_days: i64,
    pub return_days: i64,
    pub close_days: i64,
    pub notify_reminders: bool,
    pub notify_due: bool,
    pub notify_validation: bool,
    pub notify_hour: i64,
    #[serde(default = "yes")]
    pub notify_neglect: bool,
    #[serde(default = "eleven")]
    pub neglect_hour: i64,
    #[serde(default = "three")]
    pub neglect_days: i64,
    #[serde(default = "twenty")]
    pub quiet_start: i64,
    #[serde(default = "eight")]
    pub quiet_end: i64,
}

fn yes() -> bool {
    true
}
fn eleven() -> i64 {
    11
}
fn three() -> i64 {
    3
}
fn twenty() -> i64 {
    20
}
fn eight() -> i64 {
    8
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Seen {
    pub company_id: String,
    pub seen_at: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub company_id: String,
    pub title: String,
    pub ticket: Option<String>,
    pub url: Option<String>,
    pub kind: String,
    pub system: Option<String>,
    pub priority: String,
    pub due_date: Option<String>,
    pub notes: String,
    pub requester: Option<String>,
    pub stage: String,
    pub stage_at: String,
    pub delivered_at: Option<String>,
    pub tested_at: Option<String>,
    pub validated_at: Option<String>,
    pub done_at: Option<String>,
    pub waiting_on: Option<String>,
    pub waiting_since: Option<String>,
    pub returns: i64,
    pub returned_at: Option<String>,
    pub return_open: bool,
    pub followup_at: Option<String>,
    pub snoozed_until: Option<String>,
    pub focused_at: Option<String>,
    pub sort: f64,
    pub created_at: String,
    pub updated_at: String,
    pub checks: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub item_id: String,
    pub kind: String,
    pub from_stage: Option<String>,
    pub to_stage: Option<String>,
    pub note: String,
    pub pending: Option<i64>,
    pub at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkState {
    companies: Vec<Company>,
    checklist: Vec<ChecklistEntry>,
    items: Vec<Item>,
    events: Vec<Event>,
    settings: Settings,
    todos: Vec<Todo>,
    todo_checks: Vec<TodoCheck>,
    attachments: Vec<Attachment>,
    secrets: Vec<SecretMeta>,
    days: Vec<DayMark>,
    sessions: Vec<Session>,
    snippets: Vec<Snippet>,
    seen: Vec<Seen>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ItemChange {
    pub item: Item,
    pub events: Vec<Event>,
    pub sessions: Vec<Session>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub item_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TimerChange {
    pub item_ids: Vec<String>,
    pub sessions: Vec<Session>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewItem {
    pub company_id: String,
    pub title: String,
    pub ticket: Option<String>,
    pub url: Option<String>,
    pub kind: Option<String>,
    pub system: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
    pub requester: Option<String>,
    pub stage: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    pub company_id: Option<String>,
    pub title: Option<String>,
    #[serde(default, with = "double_option")]
    pub ticket: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub url: Option<Option<String>>,
    pub kind: Option<String>,
    #[serde(default, with = "double_option")]
    pub system: Option<Option<String>>,
    pub priority: Option<String>,
    #[serde(default, with = "double_option")]
    pub due_date: Option<Option<String>>,
    pub notes: Option<String>,
    #[serde(default, with = "double_option")]
    pub requester: Option<Option<String>>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompanyPatch {
    pub name: Option<String>,
    pub color: Option<String>,
    #[serde(default, with = "double_option")]
    pub logo: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub ticket_url: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub sla_response_min: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub sla_resolution_min: Option<Option<i64>>,
}

mod double_option {
    use serde::{Deserialize, Deserializer};
    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
        Deserialize::deserialize(d).map(Some)
    }
}

type Res<T> = Result<T, String>;

fn db<T>(r: rusqlite::Result<T>) -> Res<T> {
    r.map_err(|e| e.to_string())
}

fn stage_index(s: &str) -> Option<usize> {
    STAGES.iter().position(|x| *x == s)
}

fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && d.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && (1..=12).contains(&d[5..7].parse::<u32>().unwrap_or(0))
        && (1..=31).contains(&d[8..10].parse::<u32>().unwrap_or(0))
}

fn valid_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())
}

fn clip(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

fn required(s: &str, max: usize, what: &str) -> Res<String> {
    let t = clip(s, max);
    if t.is_empty() { Err(format!("{what} não pode ficar vazio")) } else { Ok(t) }
}

fn optional(s: Option<String>, max: usize) -> Option<String> {
    s.map(|v| clip(&v, max)).filter(|v| !v.is_empty())
}

fn opt_url(s: Option<String>) -> Res<Option<String>> {
    match optional(s, 2048) {
        None => Ok(None),
        Some(u) => {
            let l = u.to_lowercase();
            let ok = (l.starts_with("https://") && u.len() > 8) || (l.starts_with("http://") && u.len() > 7);
            if ok && !u.chars().any(char::is_whitespace) { Ok(Some(u)) } else { Err("o link precisa começar com http:// ou https://".into()) }
        }
    }
}

fn opt_date(s: Option<String>) -> Res<Option<String>> {
    match s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(d) if valid_date(&d) => Ok(Some(d)),
        Some(_) => Err("data inválida".into()),
    }
}

fn one_of(v: &str, list: &[&str], what: &str) -> Res<String> {
    if list.contains(&v) { Ok(v.to_string()) } else { Err(format!("{what} inválido: {v}")) }
}

fn slugify(name: &str) -> String {
    let mut out = String::new();
    for ch in name.trim().to_lowercase().chars() {
        let c = match ch {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_end_matches('-').chars().take(32).collect()
}

const ITEM_COLS: &str = "id, company_id, title, ticket, url, kind, system, priority, due_date, notes, requester, stage, stage_at,
    delivered_at, tested_at, validated_at, done_at, waiting_on, waiting_since, returns, returned_at, return_open,
    followup_at, snoozed_until, focused_at, sort, created_at, updated_at";

fn item_from(r: &Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: r.get(0)?,
        company_id: r.get(1)?,
        title: r.get(2)?,
        ticket: r.get(3)?,
        url: r.get(4)?,
        kind: r.get(5)?,
        system: r.get(6)?,
        priority: r.get(7)?,
        due_date: r.get(8)?,
        notes: r.get(9)?,
        requester: r.get(10)?,
        stage: r.get(11)?,
        stage_at: r.get(12)?,
        delivered_at: r.get(13)?,
        tested_at: r.get(14)?,
        validated_at: r.get(15)?,
        done_at: r.get(16)?,
        waiting_on: r.get(17)?,
        waiting_since: r.get(18)?,
        returns: r.get(19)?,
        returned_at: r.get(20)?,
        return_open: r.get::<_, i64>(21)? == 1,
        followup_at: r.get(22)?,
        snoozed_until: r.get(23)?,
        focused_at: r.get(24)?,
        sort: r.get(25)?,
        created_at: r.get(26)?,
        updated_at: r.get(27)?,
        checks: Vec::new(),
    })
}

const EVENT_COLS: &str = "id, item_id, kind, from_stage, to_stage, note, pending, at";

fn event_from(r: &Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get(0)?,
        item_id: r.get(1)?,
        kind: r.get(2)?,
        from_stage: r.get(3)?,
        to_stage: r.get(4)?,
        note: r.get(5)?,
        pending: r.get(6)?,
        at: r.get(7)?,
    })
}

fn checks_of(c: &Connection, item_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut st = c.prepare(
        "SELECT k.check_id FROM work_item_checks k JOIN work_checklist l ON l.id = k.check_id
         WHERE k.item_id = ?1 AND l.archived_at IS NULL ORDER BY l.sort",
    )?;
    st.query_map(params![item_id], |r| r.get(0))?.collect()
}

fn find_item(c: &Connection, id: &str) -> Res<Item> {
    let it = db(c
        .query_row(&format!("SELECT {ITEM_COLS} FROM work_items WHERE id = ?1"), params![id], item_from)
        .optional())?;
    let mut it = it.ok_or_else(|| "item não encontrado".to_string())?;
    it.checks = db(checks_of(c, id))?;
    Ok(it)
}

fn events_of(c: &Connection, item_id: &str) -> rusqlite::Result<Vec<Event>> {
    let mut st = c.prepare(&format!("SELECT {EVENT_COLS} FROM work_events WHERE item_id = ?1 ORDER BY at, rowid"))?;
    st.query_map(params![item_id], event_from)?.collect()
}

fn change(c: &Connection, id: &str) -> Res<ItemChange> {
    Ok(ItemChange { item: find_item(c, id)?, events: db(events_of(c, id))?, sessions: list_sessions(c, Some(id))? })
}

fn log(c: &Connection, item_id: &str, kind: &str, from: Option<&str>, to: Option<&str>, note: &str, pending: Option<i64>) -> Res<()> {
    db(c.execute(
        "INSERT INTO work_events (id, item_id, kind, from_stage, to_stage, note, pending) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![new_id(), item_id, kind, from, to, clip(note, 1000), pending],
    ))?;
    Ok(())
}

fn company_exists(c: &Connection, id: &str) -> Res<bool> {
    db(c.query_row("SELECT EXISTS (SELECT 1 FROM work_companies WHERE id = ?1)", params![id], |r| r.get(0)))
}

fn pending_count(c: &Connection, item: &Item) -> Res<i64> {
    if item.kind == "pendencia" {
        return Ok(0);
    }
    db(c.query_row(
        "SELECT COUNT(*) FROM work_checklist l
         WHERE l.company_id = ?1 AND l.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM work_item_checks k WHERE k.item_id = ?2 AND k.check_id = l.id)",
        params![item.company_id, item.id],
        |r| r.get(0),
    ))
}

pub fn load(c: &Connection) -> Res<WorkState> {
    let companies = {
        let mut st = db(c.prepare(&format!("SELECT {COMPANY_COLS} FROM work_companies ORDER BY sort, name")))?;
        db(st.query_map([], company_from).and_then(|m| m.collect()))?
    };
    let checklist = list_checklist(c)?;
    let mut items: Vec<Item> = {
        let mut st = db(c.prepare(&format!("SELECT {ITEM_COLS} FROM work_items ORDER BY sort")))?;
        db(st.query_map([], item_from).and_then(|m| m.collect()))?
    };
    {
        let mut st = db(c.prepare(
            "SELECT k.item_id, k.check_id FROM work_item_checks k JOIN work_checklist l ON l.id = k.check_id
             WHERE l.archived_at IS NULL ORDER BY l.sort",
        ))?;
        let pairs: Vec<(String, String)> = db(st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).and_then(|m| m.collect()))?;
        let mut by: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for (i, k) in pairs {
            by.entry(i).or_default().push(k);
        }
        for it in items.iter_mut() {
            if let Some(v) = by.remove(&it.id) {
                it.checks = v;
            }
        }
    }
    let events = {
        let mut st = db(c.prepare(&format!("SELECT {EVENT_COLS} FROM work_events ORDER BY at, rowid")))?;
        db(st.query_map([], event_from).and_then(|m| m.collect()))?
    };
    Ok(WorkState {
        companies,
        checklist,
        items,
        events,
        settings: get_settings(c)?,
        todos: list_todos(c)?,
        todo_checks: list_todo_checks(c, None)?,
        attachments: list_attachments(c, None)?,
        secrets: list_secrets(c)?,
        days: list_days(c)?,
        sessions: list_sessions(c, None)?,
        snippets: list_snippets(c)?,
        seen: list_seen(c)?,
    })
}

pub fn create(c: &mut Connection, input: NewItem) -> Res<ItemChange> {
    let company = clip(&input.company_id, 40);
    if !company_exists(c, &company)? {
        return Err("empresa desconhecida".into());
    }
    let title = required(&input.title, 300, "o título")?;
    let kind = one_of(input.kind.as_deref().unwrap_or("chamado"), KINDS, "tipo")?;
    let priority = one_of(input.priority.as_deref().unwrap_or("normal"), PRIORITIES, "prioridade")?;
    let stage = input.stage.as_deref().unwrap_or("todo");
    if stage != "todo" && stage != "doing" {
        return Err("um item novo começa em A fazer ou Fazendo".into());
    }
    let url = opt_url(input.url)?;
    let due = opt_date(input.due_date)?;
    let id = new_id();
    let tx = db(c.transaction())?;
    db(tx.execute(
        "INSERT INTO work_items (id, company_id, title, ticket, url, kind, system, priority, due_date, notes, requester, stage, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, (SELECT COALESCE(MIN(sort), 1) - 1 FROM work_items))",
        params![
            id,
            company,
            title,
            optional(input.ticket, 40),
            url,
            kind,
            optional(input.system, 80),
            priority,
            due,
            input.notes.map(|n| clip(&n, 4000)).unwrap_or_default(),
            optional(input.requester, 80),
            stage
        ],
    ))?;
    log(&tx, &id, "created", None, Some(stage), "", None)?;
    db(tx.commit())?;
    change(c, &id)
}

pub fn update(c: &mut Connection, id: &str, p: ItemPatch) -> Res<ItemChange> {
    let cur = find_item(c, id)?;
    let tx = db(c.transaction())?;
    if let Some(company) = p.company_id.map(|v| clip(&v, 40)).filter(|v| *v != cur.company_id) {
        if !company_exists(&tx, &company)? {
            return Err("empresa desconhecida".into());
        }
        db(tx.execute("DELETE FROM work_item_checks WHERE item_id = ?1", params![id]))?;
        db(tx.execute("UPDATE work_items SET company_id = ?2 WHERE id = ?1", params![id, company]))?;
    }
    if let Some(t) = p.title {
        db(tx.execute("UPDATE work_items SET title = ?2 WHERE id = ?1", params![id, required(&t, 300, "o título")?]))?;
    }
    if let Some(v) = p.ticket {
        db(tx.execute("UPDATE work_items SET ticket = ?2 WHERE id = ?1", params![id, optional(v, 40)]))?;
    }
    if let Some(v) = p.url {
        db(tx.execute("UPDATE work_items SET url = ?2 WHERE id = ?1", params![id, opt_url(v)?]))?;
    }
    if let Some(v) = p.kind {
        db(tx.execute("UPDATE work_items SET kind = ?2 WHERE id = ?1", params![id, one_of(&v, KINDS, "tipo")?]))?;
    }
    if let Some(v) = p.system {
        db(tx.execute("UPDATE work_items SET system = ?2 WHERE id = ?1", params![id, optional(v, 80)]))?;
    }
    if let Some(v) = p.priority {
        db(tx.execute("UPDATE work_items SET priority = ?2 WHERE id = ?1", params![id, one_of(&v, PRIORITIES, "prioridade")?]))?;
    }
    if let Some(v) = p.due_date {
        let due = opt_date(v)?;
        if due != cur.due_date {
            db(tx.execute("UPDATE work_items SET due_date = ?2 WHERE id = ?1", params![id, due]))?;
            log(&tx, id, "due", None, None, due.as_deref().unwrap_or(""), None)?;
        }
    }
    if let Some(v) = p.notes {
        db(tx.execute("UPDATE work_items SET notes = ?2 WHERE id = ?1", params![id, clip(&v, 4000)]))?;
    }
    if let Some(v) = p.requester {
        db(tx.execute("UPDATE work_items SET requester = ?2 WHERE id = ?1", params![id, optional(v, 80)]))?;
    }
    db(tx.execute(&format!("UPDATE work_items SET updated_at = {NOW} WHERE id = ?1"), params![id]))?;
    db(tx.commit())?;
    change(c, id)
}

pub fn delete(c: &mut Connection, data_dir: &Path, vault: &dyn Vault, id: &str) -> Res<()> {
    let files: Vec<String> = {
        let mut st = db(c.prepare("SELECT rel_path FROM work_attachments WHERE item_id = ?1"))?;
        db(st.query_map(params![id], |r| r.get(0)).and_then(|m| m.collect()))?
    };
    let secrets: Vec<String> = {
        let mut st = db(c.prepare("SELECT id FROM work_secrets WHERE item_id = ?1"))?;
        db(st.query_map(params![id], |r| r.get(0)).and_then(|m| m.collect()))?
    };
    let n = db(c.execute("DELETE FROM work_items WHERE id = ?1", params![id]))?;
    if n == 0 {
        return Err("item não encontrado".into());
    }
    for rel in files {
        if safe_rel(&rel) {
            fs::remove_file(data_dir.join(rel)).ok();
        }
    }
    for sid in secrets {
        vault.delete(&sid).ok();
    }
    Ok(())
}

pub fn move_stage(c: &mut Connection, id: &str, to: &str, force: bool, note: Option<String>) -> Res<ItemChange> {
    let to_i = stage_index(to).ok_or_else(|| format!("estágio inválido: {to}"))?;
    let cur = find_item(c, id)?;
    if cur.stage == to {
        return change(c, id);
    }
    let from_i = stage_index(&cur.stage).unwrap_or(0);
    let crossing = from_i < 2 && to_i >= 2;
    let pending = if crossing { Some(pending_count(c, &cur)?) } else { None };
    if let Some(n) = pending {
        if n > 0 && !force {
            return Err(format!("checklist pendente: {n} {} antes de entregar", if n == 1 { "item" } else { "itens" }));
        }
    }
    let tx = db(c.transaction())?;
    db(tx.execute(
        &format!(
            "UPDATE work_items SET
               stage = ?2,
               stage_at = {NOW},
               delivered_at = CASE WHEN ?3 < 2 THEN NULL WHEN ?4 THEN {NOW} ELSE COALESCE(delivered_at, {NOW}) END,
               tested_at = CASE WHEN ?3 < 3 THEN NULL WHEN ?2 = 'tested' THEN {NOW} ELSE tested_at END,
               validated_at = CASE WHEN ?3 < 4 THEN NULL WHEN ?2 = 'validated' THEN {NOW} ELSE validated_at END,
               done_at = CASE WHEN ?3 < 5 THEN NULL ELSE {NOW} END,
               return_open = CASE WHEN ?4 OR ?3 = 5 THEN 0 ELSE return_open END,
               waiting_on = CASE WHEN ?3 = 5 THEN NULL ELSE waiting_on END,
               waiting_since = CASE WHEN ?3 = 5 THEN NULL ELSE waiting_since END,
               focused_at = CASE WHEN ?3 = 5 THEN NULL ELSE focused_at END,
               followup_at = NULL,
               snoozed_until = NULL,
               updated_at = {NOW}
             WHERE id = ?1"
        ),
        params![id, to, to_i as i64, crossing],
    ))?;
    if to_i >= 2 {
        db(tx.execute(&format!("UPDATE work_sessions SET ended_at = {NOW} WHERE item_id = ?1 AND ended_at IS NULL"), params![id]))?;
    }
    log(&tx, id, "stage", Some(&cur.stage), Some(to), note.as_deref().unwrap_or(""), pending)?;
    db(tx.commit())?;
    change(c, id)
}

pub fn give_back(c: &mut Connection, id: &str, reason: &str) -> Res<ItemChange> {
    let cur = find_item(c, id)?;
    if stage_index(&cur.stage).unwrap_or(0) < 2 {
        return Err("só volta o que já foi entregue".into());
    }
    let reason = clip(reason, 1000);
    if reason.is_empty() {
        return Err("diga por que voltou".into());
    }
    let tx = db(c.transaction())?;
    db(tx.execute(
        &format!(
            "UPDATE work_items SET stage = 'doing', stage_at = {NOW}, returns = returns + 1, returned_at = {NOW}, return_open = 1,
               delivered_at = NULL, tested_at = NULL, validated_at = NULL, done_at = NULL,
               waiting_on = NULL, waiting_since = NULL, followup_at = NULL, snoozed_until = NULL, updated_at = {NOW}
             WHERE id = ?1"
        ),
        params![id],
    ))?;
    db(tx.execute("DELETE FROM work_item_checks WHERE item_id = ?1", params![id]))?;
    log(&tx, id, "returned", Some(&cur.stage), Some("doing"), &reason, None)?;
    db(tx.commit())?;
    change(c, id)
}

pub fn resume(c: &mut Connection, id: &str) -> Res<ItemChange> {
    let cur = find_item(c, id)?;
    if !cur.return_open {
        return change(c, id);
    }
    let tx = db(c.transaction())?;
    db(tx.execute(
        &format!(
            "UPDATE work_items SET return_open = 0, snoozed_until = NULL,
               stage = CASE WHEN stage = 'todo' THEN 'doing' ELSE stage END,
               stage_at = CASE WHEN stage = 'todo' THEN {NOW} ELSE stage_at END,
               updated_at = {NOW}
             WHERE id = ?1"
        ),
        params![id],
    ))?;
    log(&tx, id, "resumed", None, None, "", None)?;
    db(tx.commit())?;
    change(c, id)
}

pub fn set_waiting(c: &mut Connection, id: &str, on: Option<String>) -> Res<ItemChange> {
    let cur = find_item(c, id)?;
    let on = optional(on, 120);
    match (&on, &cur.waiting_on) {
        (Some(_), _) if cur.stage == "done" => return Err("item concluído não fica aguardando".into()),
        (Some(who), Some(prev)) if who == prev => return change(c, id),
        (None, None) => return change(c, id),
        _ => {}
    }
    let tx = db(c.transaction())?;
    match on {
        Some(who) => {
            db(tx.execute(
                &format!("UPDATE work_items SET waiting_on = ?2, waiting_since = {NOW}, followup_at = NULL, updated_at = {NOW} WHERE id = ?1"),
                params![id, who],
            ))?;
            log(&tx, id, "waiting", None, None, &who, None)?;
        }
        None => {
            let prev = cur.waiting_on.unwrap_or_default();
            db(tx.execute(
                &format!("UPDATE work_items SET waiting_on = NULL, waiting_since = NULL, followup_at = NULL, updated_at = {NOW} WHERE id = ?1"),
                params![id],
            ))?;
            log(&tx, id, "unblocked", None, None, &prev, None)?;
        }
    }
    db(tx.commit())?;
    change(c, id)
}

pub fn follow_up(c: &mut Connection, id: &str, note: Option<String>) -> Res<ItemChange> {
    let cur = find_item(c, id)?;
    if cur.stage == "done" {
        return Err("item já concluído".into());
    }
    let tx = db(c.transaction())?;
    db(tx.execute(&format!("UPDATE work_items SET followup_at = {NOW}, updated_at = {NOW} WHERE id = ?1"), params![id]))?;
    log(&tx, id, "followup", None, None, note.as_deref().unwrap_or(""), None)?;
    db(tx.commit())?;
    change(c, id)
}

pub fn add_note(c: &Connection, id: &str, text: &str) -> Res<ItemChange> {
    find_item(c, id)?;
    let t = clip(text, 1000);
    if t.is_empty() {
        return Err("a anotação está vazia".into());
    }
    log(c, id, "note", None, None, &t, None)?;
    db(c.execute(&format!("UPDATE work_items SET updated_at = {NOW} WHERE id = ?1"), params![id]))?;
    change(c, id)
}

pub fn delete_note(c: &Connection, event_id: &str) -> Res<ItemChange> {
    let item: Option<String> = db(c
        .query_row("SELECT item_id FROM work_events WHERE id = ?1 AND kind = 'note'", params![event_id], |r| r.get(0))
        .optional())?;
    let item = item.ok_or_else(|| "anotação não encontrada".to_string())?;
    db(c.execute("DELETE FROM work_events WHERE id = ?1", params![event_id]))?;
    change(c, &item)
}

pub fn snooze(c: &Connection, id: &str, until: Option<String>) -> Res<ItemChange> {
    find_item(c, id)?;
    let d = opt_date(until)?;
    db(c.execute("UPDATE work_items SET snoozed_until = ?2 WHERE id = ?1", params![id, d]))?;
    change(c, id)
}

pub fn set_focus(c: &Connection, id: &str, on: bool) -> Res<ItemChange> {
    let cur = find_item(c, id)?;
    if on {
        if cur.focused_at.is_some() {
            return change(c, id);
        }
        if cur.stage == "done" {
            return Err("item concluído não entra no foco".into());
        }
        let n: i64 = db(c.query_row("SELECT COUNT(*) FROM work_items WHERE focused_at IS NOT NULL", [], |r| r.get(0)))?;
        if n >= FOCUS_MAX {
            return Err(format!("o foco tem no máximo {FOCUS_MAX} itens; tire um antes"));
        }
        db(c.execute(&format!("UPDATE work_items SET focused_at = {NOW} WHERE id = ?1"), params![id]))?;
    } else {
        db(c.execute("UPDATE work_items SET focused_at = NULL WHERE id = ?1", params![id]))?;
    }
    change(c, id)
}

pub fn set_check(c: &Connection, id: &str, check_id: &str, on: bool) -> Res<ItemChange> {
    let cur = find_item(c, id)?;
    let company: Option<String> = db(c
        .query_row("SELECT company_id FROM work_checklist WHERE id = ?1 AND archived_at IS NULL", params![check_id], |r| r.get(0))
        .optional())?;
    match company {
        Some(co) if co == cur.company_id => {}
        Some(_) => return Err("esse item de checklist é de outra empresa".into()),
        None => return Err("item de checklist não encontrado".into()),
    }
    if on {
        db(c.execute("INSERT OR IGNORE INTO work_item_checks (item_id, check_id) VALUES (?1, ?2)", params![id, check_id]))?;
    } else {
        db(c.execute("DELETE FROM work_item_checks WHERE item_id = ?1 AND check_id = ?2", params![id, check_id]))?;
    }
    change(c, id)
}

pub fn reorder(c: &mut Connection, ids: &[String]) -> Res<()> {
    let tx = db(c.transaction())?;
    for (i, id) in ids.iter().enumerate() {
        db(tx.execute("UPDATE work_items SET sort = ?2 WHERE id = ?1", params![id, i as f64]))?;
    }
    db(tx.commit())
}

fn list_checklist(c: &Connection) -> Res<Vec<ChecklistEntry>> {
    let mut st = db(c.prepare(
        "SELECT id, company_id, label, sort FROM work_checklist WHERE archived_at IS NULL ORDER BY company_id, sort, created_at",
    ))?;
    db(st
        .query_map([], |r| Ok(ChecklistEntry { id: r.get(0)?, company_id: r.get(1)?, label: r.get(2)?, sort: r.get(3)? }))
        .and_then(|m| m.collect()))
}

pub fn checklist_add(c: &Connection, company_id: &str, label: &str) -> Res<Vec<ChecklistEntry>> {
    if !company_exists(c, company_id)? {
        return Err("empresa desconhecida".into());
    }
    let label = required(label, 120, "o item")?;
    db(c.execute(
        "INSERT INTO work_checklist (id, company_id, label, sort)
         VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM work_checklist WHERE company_id = ?2))",
        params![new_id(), company_id, label],
    ))?;
    list_checklist(c)
}

pub fn checklist_rename(c: &Connection, id: &str, label: &str) -> Res<Vec<ChecklistEntry>> {
    let label = required(label, 120, "o item")?;
    let n = db(c.execute("UPDATE work_checklist SET label = ?2 WHERE id = ?1 AND archived_at IS NULL", params![id, label]))?;
    if n == 0 {
        return Err("item de checklist não encontrado".into());
    }
    list_checklist(c)
}

pub fn checklist_remove(c: &Connection, id: &str) -> Res<Vec<ChecklistEntry>> {
    db(c.execute(&format!("UPDATE work_checklist SET archived_at = {NOW} WHERE id = ?1 AND archived_at IS NULL"), params![id]))?;
    list_checklist(c)
}

pub fn checklist_reorder(c: &mut Connection, company_id: &str, ids: &[String]) -> Res<Vec<ChecklistEntry>> {
    let tx = db(c.transaction())?;
    for (i, id) in ids.iter().enumerate() {
        db(tx.execute("UPDATE work_checklist SET sort = ?3 WHERE id = ?1 AND company_id = ?2", params![id, company_id, (i + 1) as f64]))?;
    }
    db(tx.commit())?;
    list_checklist(c)
}

const COMPANY_COLS: &str = "id, name, color, logo, sort, ticket_url, sla_response_min, sla_resolution_min";

fn company_from(r: &Row) -> rusqlite::Result<Company> {
    Ok(Company {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        logo: r.get(3)?,
        sort: r.get(4)?,
        ticket_url: r.get(5)?,
        sla_response_min: r.get(6)?,
        sla_resolution_min: r.get(7)?,
    })
}

fn get_company(c: &Connection, id: &str) -> Res<Company> {
    db(c.query_row(&format!("SELECT {COMPANY_COLS} FROM work_companies WHERE id = ?1"), params![id], company_from).optional())?
        .ok_or_else(|| "empresa não encontrada".into())
}

fn check_ticket_url(u: Option<String>) -> Res<Option<String>> {
    match u.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(v) => {
            let l = v.to_lowercase();
            if !(l.starts_with("https://") || l.starts_with("http://")) || !v.contains("{id}") || v.len() > 500 || v.chars().any(char::is_whitespace) {
                return Err("o link do chamado precisa começar com http(s):// e ter {id} no lugar do número".into());
            }
            Ok(Some(v))
        }
    }
}

fn check_sla(v: Option<i64>) -> Res<Option<i64>> {
    match v {
        None => Ok(None),
        Some(m) if (1..=525_600).contains(&m) => Ok(Some(m)),
        Some(_) => Err("prazo de SLA inválido".into()),
    }
}

fn check_logo(logo: Option<String>) -> Res<Option<String>> {
    match logo.filter(|l| !l.is_empty()) {
        None => Ok(None),
        Some(l) if l.starts_with("data:image/") && l.len() <= 600_000 => Ok(Some(l)),
        Some(_) => Err("logo inválido ou grande demais (até ~400 KB)".into()),
    }
}

pub fn company_create(c: &Connection, name: &str, color: &str) -> Res<Company> {
    let name = required(name, 60, "o nome")?;
    if !valid_color(color) {
        return Err("cor inválida".into());
    }
    let base = slugify(&name);
    if base.is_empty() {
        return Err("use letras ou números no nome".into());
    }
    let mut id = base.clone();
    let mut n = 2;
    while company_exists(c, &id)? {
        id = format!("{base}-{n}");
        n += 1;
    }
    db(c.execute(
        "INSERT INTO work_companies (id, name, color, sort) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM work_companies))",
        params![id, name, color.to_uppercase()],
    ))?;
    get_company(c, &id)
}

pub fn company_update(c: &Connection, id: &str, p: CompanyPatch) -> Res<Company> {
    get_company(c, id)?;
    if let Some(n) = p.name {
        db(c.execute("UPDATE work_companies SET name = ?2 WHERE id = ?1", params![id, required(&n, 60, "o nome")?]))?;
    }
    if let Some(col) = p.color {
        if !valid_color(&col) {
            return Err("cor inválida".into());
        }
        db(c.execute("UPDATE work_companies SET color = ?2 WHERE id = ?1", params![id, col.to_uppercase()]))?;
    }
    if let Some(l) = p.logo {
        db(c.execute("UPDATE work_companies SET logo = ?2 WHERE id = ?1", params![id, check_logo(l)?]))?;
    }
    if let Some(u) = p.ticket_url {
        db(c.execute("UPDATE work_companies SET ticket_url = ?2 WHERE id = ?1", params![id, check_ticket_url(u)?]))?;
    }
    if let Some(v) = p.sla_response_min {
        db(c.execute("UPDATE work_companies SET sla_response_min = ?2 WHERE id = ?1", params![id, check_sla(v)?]))?;
    }
    if let Some(v) = p.sla_resolution_min {
        db(c.execute("UPDATE work_companies SET sla_resolution_min = ?2 WHERE id = ?1", params![id, check_sla(v)?]))?;
    }
    db(c.execute(&format!("UPDATE work_companies SET updated_at = {NOW} WHERE id = ?1"), params![id]))?;
    get_company(c, id)
}

pub fn company_delete(c: &Connection, vault: &dyn Vault, id: &str) -> Res<()> {
    let n: i64 = db(c.query_row(
        "SELECT (SELECT COUNT(*) FROM work_items WHERE company_id = ?1) + (SELECT COUNT(*) FROM work_todos WHERE company_id = ?1)",
        params![id],
        |r| r.get(0),
    ))?;
    if n > 0 {
        return Err(format!("o espaço tem {n} {}; mova ou exclua antes", if n == 1 { "item" } else { "itens" }));
    }
    let left: i64 = db(c.query_row("SELECT COUNT(*) FROM work_companies WHERE id <> ?1", params![id], |r| r.get(0)))?;
    if left == 0 {
        return Err("mantenha pelo menos um espaço".into());
    }
    let secrets: Vec<String> = {
        let mut st = db(c.prepare("SELECT id FROM work_secrets WHERE company_id = ?1"))?;
        db(st.query_map(params![id], |r| r.get(0)).and_then(|m| m.collect()))?
    };
    db(c.execute("DELETE FROM work_companies WHERE id = ?1", params![id]))?;
    for sid in secrets {
        vault.delete(&sid).ok();
    }
    Ok(())
}

pub fn get_settings(c: &Connection) -> Res<Settings> {
    db(c.query_row(
        "SELECT wip_limit, validation_days, waiting_days, stale_days, return_days, close_days,
                notify_reminders, notify_due, notify_validation, notify_hour, notify_neglect, neglect_hour, neglect_days,
                quiet_start, quiet_end FROM work_settings WHERE id = 1",
        [],
        |r| {
            Ok(Settings {
                wip_limit: r.get(0)?,
                validation_days: r.get(1)?,
                waiting_days: r.get(2)?,
                stale_days: r.get(3)?,
                return_days: r.get(4)?,
                close_days: r.get(5)?,
                notify_reminders: r.get(6)?,
                notify_due: r.get(7)?,
                notify_validation: r.get(8)?,
                notify_hour: r.get(9)?,
                notify_neglect: r.get(10)?,
                neglect_hour: r.get(11)?,
                neglect_days: r.get(12)?,
                quiet_start: r.get(13)?,
                quiet_end: r.get(14)?,
            })
        },
    ))
}

pub fn set_settings(c: &Connection, s: Settings) -> Res<Settings> {
    if !(1..=20).contains(&s.wip_limit) {
        return Err("o limite de itens em andamento vai de 1 a 20".into());
    }
    for d in [s.validation_days, s.waiting_days, s.return_days, s.close_days] {
        if !(0..=60).contains(&d) {
            return Err("os dias dos alertas vão de 0 a 60".into());
        }
    }
    if !(1..=60).contains(&s.stale_days) {
        return Err("os dias parado vão de 1 a 60".into());
    }
    if !(0..=23).contains(&s.notify_hour) || !(0..=23).contains(&s.neglect_hour) || !(0..=23).contains(&s.quiet_start) || !(0..=23).contains(&s.quiet_end) {
        return Err("as horas vão de 0 a 23".into());
    }
    if !(1..=60).contains(&s.neglect_days) {
        return Err("os dias sem atualização vão de 1 a 60".into());
    }
    db(c.execute(
        &format!(
            "UPDATE work_settings SET wip_limit = ?1, validation_days = ?2, waiting_days = ?3, stale_days = ?4,
               return_days = ?5, close_days = ?6, notify_reminders = ?7, notify_due = ?8, notify_validation = ?9,
               notify_hour = ?10, notify_neglect = ?11, neglect_hour = ?12, neglect_days = ?13, quiet_start = ?14, quiet_end = ?15,
               updated_at = {NOW} WHERE id = 1"
        ),
        params![
            s.wip_limit,
            s.validation_days,
            s.waiting_days,
            s.stale_days,
            s.return_days,
            s.close_days,
            s.notify_reminders,
            s.notify_due,
            s.notify_validation,
            s.notify_hour,
            s.notify_neglect,
            s.neglect_hour,
            s.neglect_days,
            s.quiet_start,
            s.quiet_end
        ],
    ))?;
    get_settings(c)
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub company_id: String,
    pub title: String,
    pub note: String,
    pub priority: String,
    pub mode: String,
    pub weekdays_only: bool,
    pub due_date: Option<String>,
    pub remind_time: Option<String>,
    pub must_not_forget: bool,
    pub done_at: Option<String>,
    pub item_id: Option<String>,
    pub sort: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TodoCheck {
    pub todo_id: String,
    pub date: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewTodo {
    pub company_id: String,
    pub title: String,
    pub note: Option<String>,
    pub priority: Option<String>,
    pub mode: Option<String>,
    pub weekdays_only: Option<bool>,
    pub due_date: Option<String>,
    pub remind_time: Option<String>,
    pub must_not_forget: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TodoPatch {
    pub company_id: Option<String>,
    pub title: Option<String>,
    pub note: Option<String>,
    pub priority: Option<String>,
    pub mode: Option<String>,
    pub weekdays_only: Option<bool>,
    #[serde(default, with = "double_option")]
    pub due_date: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub remind_time: Option<Option<String>>,
    pub must_not_forget: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTask {
    pub title: String,
    #[serde(default)]
    pub note: String,
    pub due_date: Option<String>,
    #[serde(default)]
    pub priority: i64,
    pub done_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Converted {
    pub todo: Todo,
    pub change: ItemChange,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub item_id: String,
    pub mime: String,
    pub size: i64,
    pub created_at: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SecretMeta {
    pub id: String,
    pub item_id: Option<String>,
    pub company_id: Option<String>,
    pub label: String,
    pub created_at: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayMark {
    pub date: String,
    pub green: bool,
    pub open_count: i64,
    pub handled_count: i64,
}

pub trait Vault {
    fn set(&self, id: &str, value: &str) -> Res<()>;
    fn get(&self, id: &str) -> Res<String>;
    fn delete(&self, id: &str) -> Res<()>;
}

pub struct Keychain;

impl Vault for Keychain {
    fn set(&self, id: &str, value: &str) -> Res<()> {
        keyring::Entry::new(KEYCHAIN_SERVICE, id)
            .and_then(|e| e.set_password(value))
            .map_err(|_| "não foi possível gravar no Keychain".to_string())
    }
    fn get(&self, id: &str) -> Res<String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, id)
            .and_then(|e| e.get_password())
            .map_err(|_| "segredo não encontrado no Keychain".to_string())
    }
    fn delete(&self, id: &str) -> Res<()> {
        match keyring::Entry::new(KEYCHAIN_SERVICE, id).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("não foi possível apagar do Keychain".into()),
        }
    }
}

const MODES: &[&str] = &["daily", "fixed", "dated"];

fn valid_time(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && t[..2].parse::<u32>().map(|h| h < 24).unwrap_or(false)
        && t[3..].parse::<u32>().map(|m| m < 60).unwrap_or(false)
        && t[..2].chars().chain(t[3..].chars()).all(|c| c.is_ascii_digit())
}

fn opt_time(s: Option<String>) -> Res<Option<String>> {
    match s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(v) if valid_time(&v) => Ok(Some(v)),
        Some(_) => Err("horário inválido".into()),
    }
}

const TODO_COLS: &str = "id, company_id, title, note, priority, mode, weekdays_only, due_date, remind_time, must_not_forget, done_at, item_id, sort, created_at, updated_at";

fn todo_from(r: &Row) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: r.get(0)?,
        company_id: r.get(1)?,
        title: r.get(2)?,
        note: r.get(3)?,
        priority: r.get(4)?,
        mode: r.get(5)?,
        weekdays_only: r.get(6)?,
        due_date: r.get(7)?,
        remind_time: r.get(8)?,
        must_not_forget: r.get(9)?,
        done_at: r.get(10)?,
        item_id: r.get(11)?,
        sort: r.get(12)?,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

fn list_todos(c: &Connection) -> Res<Vec<Todo>> {
    let mut st = db(c.prepare(&format!(
        "SELECT {TODO_COLS} FROM work_todos
         WHERE done_at IS NULL OR done_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
         ORDER BY sort, created_at"
    )))?;
    db(st.query_map([], todo_from).and_then(|m| m.collect()))
}

fn list_todo_checks(c: &Connection, todo_id: Option<&str>) -> Res<Vec<TodoCheck>> {
    let mut st = db(c.prepare(
        "SELECT todo_id, date FROM work_todo_checks WHERE date >= date('now', '-200 days') AND (?1 IS NULL OR todo_id = ?1) ORDER BY date",
    ))?;
    db(st.query_map(params![todo_id], |r| Ok(TodoCheck { todo_id: r.get(0)?, date: r.get(1)? })).and_then(|m| m.collect()))
}

fn get_todo(c: &Connection, id: &str) -> Res<Todo> {
    db(c.query_row(&format!("SELECT {TODO_COLS} FROM work_todos WHERE id = ?1"), params![id], todo_from).optional())?
        .ok_or_else(|| "to-do não encontrado".into())
}

struct TodoShape {
    mode: String,
    weekdays_only: bool,
    due_date: Option<String>,
}

fn shape(mode: &str, weekdays_only: bool, due_date: Option<String>) -> Res<TodoShape> {
    let mode = one_of(mode, MODES, "recorrência")?;
    let due_date = if mode == "dated" { due_date } else { None };
    if mode == "dated" && due_date.is_none() {
        return Err("to-do com prazo precisa de uma data".into());
    }
    Ok(TodoShape { weekdays_only: mode == "daily" && weekdays_only, mode, due_date })
}

pub fn todo_create(c: &Connection, n: NewTodo) -> Res<Todo> {
    let company = clip(&n.company_id, 40);
    if !company_exists(c, &company)? {
        return Err("espaço desconhecido".into());
    }
    let title = required(&n.title, 300, "o título")?;
    let due = opt_date(n.due_date)?;
    let mode = n.mode.unwrap_or_else(|| if due.is_some() { "dated".into() } else { "fixed".into() });
    let sh = shape(&mode, n.weekdays_only.unwrap_or(false), due)?;
    let priority = one_of(n.priority.as_deref().unwrap_or("normal"), PRIORITIES, "prioridade")?;
    let id = new_id();
    db(c.execute(
        "INSERT INTO work_todos (id, company_id, title, note, priority, mode, weekdays_only, due_date, remind_time, must_not_forget, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, (SELECT COALESCE(MIN(sort), 1) - 1 FROM work_todos))",
        params![
            id,
            company,
            title,
            n.note.map(|v| clip(&v, 2000)).unwrap_or_default(),
            priority,
            sh.mode,
            sh.weekdays_only,
            sh.due_date,
            opt_time(n.remind_time)?,
            n.must_not_forget.unwrap_or(false)
        ],
    ))?;
    get_todo(c, &id)
}

pub fn todo_update(c: &Connection, id: &str, p: TodoPatch) -> Res<Todo> {
    let cur = get_todo(c, id)?;
    let company = match p.company_id.map(|v| clip(&v, 40)) {
        Some(v) if !company_exists(c, &v)? => return Err("espaço desconhecido".into()),
        Some(v) => v,
        None => cur.company_id,
    };
    let title = match p.title {
        Some(t) => required(&t, 300, "o título")?,
        None => cur.title,
    };
    let due = match p.due_date {
        Some(v) => opt_date(v)?,
        None => cur.due_date,
    };
    let sh = shape(p.mode.as_deref().unwrap_or(&cur.mode), p.weekdays_only.unwrap_or(cur.weekdays_only), due)?;
    let priority = match p.priority {
        Some(v) => one_of(&v, PRIORITIES, "prioridade")?,
        None => cur.priority,
    };
    let remind = match p.remind_time {
        Some(v) => opt_time(v)?,
        None => cur.remind_time,
    };
    let done = if sh.mode == "daily" { None } else { cur.done_at };
    db(c.execute(
        &format!(
            "UPDATE work_todos SET company_id = ?2, title = ?3, note = ?4, priority = ?5, mode = ?6, weekdays_only = ?7, due_date = ?8,
               remind_time = ?9, must_not_forget = ?10, done_at = ?11, updated_at = {NOW} WHERE id = ?1"
        ),
        params![
            id,
            company,
            title,
            p.note.map(|v| clip(&v, 2000)).unwrap_or(cur.note),
            priority,
            sh.mode,
            sh.weekdays_only,
            sh.due_date,
            remind,
            p.must_not_forget.unwrap_or(cur.must_not_forget),
            done
        ],
    ))?;
    get_todo(c, id)
}

pub fn todo_done(c: &Connection, id: &str, on: bool) -> Res<Todo> {
    let cur = get_todo(c, id)?;
    if cur.mode == "daily" {
        return Err("to-do diário se marca por dia".into());
    }
    if on {
        db(c.execute(&format!("UPDATE work_todos SET done_at = COALESCE(done_at, {NOW}), updated_at = {NOW} WHERE id = ?1"), params![id]))?;
    } else {
        db(c.execute(&format!("UPDATE work_todos SET done_at = NULL, updated_at = {NOW} WHERE id = ?1"), params![id]))?;
    }
    get_todo(c, id)
}

pub fn todo_check(c: &Connection, id: &str, date: &str, on: bool) -> Res<Vec<TodoCheck>> {
    let cur = get_todo(c, id)?;
    if cur.mode != "daily" {
        return Err("só to-do diário se marca por dia".into());
    }
    if !valid_date(date) {
        return Err("data inválida".into());
    }
    if on {
        db(c.execute("INSERT OR IGNORE INTO work_todo_checks (todo_id, date) VALUES (?1, ?2)", params![id, date]))?;
    } else {
        db(c.execute("DELETE FROM work_todo_checks WHERE todo_id = ?1 AND date = ?2", params![id, date]))?;
    }
    list_todo_checks(c, Some(id))
}

pub fn todo_delete(c: &Connection, id: &str) -> Res<()> {
    let n = db(c.execute("DELETE FROM work_todos WHERE id = ?1", params![id]))?;
    if n == 0 { Err("to-do não encontrado".into()) } else { Ok(()) }
}

pub fn todo_convert(c: &mut Connection, id: &str) -> Res<Converted> {
    let t = get_todo(c, id)?;
    if t.mode == "daily" {
        return Err("to-do diário não vira item de trabalho".into());
    }
    if t.item_id.is_some() {
        return Err("esse to-do já virou item de trabalho".into());
    }
    let ch = create(
        c,
        NewItem {
            company_id: t.company_id.clone(),
            title: t.title.clone(),
            priority: Some(t.priority.clone()),
            due_date: t.due_date.clone(),
            notes: Some(t.note.clone()),
            ..Default::default()
        },
    )?;
    db(c.execute(
        &format!("UPDATE work_todos SET item_id = ?2, done_at = COALESCE(done_at, {NOW}), updated_at = {NOW} WHERE id = ?1"),
        params![id, ch.item.id],
    ))?;
    Ok(Converted { todo: get_todo(c, id)?, change: ch })
}

pub fn todos_import(c: &mut Connection, tasks: Vec<ImportTask>) -> Res<i64> {
    let done: bool = db(c.query_row("SELECT tasks_imported FROM work_settings WHERE id = 1", [], |r| r.get(0)))?;
    if done {
        return Ok(0);
    }
    let space: String = if company_exists(c, "pessoal")? {
        "pessoal".into()
    } else {
        db(c.query_row("SELECT id FROM work_companies ORDER BY sort LIMIT 1", [], |r| r.get(0)))?
    };
    let tx = db(c.transaction())?;
    let mut n = 0;
    for (i, t) in tasks.into_iter().enumerate() {
        let title = clip(&t.title, 300);
        if title.is_empty() {
            continue;
        }
        let due = t.due_date.filter(|d| valid_date(d));
        let mode = if due.is_some() { "dated" } else { "fixed" };
        let done_at = t.done_at.filter(|d| d.len() >= 10 && d.len() <= 40);
        db(tx.execute(
            "INSERT INTO work_todos (id, company_id, title, note, priority, mode, due_date, done_at, sort)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![new_id(), space, title, clip(&t.note, 2000), if t.priority > 0 { "alta" } else { "normal" }, mode, due, done_at, i as f64],
        ))?;
        n += 1;
    }
    db(tx.execute("UPDATE work_settings SET tasks_imported = 1 WHERE id = 1", []))?;
    db(tx.commit())?;
    Ok(n)
}

fn safe_rel(rel: &str) -> bool {
    rel.starts_with("work-assets/")
        && !rel.contains("..")
        && !rel.contains('\\')
        && rel["work-assets/".len()..].chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && rel.len() > "work-assets/".len()
}

fn list_attachments(c: &Connection, item_id: Option<&str>) -> Res<Vec<Attachment>> {
    let mut st = db(c.prepare(
        "SELECT id, item_id, mime, size, created_at FROM work_attachments WHERE ?1 IS NULL OR item_id = ?1 ORDER BY created_at, rowid",
    ))?;
    db(st
        .query_map(params![item_id], |r| {
            Ok(Attachment { id: r.get(0)?, item_id: r.get(1)?, mime: r.get(2)?, size: r.get(3)?, created_at: r.get(4)? })
        })
        .and_then(|m| m.collect()))
}

pub fn attachment_save(c: &Connection, data_dir: &Path, item_id: &str, bytes: &[u8]) -> Res<Attachment> {
    if bytes.is_empty() {
        return Err("a imagem está vazia".into());
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("a imagem passa de 10 MB".into());
    }
    let (mime, ext) = sniff_image(bytes).ok_or_else(|| "formato não suportado: use PNG, JPEG, GIF ou WebP".to_string())?;
    find_item(c, item_id)?;
    let id = new_id();
    let rel = format!("{ASSET_DIR}/{id}.{ext}");
    let dir = data_dir.join(ASSET_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{id}.part"));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, data_dir.join(&rel)).map_err(|e| e.to_string())?;
    if let Err(e) = c.execute(
        "INSERT INTO work_attachments (id, item_id, rel_path, mime, size) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, item_id, rel, mime, bytes.len() as i64],
    ) {
        fs::remove_file(data_dir.join(&rel)).ok();
        return Err(e.to_string());
    }
    db(c.execute(&format!("UPDATE work_items SET updated_at = {NOW} WHERE id = ?1"), params![item_id]))?;
    list_attachments(c, Some(item_id))?.into_iter().find(|a| a.id == id).ok_or_else(|| "falha ao salvar".into())
}

pub fn attachment_data_url(c: &Connection, data_dir: &Path, id: &str) -> Res<String> {
    let (rel, mime): (String, String) = db(c
        .query_row("SELECT rel_path, mime FROM work_attachments WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional())?
    .ok_or_else(|| "imagem não encontrada".to_string())?;
    if !safe_rel(&rel) {
        return Err("caminho de imagem inválido".into());
    }
    let bytes = fs::read(data_dir.join(&rel)).map_err(|_| "o arquivo da imagem não está na pasta do app".to_string())?;
    Ok(format!("data:{mime};base64,{}", base64(&bytes)))
}

pub fn attachment_delete(c: &Connection, data_dir: &Path, id: &str) -> Res<()> {
    let rel: Option<String> = db(c.query_row("SELECT rel_path FROM work_attachments WHERE id = ?1", params![id], |r| r.get(0)).optional())?;
    let rel = rel.ok_or_else(|| "imagem não encontrada".to_string())?;
    db(c.execute("DELETE FROM work_attachments WHERE id = ?1", params![id]))?;
    if safe_rel(&rel) {
        fs::remove_file(data_dir.join(rel)).ok();
    }
    Ok(())
}

fn list_secrets(c: &Connection) -> Res<Vec<SecretMeta>> {
    let mut st = db(c.prepare("SELECT id, item_id, company_id, label, created_at FROM work_secrets ORDER BY created_at, rowid"))?;
    db(st
        .query_map([], |r| Ok(SecretMeta { id: r.get(0)?, item_id: r.get(1)?, company_id: r.get(2)?, label: r.get(3)?, created_at: r.get(4)? }))
        .and_then(|m| m.collect()))
}

pub fn secret_add(c: &mut Connection, vault: &dyn Vault, item_id: Option<String>, company_id: Option<String>, label: &str, value: &str) -> Res<SecretMeta> {
    let label = required(label, 80, "o rótulo")?;
    if value.is_empty() || value.trim().is_empty() {
        return Err("o valor do segredo está vazio".into());
    }
    if value.chars().count() > SECRET_MAX {
        return Err("o segredo é grande demais".into());
    }
    let item = optional(item_id, 60);
    let company = optional(company_id, 40);
    match (&item, &company) {
        (Some(i), None) => {
            find_item(c, i)?;
        }
        (None, Some(co)) => {
            if !company_exists(c, co)? {
                return Err("empresa desconhecida".into());
            }
        }
        _ => return Err("o segredo pertence a um item ou a uma empresa".into()),
    }
    let id = new_id();
    let tx = db(c.transaction())?;
    db(tx.execute("INSERT INTO work_secrets (id, item_id, company_id, label) VALUES (?1, ?2, ?3, ?4)", params![id, item, company, label]))?;
    vault.set(&id, value)?;
    if let Err(e) = tx.commit() {
        vault.delete(&id).ok();
        return Err(e.to_string());
    }
    list_secrets(c)?.into_iter().find(|s| s.id == id).ok_or_else(|| "falha ao salvar".into())
}

pub fn secret_reveal(c: &Connection, vault: &dyn Vault, id: &str) -> Res<String> {
    let exists: bool = db(c.query_row("SELECT EXISTS (SELECT 1 FROM work_secrets WHERE id = ?1)", params![id], |r| r.get(0)))?;
    if !exists {
        return Err("segredo não encontrado".into());
    }
    vault.get(id)
}

pub fn secret_delete(c: &Connection, vault: &dyn Vault, id: &str) -> Res<()> {
    vault.delete(id)?;
    db(c.execute("DELETE FROM work_secrets WHERE id = ?1", params![id]))?;
    Ok(())
}

fn list_days(c: &Connection) -> Res<Vec<DayMark>> {
    let mut st = db(c.prepare(
        "SELECT date, green, open_count, handled_count FROM work_days WHERE date >= date('now', '-200 days') ORDER BY date",
    ))?;
    db(st
        .query_map([], |r| Ok(DayMark { date: r.get(0)?, green: r.get(1)?, open_count: r.get(2)?, handled_count: r.get(3)? }))
        .and_then(|m| m.collect()))
}

pub fn day_set(c: &Connection, d: DayMark) -> Res<DayMark> {
    if !valid_date(&d.date) {
        return Err("data inválida".into());
    }
    if d.open_count < 0 || d.handled_count < 0 {
        return Err("contagem inválida".into());
    }
    db(c.execute(
        &format!(
            "INSERT INTO work_days (date, green, open_count, handled_count) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (date) DO UPDATE SET green = excluded.green, open_count = excluded.open_count,
               handled_count = excluded.handled_count, updated_at = {NOW}"
        ),
        params![d.date, d.green, d.open_count, d.handled_count],
    ))?;
    Ok(d)
}

fn session_from(r: &Row) -> rusqlite::Result<Session> {
    Ok(Session { id: r.get(0)?, item_id: r.get(1)?, started_at: r.get(2)?, ended_at: r.get(3)? })
}

fn list_sessions(c: &Connection, item_id: Option<&str>) -> Res<Vec<Session>> {
    let mut st = db(c.prepare(
        "SELECT id, item_id, started_at, ended_at FROM work_sessions
         WHERE (?1 IS NULL AND started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-400 days')) OR item_id = ?1
         ORDER BY started_at, rowid",
    ))?;
    db(st.query_map(params![item_id], session_from).and_then(|m| m.collect()))
}

fn running_item(c: &Connection) -> Res<Option<String>> {
    db(c.query_row("SELECT item_id FROM work_sessions WHERE ended_at IS NULL", [], |r| r.get(0)).optional())
}

fn timer_change(c: &Connection, ids: Vec<String>) -> Res<TimerChange> {
    let mut sessions = Vec::new();
    for id in &ids {
        sessions.extend(list_sessions(c, Some(id))?);
    }
    Ok(TimerChange { item_ids: ids, sessions })
}

pub fn timer_start(c: &mut Connection, item_id: &str) -> Res<TimerChange> {
    let it = find_item(c, item_id)?;
    if it.stage == "done" {
        return Err("item concluído não conta tempo".into());
    }
    let prev = running_item(c)?;
    if prev.as_deref() == Some(item_id) {
        return timer_change(c, vec![item_id.to_string()]);
    }
    let tx = db(c.transaction())?;
    db(tx.execute(&format!("UPDATE work_sessions SET ended_at = {NOW} WHERE ended_at IS NULL"), []))?;
    db(tx.execute("INSERT INTO work_sessions (id, item_id) VALUES (?1, ?2)", params![new_id(), item_id]))?;
    db(tx.commit())?;
    let mut ids = vec![item_id.to_string()];
    if let Some(p) = prev {
        ids.push(p);
    }
    timer_change(c, ids)
}

pub fn timer_stop(c: &Connection) -> Res<TimerChange> {
    let Some(prev) = running_item(c)? else { return Ok(TimerChange { item_ids: vec![], sessions: vec![] }) };
    db(c.execute(&format!("UPDATE work_sessions SET ended_at = {NOW} WHERE ended_at IS NULL"), []))?;
    timer_change(c, vec![prev])
}

pub fn session_delete(c: &Connection, id: &str) -> Res<TimerChange> {
    let item: Option<String> = db(c.query_row("SELECT item_id FROM work_sessions WHERE id = ?1", params![id], |r| r.get(0)).optional())?;
    let item = item.ok_or_else(|| "sessão não encontrada".to_string())?;
    db(c.execute("DELETE FROM work_sessions WHERE id = ?1", params![id]))?;
    timer_change(c, vec![item])
}

fn list_snippets(c: &Connection) -> Res<Vec<Snippet>> {
    let mut st = db(c.prepare("SELECT id, company_id, title, body, is_default, sort FROM work_snippets ORDER BY company_id, sort, created_at"))?;
    db(st
        .query_map([], |r| Ok(Snippet { id: r.get(0)?, company_id: r.get(1)?, title: r.get(2)?, body: r.get(3)?, is_default: r.get(4)?, sort: r.get(5)? }))
        .and_then(|m| m.collect()))
}

pub fn snippet_save(c: &mut Connection, s: SnippetInput) -> Res<Vec<Snippet>> {
    let company = clip(&s.company_id, 40);
    if !company_exists(c, &company)? {
        return Err("empresa desconhecida".into());
    }
    let title = required(&s.title, 80, "o título")?;
    let body = s.body.trim().chars().take(4000).collect::<String>();
    if body.is_empty() {
        return Err("o texto da resposta está vazio".into());
    }
    let default = s.is_default.unwrap_or(false);
    let tx = db(c.transaction())?;
    if default {
        db(tx.execute("UPDATE work_snippets SET is_default = 0 WHERE company_id = ?1", params![company]))?;
    }
    match s.id.filter(|x| !x.is_empty()) {
        Some(id) => {
            let n = db(tx.execute(
                &format!("UPDATE work_snippets SET company_id = ?2, title = ?3, body = ?4, is_default = ?5, updated_at = {NOW} WHERE id = ?1"),
                params![id, company, title, body, default],
            ))?;
            if n == 0 {
                return Err("resposta não encontrada".into());
            }
        }
        None => {
            db(tx.execute(
                "INSERT INTO work_snippets (id, company_id, title, body, is_default, sort)
                 VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(sort), 0) + 1 FROM work_snippets WHERE company_id = ?2))",
                params![new_id(), company, title, body, default],
            ))?;
        }
    }
    db(tx.commit())?;
    list_snippets(c)
}

pub fn snippet_delete(c: &Connection, id: &str) -> Res<Vec<Snippet>> {
    db(c.execute("DELETE FROM work_snippets WHERE id = ?1", params![id]))?;
    list_snippets(c)
}

fn list_seen(c: &Connection) -> Res<Vec<Seen>> {
    let mut st = db(c.prepare("SELECT company_id, seen_at FROM work_seen ORDER BY company_id"))?;
    db(st.query_map([], |r| Ok(Seen { company_id: r.get(0)?, seen_at: r.get(1)? })).and_then(|m| m.collect()))
}

pub fn seen_touch(c: &Connection, company_id: &str) -> Res<Vec<Seen>> {
    if !company_exists(c, company_id)? {
        return Err("empresa desconhecida".into());
    }
    db(c.execute(
        &format!("INSERT INTO work_seen (company_id) VALUES (?1) ON CONFLICT (company_id) DO UPDATE SET seen_at = {NOW}"),
        params![company_id],
    ))?;
    list_seen(c)
}

fn run<T>(state: &State<AppState>, f: impl FnOnce(&mut Connection) -> Res<T>) -> R<T> {
    let mut out: Option<Res<T>> = None;
    with_conn(state, |c| {
        out = Some(f(c));
        Ok(())
    })?;
    out.unwrap_or_else(|| Err("banco indisponível".into()))
}

#[tauri::command]
pub fn work_load(state: State<AppState>) -> R<WorkState> {
    run(&state, |c| load(c))
}

#[tauri::command]
pub fn work_item_create(state: State<AppState>, input: NewItem) -> R<ItemChange> {
    run(&state, |c| create(c, input))
}

#[tauri::command]
pub fn work_item_update(state: State<AppState>, id: String, patch: ItemPatch) -> R<ItemChange> {
    run(&state, |c| update(c, &id, patch))
}

#[tauri::command]
pub fn work_item_delete(state: State<AppState>, id: String) -> R<()> {
    let dir = state.data_dir.clone();
    run(&state, |c| delete(c, &dir, &Keychain, &id))
}

#[tauri::command]
pub fn work_item_move(state: State<AppState>, id: String, stage: String, force: bool, note: Option<String>) -> R<ItemChange> {
    run(&state, |c| move_stage(c, &id, &stage, force, note))
}

#[tauri::command]
pub fn work_item_return(state: State<AppState>, id: String, reason: String) -> R<ItemChange> {
    run(&state, |c| give_back(c, &id, &reason))
}

#[tauri::command]
pub fn work_item_resume(state: State<AppState>, id: String) -> R<ItemChange> {
    run(&state, |c| resume(c, &id))
}

#[tauri::command]
pub fn work_item_wait(state: State<AppState>, id: String, on: Option<String>) -> R<ItemChange> {
    run(&state, |c| set_waiting(c, &id, on))
}

#[tauri::command]
pub fn work_item_followup(state: State<AppState>, id: String, note: Option<String>) -> R<ItemChange> {
    run(&state, |c| follow_up(c, &id, note))
}

#[tauri::command]
pub fn work_item_note(state: State<AppState>, id: String, text: String) -> R<ItemChange> {
    run(&state, |c| add_note(c, &id, &text))
}

#[tauri::command]
pub fn work_note_delete(state: State<AppState>, event_id: String) -> R<ItemChange> {
    run(&state, |c| delete_note(c, &event_id))
}

#[tauri::command]
pub fn work_item_snooze(state: State<AppState>, id: String, until: Option<String>) -> R<ItemChange> {
    run(&state, |c| snooze(c, &id, until))
}

#[tauri::command]
pub fn work_item_focus(state: State<AppState>, id: String, on: bool) -> R<ItemChange> {
    run(&state, |c| set_focus(c, &id, on))
}

#[tauri::command]
pub fn work_item_check(state: State<AppState>, id: String, check_id: String, on: bool) -> R<ItemChange> {
    run(&state, |c| set_check(c, &id, &check_id, on))
}

#[tauri::command]
pub fn work_items_reorder(state: State<AppState>, ids: Vec<String>) -> R<()> {
    run(&state, |c| reorder(c, &ids))
}

#[tauri::command]
pub fn work_checklist_add(state: State<AppState>, company_id: String, label: String) -> R<Vec<ChecklistEntry>> {
    run(&state, |c| checklist_add(c, &company_id, &label))
}

#[tauri::command]
pub fn work_checklist_rename(state: State<AppState>, id: String, label: String) -> R<Vec<ChecklistEntry>> {
    run(&state, |c| checklist_rename(c, &id, &label))
}

#[tauri::command]
pub fn work_checklist_remove(state: State<AppState>, id: String) -> R<Vec<ChecklistEntry>> {
    run(&state, |c| checklist_remove(c, &id))
}

#[tauri::command]
pub fn work_checklist_reorder(state: State<AppState>, company_id: String, ids: Vec<String>) -> R<Vec<ChecklistEntry>> {
    run(&state, |c| checklist_reorder(c, &company_id, &ids))
}

#[tauri::command]
pub fn work_company_create(state: State<AppState>, name: String, color: String) -> R<Company> {
    run(&state, |c| company_create(c, &name, &color))
}

#[tauri::command]
pub fn work_company_update(state: State<AppState>, id: String, patch: CompanyPatch) -> R<Company> {
    run(&state, |c| company_update(c, &id, patch))
}

#[tauri::command]
pub fn work_company_delete(state: State<AppState>, id: String) -> R<()> {
    run(&state, |c| company_delete(c, &Keychain, &id))
}

#[tauri::command]
pub fn work_settings_set(state: State<AppState>, settings: Settings) -> R<Settings> {
    run(&state, |c| set_settings(c, settings))
}

#[tauri::command]
pub fn work_todo_create(state: State<AppState>, input: NewTodo) -> R<Todo> {
    run(&state, |c| todo_create(c, input))
}

#[tauri::command]
pub fn work_todo_update(state: State<AppState>, id: String, patch: TodoPatch) -> R<Todo> {
    run(&state, |c| todo_update(c, &id, patch))
}

#[tauri::command]
pub fn work_todo_done(state: State<AppState>, id: String, on: bool) -> R<Todo> {
    run(&state, |c| todo_done(c, &id, on))
}

#[tauri::command]
pub fn work_todo_check(state: State<AppState>, id: String, date: String, on: bool) -> R<Vec<TodoCheck>> {
    run(&state, |c| todo_check(c, &id, &date, on))
}

#[tauri::command]
pub fn work_todo_delete(state: State<AppState>, id: String) -> R<()> {
    run(&state, |c| todo_delete(c, &id))
}

#[tauri::command]
pub fn work_todo_convert(state: State<AppState>, id: String) -> R<Converted> {
    run(&state, |c| todo_convert(c, &id))
}

#[tauri::command]
pub fn work_todos_import(state: State<AppState>, tasks: Vec<ImportTask>) -> R<i64> {
    run(&state, |c| todos_import(c, tasks))
}

#[tauri::command]
pub fn work_attachment_save(state: State<AppState>, request: tauri::ipc::Request<'_>) -> R<Attachment> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("envie os bytes da imagem".into());
    };
    let item_id = request.headers().get("x-item-id").and_then(|v| v.to_str().ok()).ok_or("item não informado")?.to_string();
    let dir = state.data_dir.clone();
    run(&state, |c| attachment_save(c, &dir, &item_id, bytes))
}

#[tauri::command]
pub fn work_attachment_get(state: State<AppState>, id: String) -> R<String> {
    let dir = state.data_dir.clone();
    run(&state, |c| attachment_data_url(c, &dir, &id))
}

#[tauri::command]
pub fn work_attachment_delete(state: State<AppState>, id: String) -> R<()> {
    let dir = state.data_dir.clone();
    run(&state, |c| attachment_delete(c, &dir, &id))
}

#[tauri::command]
pub fn work_secret_add(state: State<AppState>, item_id: Option<String>, company_id: Option<String>, label: String, value: String) -> R<SecretMeta> {
    run(&state, |c| secret_add(c, &Keychain, item_id, company_id, &label, &value))
}

#[tauri::command]
pub fn work_secret_reveal(state: State<AppState>, id: String) -> R<String> {
    run(&state, |c| secret_reveal(c, &Keychain, &id))
}

#[tauri::command]
pub fn work_secret_delete(state: State<AppState>, id: String) -> R<()> {
    run(&state, |c| secret_delete(c, &Keychain, &id))
}

#[tauri::command]
pub fn work_day_set(state: State<AppState>, date: String, green: bool, open_count: i64, handled_count: i64) -> R<DayMark> {
    run(&state, |c| day_set(c, DayMark { date, green, open_count, handled_count }))
}

#[tauri::command]
pub fn work_timer_start(state: State<AppState>, item_id: String) -> R<TimerChange> {
    run(&state, |c| timer_start(c, &item_id))
}

#[tauri::command]
pub fn work_timer_stop(state: State<AppState>) -> R<TimerChange> {
    run(&state, |c| timer_stop(c))
}

#[tauri::command]
pub fn work_session_delete(state: State<AppState>, id: String) -> R<TimerChange> {
    run(&state, |c| session_delete(c, &id))
}

#[tauri::command]
pub fn work_snippet_save(state: State<AppState>, input: SnippetInput) -> R<Vec<Snippet>> {
    run(&state, |c| snippet_save(c, input))
}

#[tauri::command]
pub fn work_snippet_delete(state: State<AppState>, id: String) -> R<Vec<Snippet>> {
    run(&state, |c| snippet_delete(c, &id))
}

#[tauri::command]
pub fn work_seen_touch(state: State<AppState>, company_id: String) -> R<Vec<Seen>> {
    run(&state, |c| seen_touch(c, &company_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemVault(RefCell<HashMap<String, String>>, RefCell<bool>);
    impl Vault for MemVault {
        fn set(&self, id: &str, value: &str) -> Res<()> {
            if *self.1.borrow() {
                return Err("Keychain indisponível".into());
            }
            self.0.borrow_mut().insert(id.into(), value.into());
            Ok(())
        }
        fn get(&self, id: &str) -> Res<String> {
            self.0.borrow().get(id).cloned().ok_or_else(|| "segredo não encontrado no Keychain".into())
        }
        fn delete(&self, id: &str) -> Res<()> {
            self.0.borrow_mut().remove(id);
            Ok(())
        }
    }

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).ok();
        }
    }

    fn fresh() -> (Connection, Tmp) {
        let dir = std::env::temp_dir().join(format!("ps-work-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let conn = crate::db::open(&dir.join("t.sqlite"), &dir.join("b")).unwrap();
        (conn, Tmp(dir))
    }

    fn item(c: &mut Connection, company: &str, title: &str) -> Item {
        create(c, NewItem { company_id: company.into(), title: title.into(), ..Default::default() }).unwrap().item
    }

    fn check_all(c: &Connection, it: &Item) {
        let st = load(c).unwrap();
        for k in st.checklist.iter().filter(|k| k.company_id == it.company_id) {
            set_check(c, &it.id, &k.id, true).unwrap();
        }
    }

    #[test]
    fn migra_do_zero_com_sementes() {
        let (c, _t) = fresh();
        let st = load(&c).unwrap();
        let ids: Vec<_> = st.companies.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, vec!["statix", "livelo", "pessoal"]);
        assert_eq!(st.companies[1].color, "#E5008C");
        assert_eq!(st.checklist.iter().filter(|k| k.company_id == "statix").count(), 5);
        assert_eq!(st.checklist.iter().filter(|k| k.company_id == "livelo").count(), 4);
        assert_eq!(st.settings.wip_limit, 3);
        assert!(st.items.is_empty());
    }

    #[test]
    fn cria_com_validacoes() {
        let (mut c, _t) = fresh();
        let ch = create(
            &mut c,
            NewItem {
                company_id: "statix".into(),
                title: "  Corrigir conciliação  ".into(),
                ticket: Some("#9488".into()),
                url: Some("https://statix.zendesk.com/agent/tickets/9488".into()),
                priority: Some("urgente".into()),
                due_date: Some("2026-11-07".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(ch.item.title, "Corrigir conciliação");
        assert_eq!(ch.item.stage, "todo");
        assert_eq!(ch.events.len(), 1);
        assert_eq!(ch.events[0].kind, "created");
        let bad = |n: NewItem| create(&mut fresh().0, n).is_err();
        assert!(bad(NewItem { company_id: "acme".into(), title: "x".into(), ..Default::default() }));
        assert!(bad(NewItem { company_id: "statix".into(), title: "   ".into(), ..Default::default() }));
        assert!(bad(NewItem { company_id: "statix".into(), title: "x".into(), url: Some("ftp://x".into()), ..Default::default() }));
        assert!(bad(NewItem { company_id: "statix".into(), title: "x".into(), url: Some("javascript:alert(1)".into()), ..Default::default() }));
        assert!(bad(NewItem { company_id: "statix".into(), title: "x".into(), kind: Some("epico".into()), ..Default::default() }));
        assert!(bad(NewItem { company_id: "statix".into(), title: "x".into(), due_date: Some("07/11/2026".into()), ..Default::default() }));
        assert!(bad(NewItem { company_id: "statix".into(), title: "x".into(), stage: Some("done".into()), ..Default::default() }));
    }

    #[test]
    fn entrega_exige_checklist_ou_forca() {
        let (mut c, _t) = fresh();
        let it = item(&mut c, "statix", "Ajustar relatório");
        move_stage(&mut c, &it.id, "doing", false, None).unwrap();
        let err = move_stage(&mut c, &it.id, "delivered", false, None).unwrap_err();
        assert!(err.contains("checklist pendente: 5"), "{err}");
        let ch = move_stage(&mut c, &it.id, "delivered", true, None).unwrap();
        assert_eq!(ch.item.stage, "delivered");
        assert!(ch.item.delivered_at.is_some());
        let ev = ch.events.last().unwrap();
        assert_eq!((ev.kind.as_str(), ev.pending), ("stage", Some(5)));

        let it2 = item(&mut c, "livelo", "Endpoint de pontos");
        check_all(&c, &it2);
        let ch = move_stage(&mut c, &it2.id, "delivered", false, None).unwrap();
        assert_eq!(ch.events.last().unwrap().pending, Some(0));

        let p = create(&mut c, NewItem { company_id: "statix".into(), title: "Pedir VPN".into(), kind: Some("pendencia".into()), ..Default::default() }).unwrap().item;
        assert!(move_stage(&mut c, &p.id, "done", false, None).is_ok());
    }

    #[test]
    fn transicoes_gravam_eventos_e_datas() {
        let (mut c, _t) = fresh();
        let it = item(&mut c, "livelo", "Feature X");
        check_all(&c, &it);
        set_focus(&c, &it.id, true).unwrap();
        for s in ["doing", "delivered", "tested", "validated"] {
            move_stage(&mut c, &it.id, s, false, None).unwrap();
        }
        let ch = move_stage(&mut c, &it.id, "done", false, None).unwrap();
        let i = &ch.item;
        assert!(i.delivered_at.is_some() && i.tested_at.is_some() && i.validated_at.is_some() && i.done_at.is_some());
        assert!(i.focused_at.is_none());
        let stages: Vec<_> = ch.events.iter().filter(|e| e.kind == "stage").map(|e| e.to_stage.clone().unwrap()).collect();
        assert_eq!(stages, vec!["doing", "delivered", "tested", "validated", "done"]);
        let same = move_stage(&mut c, &it.id, "done", false, None).unwrap();
        assert_eq!(same.events.len(), ch.events.len());

        let back = move_stage(&mut c, &it.id, "doing", false, None).unwrap().item;
        assert!(back.delivered_at.is_none() && back.done_at.is_none());
        assert!(move_stage(&mut c, &it.id, "archived", false, None).is_err());
    }

    #[test]
    fn retorno_conta_volta_para_fazendo_e_zera_checklist() {
        let (mut c, _t) = fresh();
        let it = item(&mut c, "statix", "Conciliação Cielo");
        assert!(give_back(&mut c, &it.id, "bug").is_err());
        check_all(&c, &it);
        move_stage(&mut c, &it.id, "delivered", false, None).unwrap();
        assert!(give_back(&mut c, &it.id, "   ").is_err());
        let ch = give_back(&mut c, &it.id, "valor divergente no relatório").unwrap();
        assert_eq!(ch.item.stage, "doing");
        assert_eq!(ch.item.returns, 1);
        assert!(ch.item.return_open);
        assert!(ch.item.delivered_at.is_none());
        assert!(ch.item.checks.is_empty());
        let ev = ch.events.last().unwrap();
        assert_eq!(ev.kind, "returned");
        assert_eq!(ev.from_stage.as_deref(), Some("delivered"));
        assert_eq!(ev.note, "valor divergente no relatório");

        let r = resume(&mut c, &it.id).unwrap();
        assert!(!r.item.return_open);
        assert_eq!(r.events.last().unwrap().kind, "resumed");
        let again = resume(&mut c, &it.id).unwrap();
        assert_eq!(again.events.len(), r.events.len());

        check_all(&c, &it);
        move_stage(&mut c, &it.id, "validated", false, None).unwrap();
        let ch = give_back(&mut c, &it.id, "faltou filtro").unwrap();
        assert_eq!(ch.item.returns, 2);
    }

    #[test]
    fn aguardando_e_followup() {
        let (mut c, _t) = fresh();
        let it = item(&mut c, "livelo", "Integração");
        let w = set_waiting(&mut c, &it.id, Some("acesso do time de infra".into())).unwrap().item;
        assert_eq!(w.waiting_on.as_deref(), Some("acesso do time de infra"));
        assert!(w.waiting_since.is_some());
        let f = follow_up(&mut c, &it.id, Some("mandei msg".into())).unwrap();
        assert!(f.item.followup_at.is_some());
        let u = set_waiting(&mut c, &it.id, None).unwrap();
        assert!(u.item.waiting_on.is_none());
        let kinds: Vec<_> = u.events.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, vec!["created", "waiting", "followup", "unblocked"]);
        assert_eq!(u.events[3].note, "acesso do time de infra");
        set_waiting(&mut c, &it.id, Some("Ana".into())).unwrap();
        let p = create(&mut c, NewItem { company_id: "livelo".into(), title: "p".into(), kind: Some("pendencia".into()), ..Default::default() }).unwrap().item;
        set_waiting(&mut c, &p.id, Some("x".into())).unwrap();
        let d = move_stage(&mut c, &p.id, "done", false, None).unwrap().item;
        assert!(d.waiting_on.is_none());
        assert!(set_waiting(&mut c, &p.id, Some("y".into())).is_err());
    }

    #[test]
    fn checklist_por_empresa() {
        let (mut c, _t) = fresh();
        let it = item(&mut c, "statix", "Index");
        assert!(set_check(&c, &it.id, "livelo-pr", true).is_err());
        let ch = set_check(&c, &it.id, "statix-sql", true).unwrap();
        assert_eq!(ch.item.checks, vec!["statix-sql"]);
        set_check(&c, &it.id, "statix-sql", true).unwrap();
        assert_eq!(set_check(&c, &it.id, "statix-sql", false).unwrap().item.checks.len(), 0);

        let list = checklist_add(&c, "statix", "Conferi o plano de execução").unwrap();
        assert_eq!(list.iter().filter(|k| k.company_id == "statix").count(), 6);
        let new_id = list.iter().find(|k| k.label == "Conferi o plano de execução").unwrap().id.clone();
        checklist_rename(&c, &new_id, "Conferi o EXPLAIN").unwrap();
        assert!(checklist_add(&c, "statix", "  ").is_err());
        set_check(&c, &it.id, &new_id, true).unwrap();
        let list = checklist_remove(&c, &new_id).unwrap();
        assert!(list.iter().all(|k| k.id != new_id));
        assert!(find_item(&c, &it.id).unwrap().checks.is_empty());

        let ids: Vec<String> = ["statix-avisei", "statix-local"].iter().map(|s| s.to_string()).collect();
        let list = checklist_reorder(&mut c, "statix", &ids).unwrap();
        let first = list.iter().find(|k| k.company_id == "statix").unwrap();
        assert_eq!(first.id, "statix-avisei");

        set_check(&c, &it.id, "statix-local", true).unwrap();
        let moved = update(&mut c, &it.id, ItemPatch { company_id: Some("livelo".into()), ..Default::default() }).unwrap();
        assert!(moved.item.checks.is_empty());
        assert_eq!(moved.item.company_id, "livelo");
    }

    #[test]
    fn foco_limitado_a_tres() {
        let (mut c, _t) = fresh();
        let ids: Vec<_> = (0..4).map(|i| item(&mut c, "statix", &format!("t{i}")).id).collect();
        for id in &ids[..3] {
            set_focus(&c, id, true).unwrap();
        }
        assert!(set_focus(&c, &ids[3], true).is_err());
        set_focus(&c, &ids[0], false).unwrap();
        assert!(set_focus(&c, &ids[3], true).is_ok());
    }

    #[test]
    fn edicao_prazo_e_notas() {
        let (mut c, _t) = fresh();
        let it = item(&mut c, "statix", "Rel");
        let ch = update(
            &mut c,
            &it.id,
            ItemPatch { due_date: Some(Some("2026-11-10".into())), system: Some(Some("Conciliador".into())), requester: Some(Some("Marcos".into())), ..Default::default() },
        )
        .unwrap();
        assert_eq!(ch.item.due_date.as_deref(), Some("2026-11-10"));
        assert_eq!(ch.events.last().unwrap().kind, "due");
        let ch = update(&mut c, &it.id, ItemPatch { due_date: Some(Some("2026-11-10".into())), ..Default::default() }).unwrap();
        assert_eq!(ch.events.iter().filter(|e| e.kind == "due").count(), 1);
        let ch = update(&mut c, &it.id, ItemPatch { system: Some(None), ticket: Some(Some("  ".into())), ..Default::default() }).unwrap();
        assert!(ch.item.system.is_none() && ch.item.ticket.is_none());
        assert_eq!(ch.item.requester.as_deref(), Some("Marcos"));
        assert!(update(&mut c, &it.id, ItemPatch { title: Some("".into()), ..Default::default() }).is_err());
        assert!(update(&mut c, &it.id, ItemPatch { priority: Some("máxima".into()), ..Default::default() }).is_err());

        let n = add_note(&c, &it.id, "Falei com o Marcos, ele valida amanhã").unwrap();
        let note = n.events.iter().find(|e| e.kind == "note").unwrap().id.clone();
        assert!(add_note(&c, &it.id, "  ").is_err());
        let d = delete_note(&c, &note).unwrap();
        assert!(d.events.iter().all(|e| e.kind != "note"));
        let created = d.events.iter().find(|e| e.kind == "created").unwrap().id.clone();
        assert!(delete_note(&c, &created).is_err());

        snooze(&c, &it.id, Some("2026-11-12".into())).unwrap();
        assert!(snooze(&c, &it.id, Some("amanhã".into())).is_err());
        delete(&mut c, _t.0.as_path(), &MemVault::default(), &it.id).unwrap();
        assert!(load(&c).unwrap().events.is_empty());
    }

    #[test]
    fn empresas_e_ajustes() {
        let (mut c, _t) = fresh();
        let co = company_create(&c, "Ação Pagamentos", "#12ab34").unwrap();
        assert_eq!(co.id, "acao-pagamentos");
        assert_eq!(co.color, "#12AB34");
        assert_eq!(company_create(&c, "Ação Pagamentos", "#000000").unwrap().id, "acao-pagamentos-2");
        assert!(company_create(&c, "!!!", "#000000").is_err());
        assert!(company_create(&c, "X", "azul").is_err());
        let u = company_update(&c, "statix", CompanyPatch { logo: Some(Some("data:image/png;base64,AAAA".into())), ..Default::default() }).unwrap();
        assert!(u.logo.is_some());
        assert!(company_update(&c, "statix", CompanyPatch { logo: Some(Some("https://x/logo.png".into())), ..Default::default() }).is_err());
        assert!(company_update(&c, "statix", CompanyPatch { logo: Some(None), ..Default::default() }).unwrap().logo.is_none());
        item(&mut c, "statix", "x");
        let v = MemVault::default();
        assert!(company_delete(&c, &v, "statix").is_err());
        company_delete(&c, &v, "acao-pagamentos").unwrap();

        let mut s = get_settings(&c).unwrap();
        s.wip_limit = 5;
        s.validation_days = 3;
        assert_eq!(set_settings(&c, s.clone()).unwrap().wip_limit, 5);
        assert!(set_settings(&c, Settings { wip_limit: 0, ..s.clone() }).is_err());
        assert!(set_settings(&c, Settings { stale_days: 0, ..s.clone() }).is_err());
        assert!(set_settings(&c, Settings { waiting_days: 90, ..s }).is_err());
    }

    #[test]
    fn banco_recusa_estado_incoerente() {
        let (mut c, _t) = fresh();
        let it = item(&mut c, "statix", "x");
        assert!(c.execute("UPDATE work_items SET stage = 'done' WHERE id = ?1", params![it.id]).is_err());
        assert!(c.execute("UPDATE work_items SET waiting_on = 'x' WHERE id = ?1", params![it.id]).is_err());
        assert!(c.execute("UPDATE work_items SET delivered_at = 'x' WHERE id = ?1", params![it.id]).is_err());
        assert!(c.execute("INSERT INTO work_events (id, item_id, kind) VALUES ('e', ?1, 'returned')", params![it.id]).is_err());
        assert!(c.execute("INSERT INTO work_items (id, company_id, title) VALUES ('z', 'nope', 't')", []).is_err());
    }

    #[test]
    fn reordena() {
        let (mut c, _t) = fresh();
        let a = item(&mut c, "statix", "a").id;
        let b = item(&mut c, "statix", "b").id;
        let st = load(&c).unwrap();
        assert_eq!(st.items[0].id, b);
        reorder(&mut c, &[a.clone(), b]).unwrap();
        assert_eq!(load(&c).unwrap().items[0].id, a);
    }

    #[test]
    fn todos_diarios_fixos_e_com_prazo() {
        let (mut c, _t) = fresh();
        assert!(todo_create(&c, NewTodo { company_id: "acme".into(), title: "x".into(), ..Default::default() }).is_err());
        assert!(todo_create(&c, NewTodo { company_id: "pessoal".into(), title: " ".into(), ..Default::default() }).is_err());
        assert!(todo_create(&c, NewTodo { company_id: "pessoal".into(), title: "x".into(), mode: Some("dated".into()), ..Default::default() }).is_err());
        assert!(todo_create(&c, NewTodo { company_id: "pessoal".into(), title: "x".into(), remind_time: Some("25:00".into()), ..Default::default() }).is_err());
        let fixed = todo_create(&c, NewTodo { company_id: "pessoal".into(), title: "Renovar CNH".into(), ..Default::default() }).unwrap();
        assert_eq!(fixed.mode, "fixed");
        let dated = todo_create(&c, NewTodo { company_id: "livelo".into(), title: "Mandar horas".into(), due_date: Some("2026-11-07".into()), must_not_forget: Some(true), remind_time: Some("17:30".into()), ..Default::default() }).unwrap();
        assert_eq!(dated.mode, "dated");
        assert!(dated.must_not_forget);
        let daily = todo_create(&c, NewTodo { company_id: "statix".into(), title: "Ver fila do Zendesk".into(), mode: Some("daily".into()), weekdays_only: Some(true), ..Default::default() }).unwrap();
        assert!(daily.weekdays_only);
        assert!(todo_done(&c, &daily.id, true).is_err());
        let checks = todo_check(&c, &daily.id, "2026-11-06", true).unwrap();
        assert_eq!(checks, vec![TodoCheck { todo_id: daily.id.clone(), date: "2026-11-06".into() }]);
        todo_check(&c, &daily.id, "2026-11-06", true).unwrap();
        assert!(todo_check(&c, &daily.id, "2026-11-06", false).unwrap().is_empty());
        assert!(todo_check(&c, &fixed.id, "2026-11-06", true).is_err());
        assert!(todo_done(&c, &dated.id, true).unwrap().done_at.is_some());
        assert!(todo_done(&c, &dated.id, false).unwrap().done_at.is_none());

        let f = todo_update(&c, &fixed.id, TodoPatch { mode: Some("dated".into()), due_date: Some(Some("2026-12-01".into())), ..Default::default() }).unwrap();
        assert_eq!(f.due_date.as_deref(), Some("2026-12-01"));
        let f = todo_update(&c, &fixed.id, TodoPatch { mode: Some("fixed".into()), weekdays_only: Some(true), ..Default::default() }).unwrap();
        assert!(f.due_date.is_none() && !f.weekdays_only);
        assert!(todo_update(&c, &fixed.id, TodoPatch { mode: Some("semanal".into()), ..Default::default() }).is_err());

        let conv = todo_convert(&mut c, &dated.id).unwrap();
        assert_eq!(conv.change.item.title, "Mandar horas");
        assert_eq!(conv.change.item.company_id, "livelo");
        assert_eq!(conv.change.item.due_date.as_deref(), Some("2026-11-07"));
        assert!(conv.todo.done_at.is_some());
        assert_eq!(conv.todo.item_id.as_deref(), Some(conv.change.item.id.as_str()));
        assert!(todo_convert(&mut c, &dated.id).is_err());
        assert!(todo_convert(&mut c, &daily.id).is_err());

        assert!(company_delete(&c, &MemVault::default(), "pessoal").is_err());
        todo_delete(&c, &daily.id).unwrap();
        let st = load(&c).unwrap();
        assert_eq!(st.todos.len(), 2);
        assert!(st.todo_checks.is_empty());
    }

    #[test]
    fn importa_tarefas_antigas_uma_vez() {
        let (mut c, _t) = fresh();
        let tasks = vec![
            ImportTask { title: "Pagar boleto".into(), note: "luz".into(), due_date: Some("2026-11-10".into()), priority: 1, done_at: None },
            ImportTask { title: "Ler livro".into(), note: "".into(), due_date: None, priority: 0, done_at: Some("2026-11-01T10:00:00.000Z".into()) },
            ImportTask { title: "  ".into(), note: "".into(), due_date: None, priority: 0, done_at: None },
            ImportTask { title: "Data ruim".into(), note: "".into(), due_date: Some("amanhã".into()), priority: 0, done_at: None },
        ];
        assert_eq!(todos_import(&mut c, tasks).unwrap(), 3);
        let all: Vec<Todo> = {
            let mut st = c.prepare(&format!("SELECT {TODO_COLS} FROM work_todos ORDER BY sort")).unwrap();
            st.query_map([], todo_from).unwrap().collect::<rusqlite::Result<_>>().unwrap()
        };
        assert_eq!(all.len(), 3);
        assert!(all.iter().all(|t| t.company_id == "pessoal"));
        assert_eq!((all[0].mode.as_str(), all[0].priority.as_str()), ("dated", "alta"));
        assert_eq!(all[1].mode, "fixed");
        assert!(all[1].done_at.is_some());
        assert_eq!(all[2].mode, "fixed");
        let again = vec![ImportTask { title: "x".into(), note: "".into(), due_date: None, priority: 0, done_at: None }];
        assert_eq!(todos_import(&mut c, again).unwrap(), 0);
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    #[test]
    fn anexos_validam_bytes_e_somem_com_o_item() {
        let (mut c, t) = fresh();
        let dir = t.0.clone();
        let it = item(&mut c, "livelo", "Print do erro");
        assert!(attachment_save(&c, &dir, &it.id, b"texto").is_err());
        assert!(attachment_save(&c, &dir, &it.id, &[]).is_err());
        assert!(attachment_save(&c, &dir, "nada", PNG).is_err());
        let big = [PNG, &vec![0u8; MAX_ASSET_BYTES]].concat();
        assert!(attachment_save(&c, &dir, &it.id, &big).is_err());
        let a = attachment_save(&c, &dir, &it.id, PNG).unwrap();
        assert_eq!(a.mime, "image/png");
        let file = dir.join(format!("work-assets/{}.png", a.id));
        assert!(file.exists());
        assert!(attachment_data_url(&c, &dir, &a.id).unwrap().starts_with("data:image/png;base64,"));
        let b = attachment_save(&c, &dir, &it.id, PNG).unwrap();
        attachment_delete(&c, &dir, &b.id).unwrap();
        assert!(!dir.join(format!("work-assets/{}.png", b.id)).exists());
        assert_eq!(load(&c).unwrap().attachments.len(), 1);
        delete(&mut c, &dir, &MemVault::default(), &it.id).unwrap();
        assert!(!file.exists());
        assert!(load(&c).unwrap().attachments.is_empty());
        assert!(!safe_rel("work-assets/../x"));
        assert!(!safe_rel("note-assets/x.png"));
    }

    #[test]
    fn segredos_ficam_fora_do_banco() {
        let (mut c, t) = fresh();
        let v = MemVault::default();
        let it = item(&mut c, "statix", "Banco de homologação");
        assert!(secret_add(&mut c, &v, Some(it.id.clone()), None, "senha", "").is_err());
        assert!(secret_add(&mut c, &v, None, None, "senha", "x").is_err());
        assert!(secret_add(&mut c, &v, Some(it.id.clone()), Some("statix".into()), "senha", "x").is_err());
        let s = secret_add(&mut c, &v, Some(it.id.clone()), None, "Senha do banco", "hunter2-super").unwrap();
        let co = secret_add(&mut c, &v, None, Some("statix".into()), "VPN", "vpn-123").unwrap();
        assert_eq!(secret_reveal(&c, &v, &s.id).unwrap(), "hunter2-super");
        let dump: String = {
            let mut st = c.prepare("SELECT group_concat(label || coalesce(item_id,'') || coalesce(company_id,''), '|') FROM work_secrets").unwrap();
            st.query_row([], |r| r.get(0)).unwrap()
        };
        assert!(!dump.contains("hunter2"));
        let st = load(&c).unwrap();
        assert!(!serde_json::to_string(&st).unwrap().contains("hunter2"));
        assert_eq!(st.secrets.len(), 2);

        *v.1.borrow_mut() = true;
        assert!(secret_add(&mut c, &v, Some(it.id.clone()), None, "token", "abc").is_err());
        assert_eq!(load(&c).unwrap().secrets.len(), 2);
        *v.1.borrow_mut() = false;

        delete(&mut c, &t.0, &v, &it.id).unwrap();
        assert!(v.get(&s.id).is_err());
        assert!(secret_reveal(&c, &v, &s.id).is_err());
        secret_delete(&c, &v, &co.id).unwrap();
        assert!(v.0.borrow().is_empty());
    }

    #[test]
    fn dias_verdes() {
        let (c, _t) = fresh();
        let today: String = c.query_row("SELECT date('now')", [], |r| r.get(0)).unwrap();
        day_set(&c, DayMark { date: today.clone(), green: false, open_count: 2, handled_count: 1 }).unwrap();
        day_set(&c, DayMark { date: today.clone(), green: true, open_count: 0, handled_count: 3 }).unwrap();
        assert!(day_set(&c, DayMark { date: "ontem".into(), green: true, open_count: 0, handled_count: 0 }).is_err());
        let days = load(&c).unwrap().days;
        assert_eq!(days, vec![DayMark { date: today, green: true, open_count: 0, handled_count: 3 }]);
    }

    #[test]
    fn ajustes_de_notificacao() {
        let (c, _t) = fresh();
        let s = get_settings(&c).unwrap();
        assert!(s.notify_reminders && s.notify_due && s.notify_validation);
        assert_eq!(s.notify_hour, 9);
        let s2 = set_settings(&c, Settings { notify_due: false, notify_hour: 8, ..s.clone() }).unwrap();
        assert!(!s2.notify_due);
        assert_eq!(s2.notify_hour, 8);
        assert!(set_settings(&c, Settings { notify_hour: 24, ..s }).is_err());
    }

    #[test]
    fn cronometro_um_por_vez_e_para_ao_entregar() {
        let (mut c, t) = fresh();
        let a = item(&mut c, "statix", "a");
        let b = item(&mut c, "livelo", "b");
        let ch = timer_start(&mut c, &a.id).unwrap();
        assert_eq!(ch.sessions.len(), 1);
        assert!(ch.sessions[0].ended_at.is_none());
        assert_eq!(timer_start(&mut c, &a.id).unwrap().sessions.len(), 1);
        let ch = timer_start(&mut c, &b.id).unwrap();
        assert_eq!(ch.item_ids, vec![b.id.clone(), a.id.clone()]);
        let mine: Vec<_> = ch.sessions.iter().filter(|s| s.item_id == a.id).collect();
        assert!(mine[0].ended_at.is_some());
        assert!(c.execute("INSERT INTO work_sessions (id, item_id) VALUES ('x', ?1)", params![a.id]).is_err());
        check_all(&c, &b);
        let mv = move_stage(&mut c, &b.id, "delivered", false, None).unwrap();
        assert!(mv.sessions.iter().all(|s| s.ended_at.is_some()));
        assert!(timer_stop(&c).unwrap().item_ids.is_empty());
        timer_start(&mut c, &a.id).unwrap();
        let st = timer_stop(&c).unwrap();
        assert_eq!(st.item_ids, vec![a.id.clone()]);
        assert_eq!(load(&c).unwrap().sessions.len(), 3);
        let sid = st.sessions[0].id.clone();
        assert_eq!(session_delete(&c, &sid).unwrap().sessions.len(), 1);
        move_stage(&mut c, &a.id, "done", true, None).unwrap();
        assert!(timer_start(&mut c, &a.id).is_err());
        delete(&mut c, &t.0, &MemVault::default(), &a.id).unwrap();
        assert_eq!(load(&c).unwrap().sessions.len(), 1);
    }

    #[test]
    fn chamados_link_sla_e_respostas() {
        let (mut c, _t) = fresh();
        let st = load(&c).unwrap();
        assert_eq!(st.snippets.iter().filter(|x| x.company_id == "statix").count(), 2);
        assert!(st.snippets.iter().any(|x| x.company_id == "livelo" && x.is_default));
        let co = company_update(
            &c,
            "statix",
            CompanyPatch { ticket_url: Some(Some("https://statix.zendesk.com/agent/tickets/{id}".into())), sla_response_min: Some(Some(240)), sla_resolution_min: Some(Some(2880)), ..Default::default() },
        )
        .unwrap();
        assert_eq!(co.ticket_url.as_deref(), Some("https://statix.zendesk.com/agent/tickets/{id}"));
        assert_eq!((co.sla_response_min, co.sla_resolution_min), (Some(240), Some(2880)));
        assert!(company_update(&c, "statix", CompanyPatch { ticket_url: Some(Some("https://x/tickets/123".into())), ..Default::default() }).is_err());
        assert!(company_update(&c, "statix", CompanyPatch { ticket_url: Some(Some("ftp://x/{id}".into())), ..Default::default() }).is_err());
        assert!(company_update(&c, "statix", CompanyPatch { sla_response_min: Some(Some(0)), ..Default::default() }).is_err());
        let co = company_update(&c, "statix", CompanyPatch { sla_response_min: Some(None), ..Default::default() }).unwrap();
        assert!(co.sla_response_min.is_none());
        assert_eq!(co.sla_resolution_min, Some(2880));

        let list = snippet_save(&mut c, SnippetInput { id: None, company_id: "statix".into(), title: "Cobrança".into(), body: "Conseguiu validar o {chamado}?".into(), is_default: Some(true) }).unwrap();
        let mine: Vec<_> = list.iter().filter(|x| x.company_id == "statix").collect();
        assert_eq!(mine.len(), 3);
        assert_eq!(mine.iter().filter(|x| x.is_default).count(), 1);
        assert_eq!(mine.iter().find(|x| x.is_default).unwrap().title, "Cobrança");
        let id = mine.iter().find(|x| x.title == "Cobrança").unwrap().id.clone();
        let list = snippet_save(&mut c, SnippetInput { id: Some(id.clone()), company_id: "statix".into(), title: "Cobrança gentil".into(), body: "Oi! {chamado}".into(), is_default: Some(false) }).unwrap();
        assert!(list.iter().any(|x| x.title == "Cobrança gentil"));
        assert!(snippet_save(&mut c, SnippetInput { id: None, company_id: "acme".into(), title: "x".into(), body: "y".into(), is_default: None }).is_err());
        assert!(snippet_save(&mut c, SnippetInput { id: None, company_id: "statix".into(), title: "x".into(), body: "  ".into(), is_default: None }).is_err());
        assert!(snippet_save(&mut c, SnippetInput { id: Some("nada".into()), company_id: "statix".into(), title: "x".into(), body: "y".into(), is_default: None }).is_err());
        let list = snippet_delete(&c, &id).unwrap();
        assert!(list.iter().all(|x| x.id != id));
    }

    #[test]
    fn visto_por_empresa_e_ajustes_de_abandono() {
        let (c, _t) = fresh();
        assert!(load(&c).unwrap().seen.is_empty());
        let s1 = seen_touch(&c, "statix").unwrap();
        assert_eq!(s1.len(), 1);
        let first = s1[0].seen_at.clone();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let s2 = seen_touch(&c, "statix").unwrap();
        assert!(s2[0].seen_at > first);
        assert!(seen_touch(&c, "acme").is_err());
        let st = get_settings(&c).unwrap();
        assert!(st.notify_neglect);
        assert_eq!((st.neglect_hour, st.neglect_days, st.quiet_start, st.quiet_end), (11, 3, 20, 8));
        let ok = set_settings(&c, Settings { neglect_hour: 10, neglect_days: 5, quiet_start: 22, quiet_end: 7, ..st.clone() }).unwrap();
        assert_eq!((ok.neglect_hour, ok.neglect_days, ok.quiet_start, ok.quiet_end), (10, 5, 22, 7));
        assert!(set_settings(&c, Settings { neglect_days: 0, ..st.clone() }).is_err());
        assert!(set_settings(&c, Settings { quiet_end: 24, ..st }).is_err());
        let json: Settings = serde_json::from_str(r#"{"wipLimit":3,"validationDays":2,"waitingDays":2,"staleDays":4,"returnDays":0,"closeDays":2,"notifyReminders":true,"notifyDue":true,"notifyValidation":true,"notifyHour":9}"#).unwrap();
        assert_eq!(json.neglect_hour, 11);
    }
}
