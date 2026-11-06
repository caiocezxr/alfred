
use crate::commands::{AppState, NOW, R, new_id, with_conn};
use rusqlite::{Connection, OptionalExtension, Row, ToSql, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use tauri::State;

const KINDS: &[&str] = &["product", "content"];
const STATUSES: &[&str] = &["captured", "evaluating", "testing", "paused", "archived"];
const DECISIONS: &[&str] = &["continue", "adjust", "archive"];
const EVIDENCE_KINDS: &[&str] = &["note", "result"];
const SIGNALS: &[&str] = &["supports", "contradicts", "neutral"];
const CRITERIA: &[&str] = &[
    "pain", "distribution", "monetization", "test", "execution", "evidence",
    "audience", "discovery", "format", "cost", "future", "signal",
];

const TITLE_MAX: usize = 200;
const DESCRIPTION_MAX: usize = 5000;
const NOTE_MAX: usize = 2000;
const TEXT_MAX: usize = 4000;
const SHORT_MAX: usize = 500;
const METRIC_MAX: usize = 120;
const URL_MAX: usize = 2048;
const ANSWERS_MAX: usize = 64;
const MONEY_MAX: f64 = 1e12;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub choice: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NextTest {
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub max_spend: f64,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub deadline: String,
    #[serde(default)]
    pub criterion: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    id: String,
    idea_id: String,
    kind: String,
    criterion: Option<String>,
    signal: String,
    text: String,
    url: Option<String>,
    metric: Option<String>,
    value: Option<f64>,
    cost: Option<f64>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Idea {
    id: String,
    kind: String,
    title: String,
    description: String,
    answers: BTreeMap<String, Answer>,
    status: String,
    next_test: Option<NextTest>,
    decision: Option<String>,
    decision_note: String,
    decided_at: Option<String>,
    created_at: String,
    updated_at: String,
    evidence: Vec<Evidence>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewIdea {
    kind: String,
    title: String,
    description: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IdeaPatch {
    title: Option<String>,
    description: Option<String>,
    kind: Option<String>,
    status: Option<String>,
    decision: Option<String>,
    decision_note: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewEvidence {
    idea_id: String,
    kind: String,
    criterion: Option<String>,
    signal: Option<String>,
    text: Option<String>,
    url: Option<String>,
    metric: Option<String>,
    value: Option<f64>,
    cost: Option<f64>,
}

fn db(e: rusqlite::Error) -> String {
    e.to_string()
}

fn limit(s: &str, max: usize, what: &str) -> R<()> {
    if s.chars().count() > max {
        return Err(format!("{what} passa do limite de {max} caracteres"));
    }
    Ok(())
}

fn one_of(v: &str, allowed: &[&str], what: &str) -> R<()> {
    if allowed.contains(&v) { Ok(()) } else { Err(format!("{what} inválido: {v}")) }
}

fn valid_slug(s: &str) -> bool {
    s.len() <= 40
        && s.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn clean_title(t: &str) -> R<String> {
    let t = t.trim();
    if t.is_empty() {
        return Err("a ideia precisa de um título".into());
    }
    limit(t, TITLE_MAX, "o título")?;
    Ok(t.to_string())
}

fn clean_url(u: Option<&str>) -> R<Option<String>> {
    let Some(u) = u.map(str::trim).filter(|u| !u.is_empty()) else {
        return Ok(None);
    };
    let lower = u.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"));
    if !rest.is_some_and(|r| !r.is_empty() && !r.starts_with('/')) {
        return Err("o link precisa começar com http:// ou https://".into());
    }
    if u.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("o link não pode ter espaços".into());
    }
    if u.len() > URL_MAX {
        return Err("o link é longo demais".into());
    }
    Ok(Some(u.to_string()))
}

fn is_civil_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

fn money(v: f64, what: &str) -> R<()> {
    if !v.is_finite() || !(0.0..=MONEY_MAX).contains(&v) {
        return Err(format!("{what} inválido"));
    }
    Ok(())
}

fn ensure_exists(c: &Connection, id: &str) -> R<()> {
    let found: Option<i64> = c.query_row("SELECT 1 FROM ideas WHERE id = ?1", params![id], |r| r.get(0)).optional().map_err(db)?;
    found.map(|_| ()).ok_or_else(|| "ideia não encontrada".to_string())
}

const IDEA_COLS: &str =
    "id, kind, title, description, answers, status, next_test, decision, decision_note, decided_at, created_at, updated_at";
const EV_COLS: &str = "id, idea_id, kind, criterion, signal, text, url, metric, value, cost, created_at, updated_at";

fn idea_from(r: &Row) -> rusqlite::Result<Idea> {
    let answers: String = r.get(4)?;
    let next: Option<String> = r.get(6)?;
    Ok(Idea {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        description: r.get(3)?,
        answers: serde_json::from_str(&answers).unwrap_or_default(),
        status: r.get(5)?,
        next_test: next.and_then(|s| serde_json::from_str(&s).ok()),
        decision: r.get(7)?,
        decision_note: r.get(8)?,
        decided_at: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        evidence: Vec::new(),
    })
}

fn evidence_from(r: &Row) -> rusqlite::Result<Evidence> {
    Ok(Evidence {
        id: r.get(0)?,
        idea_id: r.get(1)?,
        kind: r.get(2)?,
        criterion: r.get(3)?,
        signal: r.get(4)?,
        text: r.get(5)?,
        url: r.get(6)?,
        metric: r.get(7)?,
        value: r.get(8)?,
        cost: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

pub(crate) fn list(c: &Connection) -> R<Vec<Idea>> {
    let mut st = c.prepare(&format!("SELECT {IDEA_COLS} FROM ideas ORDER BY created_at DESC, id")).map_err(db)?;
    let mut ideas = st.query_map([], idea_from).map_err(db)?.collect::<rusqlite::Result<Vec<_>>>().map_err(db)?;
    let mut st = c.prepare(&format!("SELECT {EV_COLS} FROM idea_evidence ORDER BY created_at, id")).map_err(db)?;
    let mut by_idea: HashMap<String, Vec<Evidence>> = HashMap::new();
    for e in st.query_map([], evidence_from).map_err(db)? {
        let e = e.map_err(db)?;
        by_idea.entry(e.idea_id.clone()).or_default().push(e);
    }
    for i in &mut ideas {
        i.evidence = by_idea.remove(&i.id).unwrap_or_default();
    }
    Ok(ideas)
}

pub(crate) fn get(c: &Connection, id: &str) -> R<Idea> {
    let mut idea = c
        .query_row(&format!("SELECT {IDEA_COLS} FROM ideas WHERE id = ?1"), params![id], idea_from)
        .optional()
        .map_err(db)?
        .ok_or_else(|| "ideia não encontrada".to_string())?;
    let mut st = c
        .prepare(&format!("SELECT {EV_COLS} FROM idea_evidence WHERE idea_id = ?1 ORDER BY created_at, id"))
        .map_err(db)?;
    idea.evidence = st.query_map(params![id], evidence_from).map_err(db)?.collect::<rusqlite::Result<_>>().map_err(db)?;
    Ok(idea)
}

pub(crate) fn create(c: &Connection, input: NewIdea) -> R<Idea> {
    one_of(&input.kind, KINDS, "tipo")?;
    let title = clean_title(&input.title)?;
    let description = input.description.unwrap_or_default().trim().to_string();
    limit(&description, DESCRIPTION_MAX, "a descrição")?;
    let id = new_id();
    c.execute(
        "INSERT INTO ideas (id, kind, title, description) VALUES (?1, ?2, ?3, ?4)",
        params![id, input.kind, title, description],
    )
    .map_err(db)?;
    get(c, &id)
}

fn set_col(c: &Connection, id: &str, col: &str, v: &dyn ToSql) -> R<()> {
    c.execute(&format!("UPDATE ideas SET {col} = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, v])
        .map(|_| ())
        .map_err(db)
}

pub(crate) fn update(c: &mut Connection, id: &str, patch: IdeaPatch) -> R<Idea> {
    let title = patch.title.as_deref().map(clean_title).transpose()?;
    let description = patch.description.as_deref().map(|d| d.trim().to_string());
    if let Some(d) = &description {
        limit(d, DESCRIPTION_MAX, "a descrição")?;
    }
    if let Some(k) = &patch.kind {
        one_of(k, KINDS, "tipo")?;
    }
    if let Some(s) = &patch.status {
        one_of(s, STATUSES, "estado")?;
    }
    if let Some(d) = patch.decision.as_deref().filter(|d| !d.is_empty()) {
        one_of(d, DECISIONS, "decisão")?;
    }
    let note = patch.decision_note.as_deref().map(|n| n.trim().to_string());
    if let Some(n) = &note {
        limit(n, NOTE_MAX, "a nota da decisão")?;
    }

    let tx = c.transaction().map_err(db)?;
    ensure_exists(&tx, id)?;
    if let Some(t) = &title {
        set_col(&tx, id, "title", t)?;
    }
    if let Some(d) = &description {
        set_col(&tx, id, "description", d)?;
    }
    if let Some(k) = &patch.kind {
        set_col(&tx, id, "kind", k)?;
    }
    if let Some(s) = &patch.status {
        set_col(&tx, id, "status", s)?;
    }
    if let Some(n) = &note {
        set_col(&tx, id, "decision_note", n)?;
    }
    match patch.decision.as_deref() {
        Some("") => {
            tx.execute(&format!("UPDATE ideas SET decision = NULL, decided_at = NULL, updated_at = {NOW} WHERE id = ?1"), params![id])
                .map_err(db)?;
        }
        Some(d) => {
            tx.execute(&format!("UPDATE ideas SET decision = ?2, decided_at = {NOW}, updated_at = {NOW} WHERE id = ?1"), params![id, d])
                .map_err(db)?;
        }
        None => {}
    }
    tx.commit().map_err(db)?;
    get(c, id)
}

pub(crate) fn set_answer(c: &mut Connection, id: &str, question_id: &str, answer: Option<Answer>) -> R<Idea> {
    if !valid_slug(question_id) {
        return Err("pergunta inválida".into());
    }
    let answer = match answer {
        Some(a) => {
            if !valid_slug(&a.choice) {
                return Err("opção de resposta inválida".into());
            }
            let note = a.note.trim().to_string();
            limit(&note, NOTE_MAX, "o detalhe da resposta")?;
            Some(Answer { choice: a.choice, note })
        }
        None => None,
    };

    let tx = c.transaction().map_err(db)?;
    let (raw, status): (String, String) = tx
        .query_row("SELECT answers, status FROM ideas WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(db)?
        .ok_or_else(|| "ideia não encontrada".to_string())?;
    let mut answers: BTreeMap<String, Answer> =
        serde_json::from_str(&raw).map_err(|_| "as respostas guardadas estão num formato inesperado".to_string())?;
    match answer {
        Some(a) => {
            answers.insert(question_id.to_string(), a);
        }
        None => {
            answers.remove(question_id);
        }
    }
    if answers.len() > ANSWERS_MAX {
        return Err("respostas demais para uma ideia".into());
    }
    let json = serde_json::to_string(&answers).map_err(|e| e.to_string())?;
    let next_status = if status == "captured" && !answers.is_empty() { "evaluating" } else { status.as_str() };
    tx.execute(
        &format!("UPDATE ideas SET answers = ?2, status = ?3, updated_at = {NOW} WHERE id = ?1"),
        params![id, json, next_status],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    get(c, id)
}

pub(crate) fn set_next_test(c: &Connection, id: &str, next: Option<NextTest>) -> R<Idea> {
    let json = match next {
        Some(mut n) => {
            n.action = n.action.trim().to_string();
            n.target = n.target.trim().to_string();
            n.goal = n.goal.trim().to_string();
            n.deadline = n.deadline.trim().to_string();
            n.criterion = n.criterion.filter(|c| !c.is_empty());
            n.started_at = n.started_at.filter(|s| !s.is_empty());
            limit(&n.action, NOTE_MAX, "a ação")?;
            limit(&n.target, SHORT_MAX, "quem abordar / onde publicar")?;
            limit(&n.goal, SHORT_MAX, "a meta")?;
            money(n.max_spend, "investimento máximo")?;
            if !n.deadline.is_empty() && !is_civil_date(&n.deadline) {
                return Err("prazo inválido (use AAAA-MM-DD)".into());
            }
            if let Some(cr) = &n.criterion {
                one_of(cr, CRITERIA, "critério")?;
            }
            if n.started_at.as_ref().is_some_and(|s| s.len() > 40) {
                return Err("início do teste inválido".into());
            }
            Some(serde_json::to_string(&n).map_err(|e| e.to_string())?)
        }
        None => None,
    };
    let changed = c
        .execute(&format!("UPDATE ideas SET next_test = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, json])
        .map_err(db)?;
    if changed == 0 {
        return Err("ideia não encontrada".into());
    }
    get(c, id)
}

pub(crate) fn delete(c: &Connection, id: &str) -> R<()> {
    c.execute("DELETE FROM ideas WHERE id = ?1", params![id]).map(|_| ()).map_err(db)
}

pub(crate) fn evidence_add(c: &mut Connection, input: NewEvidence) -> R<Evidence> {
    one_of(&input.kind, EVIDENCE_KINDS, "tipo de evidência")?;
    let is_result = input.kind == "result";
    let signal = input.signal.unwrap_or_else(|| "neutral".into());
    one_of(&signal, SIGNALS, "sinal")?;
    let criterion = input.criterion.filter(|c| !c.is_empty());
    if let Some(cr) = &criterion {
        one_of(cr, CRITERIA, "critério")?;
    }
    let text = input.text.unwrap_or_default().trim().to_string();
    limit(&text, TEXT_MAX, "o comentário")?;
    let url = clean_url(input.url.as_deref())?;
    let (metric, value, cost) = if is_result {
        let metric = input.metric.map(|m| m.trim().to_string()).filter(|m| !m.is_empty());
        let (Some(metric), Some(value)) = (metric, input.value) else {
            return Err("o resultado precisa de uma métrica e de um valor".into());
        };
        limit(&metric, METRIC_MAX, "a métrica")?;
        if !value.is_finite() || value.abs() > MONEY_MAX {
            return Err("valor do resultado inválido".into());
        }
        if let Some(cost) = input.cost {
            money(cost, "custo")?;
        }
        (Some(metric), Some(value), input.cost)
    } else {
        if text.is_empty() && url.is_none() {
            return Err("escreva um comentário ou cole um link".into());
        }
        (None, None, None)
    };

    let tx = c.transaction().map_err(db)?;
    ensure_exists(&tx, &input.idea_id)?;
    let id = new_id();
    tx.execute(
        "INSERT INTO idea_evidence (id, idea_id, kind, criterion, signal, text, url, metric, value, cost)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, input.idea_id, input.kind, criterion, signal, text, url, metric, value, cost],
    )
    .map_err(db)?;
    tx.execute(&format!("UPDATE ideas SET updated_at = {NOW} WHERE id = ?1"), params![input.idea_id]).map_err(db)?;
    let e = tx
        .query_row(&format!("SELECT {EV_COLS} FROM idea_evidence WHERE id = ?1"), params![id], evidence_from)
        .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(e)
}

pub(crate) fn evidence_delete(c: &mut Connection, id: &str) -> R<()> {
    let tx = c.transaction().map_err(db)?;
    let idea_id: Option<String> = tx
        .query_row("SELECT idea_id FROM idea_evidence WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
        .map_err(db)?;
    if let Some(idea_id) = idea_id {
        tx.execute("DELETE FROM idea_evidence WHERE id = ?1", params![id]).map_err(db)?;
        tx.execute(&format!("UPDATE ideas SET updated_at = {NOW} WHERE id = ?1"), params![idea_id]).map_err(db)?;
    }
    tx.commit().map_err(db)
}

#[tauri::command]
pub fn ideas_list(state: State<AppState>) -> R<Vec<Idea>> {
    with_conn(&state, |c| Ok(list(c)))?
}

#[tauri::command]
pub fn idea_create(state: State<AppState>, input: NewIdea) -> R<Idea> {
    with_conn(&state, |c| Ok(create(c, input)))?
}

#[tauri::command]
pub fn idea_update(state: State<AppState>, id: String, patch: IdeaPatch) -> R<Idea> {
    with_conn(&state, |c| Ok(update(c, &id, patch)))?
}

#[tauri::command]
pub fn idea_set_answer(state: State<AppState>, id: String, question_id: String, answer: Option<Answer>) -> R<Idea> {
    with_conn(&state, |c| Ok(set_answer(c, &id, &question_id, answer)))?
}

#[tauri::command]
pub fn idea_set_next_test(state: State<AppState>, id: String, next_test: Option<NextTest>) -> R<Idea> {
    with_conn(&state, |c| Ok(set_next_test(c, &id, next_test)))?
}

#[tauri::command]
pub fn idea_delete(state: State<AppState>, id: String) -> R<()> {
    with_conn(&state, |c| Ok(delete(c, &id)))?
}

#[tauri::command]
pub fn idea_evidence_add(state: State<AppState>, input: NewEvidence) -> R<Evidence> {
    with_conn(&state, |c| Ok(evidence_add(c, input)))?
}

#[tauri::command]
pub fn idea_evidence_delete(state: State<AppState>, id: String) -> R<()> {
    with_conn(&state, |c| Ok(evidence_delete(c, &id)))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).ok();
        }
    }

    fn fresh() -> (Connection, Tmp) {
        let dir = std::env::temp_dir().join(format!("ps-ideas-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let conn = crate::db::open(&dir.join("t.sqlite"), &dir.join("b")).unwrap();
        (conn, Tmp(dir))
    }

    fn new_idea(kind: &str, title: &str) -> NewIdea {
        NewIdea { kind: kind.into(), title: title.into(), description: None }
    }

    fn answer(choice: &str, note: &str) -> Option<Answer> {
        Some(Answer { choice: choice.into(), note: note.into() })
    }

    fn note_ev(idea_id: &str, text: &str) -> NewEvidence {
        NewEvidence { idea_id: idea_id.into(), kind: "note".into(), text: Some(text.into()), ..Default::default() }
    }

    fn next_test() -> NextTest {
        NextTest {
            action: "5 conversas".into(),
            target: "nutricionistas".into(),
            max_spend: 0.0,
            goal: "3 de 5".into(),
            deadline: "2026-11-12".into(),
            criterion: Some("pain".into()),
            started_at: None,
        }
    }

    #[test]
    fn migracao_do_zero_cria_tabelas_indices_e_cascata() {
        let (c, _t) = fresh();
        let names: Vec<String> = c
            .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'idea%' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        for n in ["ideas", "idea_evidence", "ideas_by_status", "idea_evidence_by_idea"] {
            assert!(names.iter().any(|x| x == n), "faltou {n}: {names:?}");
        }
        let on_delete: String = c
            .query_row("SELECT on_delete FROM pragma_foreign_key_list('idea_evidence')", [], |r| r.get(0))
            .unwrap();
        assert_eq!(on_delete, "CASCADE");
    }

    #[test]
    fn cria_lista_e_atualiza() {
        let (mut c, _t) = fresh();
        let a = create(&c, NewIdea { kind: "product".into(), title: "  Agenda para nutris  ".into(), description: Some(" lembretes ".into()) }).unwrap();
        assert_eq!(a.title, "Agenda para nutris");
        assert_eq!(a.description, "lembretes");
        assert_eq!(a.status, "captured");
        assert!(a.answers.is_empty() && a.next_test.is_none() && a.decision.is_none());
        let b = create(&c, new_idea("content", "Canal de automação")).unwrap();

        let all = list(&c).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|i| i.id == b.id && i.kind == "content"));

        let u = update(&mut c, &a.id, IdeaPatch { title: Some("Agenda".into()), status: Some("paused".into()), kind: Some("content".into()), ..Default::default() }).unwrap();
        assert_eq!((u.title.as_str(), u.status.as_str(), u.kind.as_str()), ("Agenda", "paused", "content"));
    }

    #[test]
    fn respostas_salvam_uma_a_uma_sem_perder_as_outras() {
        let (mut c, _t) = fresh();
        let i = create(&c, new_idea("product", "Ideia")).unwrap();
        let i1 = set_answer(&mut c, &i.id, "p_who", answer("named", "  nutricionistas ")).unwrap();
        assert_eq!(i1.status, "evaluating", "a primeira resposta inicia a avaliação");
        assert_eq!(i1.answers["p_who"].note, "nutricionistas");
        set_answer(&mut c, &i.id, "p_channel", answer("paid", "")).unwrap();
        let i3 = set_answer(&mut c, &i.id, "p_who", answer("profile", "")).unwrap();
        assert_eq!(i3.answers.len(), 2);
        assert_eq!(i3.answers["p_who"].choice, "profile");
        let i4 = set_answer(&mut c, &i.id, "p_channel", None).unwrap();
        assert_eq!(i4.answers.len(), 1);

        update(&mut c, &i.id, IdeaPatch { status: Some("testing".into()), ..Default::default() }).unwrap();
        let i5 = set_answer(&mut c, &i.id, "p_test", answer("ready", "")).unwrap();
        assert_eq!(i5.status, "testing");

        let raw: String = c.query_row("SELECT answers FROM ideas WHERE id = ?1", params![i.id], |r| r.get(0)).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["p_test"]["choice"], "ready");
    }

    #[test]
    fn proximo_teste_e_decisao() {
        let (mut c, _t) = fresh();
        let i = create(&c, new_idea("product", "Ideia")).unwrap();
        let mut nt = next_test();
        nt.started_at = Some("2026-11-05T12:00:00.000Z".into());
        let i1 = set_next_test(&c, &i.id, Some(nt.clone())).unwrap();
        assert_eq!(i1.next_test, Some(nt));
        let i2 = set_next_test(&c, &i.id, None).unwrap();
        assert!(i2.next_test.is_none());

        let d = update(&mut c, &i.id, IdeaPatch { decision: Some("archive".into()), status: Some("archived".into()), decision_note: Some("sem canal".into()), ..Default::default() }).unwrap();
        assert_eq!(d.decision.as_deref(), Some("archive"));
        assert!(d.decided_at.is_some());
        assert_eq!(d.status, "archived");
        assert_eq!(d.decision_note, "sem canal");
        let cleared = update(&mut c, &i.id, IdeaPatch { decision: Some(String::new()), ..Default::default() }).unwrap();
        assert!(cleared.decision.is_none() && cleared.decided_at.is_none());
    }

    #[test]
    fn evidencias_adicionam_removem_e_caem_em_cascata() {
        let (mut c, _t) = fresh();
        let i = create(&c, new_idea("product", "Ideia")).unwrap();
        let e1 = evidence_add(&mut c, NewEvidence { criterion: Some("pain".into()), signal: Some("supports".into()), url: Some(" https://exemplo.com/post ".into()), ..note_ev(&i.id, "3 de 5 contaram um caso") }).unwrap();
        assert_eq!(e1.url.as_deref(), Some("https://exemplo.com/post"));
        assert_eq!(e1.signal, "supports");
        let e2 = evidence_add(&mut c, NewEvidence {
            idea_id: i.id.clone(), kind: "result".into(), metric: Some("cadastros".into()), value: Some(12.0), cost: Some(30.0),
            signal: Some("supports".into()), ..Default::default()
        }).unwrap();
        assert_eq!((e2.metric.as_deref(), e2.value, e2.cost), (Some("cadastros"), Some(12.0), Some(30.0)));

        let got = get(&c, &i.id).unwrap();
        assert_eq!(got.evidence.len(), 2);
        assert_eq!(list(&c).unwrap()[0].evidence.len(), 2);

        evidence_delete(&mut c, &e1.id).unwrap();
        evidence_delete(&mut c, &e1.id).unwrap();
        assert_eq!(get(&c, &i.id).unwrap().evidence.len(), 1);

        delete(&c, &i.id).unwrap();
        let left: i64 = c.query_row("SELECT count(*) FROM idea_evidence", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0, "ON DELETE CASCADE remove as evidências");
        assert_eq!(get(&c, &i.id).unwrap_err(), "ideia não encontrada");
    }

    #[test]
    fn validacao_recusa_entradas_ruins() {
        let (mut c, _t) = fresh();
        assert_eq!(create(&c, new_idea("product", "   ")).unwrap_err(), "a ideia precisa de um título");
        assert!(create(&c, new_idea("app", "Ideia")).unwrap_err().contains("tipo inválido"));
        assert!(create(&c, new_idea("product", &"x".repeat(201))).is_err());
        let i = create(&c, new_idea("product", "Ideia")).unwrap();

        let mut bad = |p: IdeaPatch| update(&mut c, &i.id, p).unwrap_err();
        assert!(bad(IdeaPatch { status: Some("done".into()), ..Default::default() }).contains("estado inválido"));
        assert!(bad(IdeaPatch { decision: Some("maybe".into()), ..Default::default() }).contains("decisão inválido"));
        assert!(bad(IdeaPatch { title: Some(" ".into()), ..Default::default() }).contains("título"));
        assert_eq!(update(&mut c, "nada", IdeaPatch::default()).unwrap_err(), "ideia não encontrada");

        assert_eq!(set_answer(&mut c, &i.id, "P WHO", answer("named", "")).unwrap_err(), "pergunta inválida");
        assert_eq!(set_answer(&mut c, &i.id, "p_who", answer("../x", "")).unwrap_err(), "opção de resposta inválida");
        assert!(set_answer(&mut c, &i.id, "p_who", answer("named", &"x".repeat(2001))).is_err());
        assert_eq!(set_answer(&mut c, "nada", "p_who", answer("named", "")).unwrap_err(), "ideia não encontrada");

        let mut nt = next_test();
        nt.deadline = "amanhã".into();
        assert!(set_next_test(&c, &i.id, Some(nt)).unwrap_err().contains("prazo"));
        let mut nt = next_test();
        nt.max_spend = -1.0;
        assert!(set_next_test(&c, &i.id, Some(nt)).is_err());
        let mut nt = next_test();
        nt.max_spend = f64::NAN;
        assert!(set_next_test(&c, &i.id, Some(nt)).is_err());
        let mut nt = next_test();
        nt.criterion = Some("vibes".into());
        assert!(set_next_test(&c, &i.id, Some(nt)).unwrap_err().contains("critério"));
        assert_eq!(set_next_test(&c, "nada", Some(next_test())).unwrap_err(), "ideia não encontrada");

        for url in ["ftp://exemplo.com", "javascript:alert(1)", "https://", "http:///x", "https://a b.com", "exemplo.com"] {
            let e = NewEvidence { url: Some(url.into()), ..note_ev(&i.id, "x") };
            assert!(evidence_add(&mut c, e).is_err(), "aceitou {url}");
        }
        assert!(evidence_add(&mut c, NewEvidence { url: Some("HTTPS://Exemplo.com/A".into()), ..note_ev(&i.id, "") }).is_ok(), "só link já basta");
        assert_eq!(evidence_add(&mut c, note_ev(&i.id, "  ")).unwrap_err(), "escreva um comentário ou cole um link");
        let result = |metric: Option<&str>, value: Option<f64>, cost: Option<f64>| NewEvidence {
            idea_id: i.id.clone(), kind: "result".into(), metric: metric.map(Into::into), value, cost, ..Default::default()
        };
        assert!(evidence_add(&mut c, result(None, Some(1.0), None)).unwrap_err().contains("métrica"));
        assert!(evidence_add(&mut c, result(Some("cliques"), None, None)).unwrap_err().contains("valor"));
        assert!(evidence_add(&mut c, result(Some("cliques"), Some(f64::INFINITY), None)).is_err());
        assert!(evidence_add(&mut c, result(Some("cliques"), Some(3.0), Some(-5.0))).is_err());
        assert!(evidence_add(&mut c, NewEvidence { kind: "rumor".into(), ..note_ev(&i.id, "x") }).is_err());
        assert!(evidence_add(&mut c, NewEvidence { signal: Some("maybe".into()), ..note_ev(&i.id, "x") }).is_err());
        assert!(evidence_add(&mut c, NewEvidence { criterion: Some("vibes".into()), ..note_ev(&i.id, "x") }).is_err());
        assert_eq!(evidence_add(&mut c, note_ev("nada", "x")).unwrap_err(), "ideia não encontrada");
    }

    #[test]
    fn restricoes_do_banco_seguram_dados_invalidos() {
        let (c, _t) = fresh();
        let ins = |sql: &str| c.execute(sql, []);
        assert!(ins("INSERT INTO ideas (id, kind, title) VALUES ('a', 'product', 'Ok')").is_ok());
        assert!(ins("INSERT INTO ideas (id, kind, title, status) VALUES ('b', 'product', 'X', 'done')").is_err());
        assert!(ins("INSERT INTO ideas (id, kind, title) VALUES ('c', 'app', 'X')").is_err());
        assert!(ins("INSERT INTO ideas (id, kind, title) VALUES ('d', 'product', '   ')").is_err());
        assert!(ins("INSERT INTO ideas (id, kind, title, answers) VALUES ('e', 'product', 'X', '{oops')").is_err());
        assert!(ins("INSERT INTO ideas (id, kind, title, answers) VALUES ('f', 'product', 'X', '[]')").is_err());
        assert!(ins("INSERT INTO ideas (id, kind, title, next_test) VALUES ('g', 'product', 'X', 'nope')").is_err());
        assert!(ins("INSERT INTO ideas (id, kind, title, decision) VALUES ('h', 'product', 'X', 'continue')").is_err(), "decisão sem data");
        assert!(ins("INSERT INTO idea_evidence (id, idea_id, kind, text) VALUES ('e1', 'a', 'note', 'ok')").is_ok());
        assert!(ins("INSERT INTO idea_evidence (id, idea_id, kind, text) VALUES ('e2', 'zzz', 'note', 'ok')").is_err(), "FK");
        assert!(ins("INSERT INTO idea_evidence (id, idea_id, kind, url) VALUES ('e3', 'a', 'note', 'ftp://x')").is_err());
        assert!(ins("INSERT INTO idea_evidence (id, idea_id, kind, metric) VALUES ('e4', 'a', 'result', 'cliques')").is_err(), "resultado sem valor");
        assert!(ins("INSERT INTO idea_evidence (id, idea_id, kind, text, cost) VALUES ('e5', 'a', 'note', 'x', -1)").is_err());
    }
}
