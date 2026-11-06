
use crate::db;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub conn: Mutex<Option<Connection>>,
    pub open_error: Option<String>,
    pub data_dir: PathBuf,
}

pub(crate) type R<T> = Result<T, String>;

pub(crate) fn with_conn<T>(state: &State<AppState>, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> R<T> {
    let mut guard = state.conn.lock().map_err(|_| "banco ocupado".to_string())?;
    let conn = guard
        .as_mut()
        .ok_or_else(|| state.open_error.clone().unwrap_or_else(|| "banco indisponível".into()))?;
    f(conn).map_err(|e| e.to_string())
}

pub(crate) fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    path: String,
    schema_version: i64,
    error: Option<String>,
}

#[tauri::command]
pub fn db_info(state: State<AppState>) -> R<DbInfo> {
    let path = state.data_dir.join("personal-space.sqlite").to_string_lossy().to_string();
    let guard = state.conn.lock().map_err(|_| "banco ocupado".to_string())?;
    let schema_version = match guard.as_ref() {
        Some(c) => db::schema_version(c).map_err(|e| e.to_string())?,
        None => 0,
    };
    Ok(DbInfo { path, schema_version, error: state.open_error.clone() })
}

#[tauri::command]
pub fn backup_now(state: State<AppState>) -> R<String> {
    let guard = state.conn.lock().map_err(|_| "banco ocupado".to_string())?;
    let conn = guard.as_ref().ok_or("banco indisponível")?;
    let path = db::backup_to(conn, &state.data_dir.join("backups"), "backup")?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn setting_get(state: State<AppState>, key: String) -> R<Option<String>> {
    with_conn(&state, |c| {
        c.query_row("SELECT value FROM app_settings WHERE key = ?1", params![key], |r| r.get(0))
            .optional()
    })
}

#[tauri::command]
pub fn setting_set(state: State<AppState>, key: String, value: String) -> R<()> {
    with_conn(&state, |c| {
        c.execute(
            &format!(
                "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = {NOW}"
            ),
            params![key, value],
        )
        .map(|_| ())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    id: String,
    title: String,
    note: String,
    due_date: Option<String>,
    priority: i64,
    sort: f64,
    done_at: Option<String>,
    created_at: String,
}

fn task_from(r: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        note: r.get(2)?,
        due_date: r.get(3)?,
        priority: r.get(4)?,
        sort: r.get(5)?,
        done_at: r.get(6)?,
        created_at: r.get(7)?,
    })
}

const TASK_COLS: &str = "id, title, note, due_date, priority, sort, done_at, created_at";

fn get_task(c: &Connection, id: &str) -> rusqlite::Result<Task> {
    c.query_row(&format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"), params![id], task_from)
}

#[tauri::command]
pub fn tasks_list(state: State<AppState>) -> R<Vec<Task>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE archived_at IS NULL ORDER BY sort"
        ))?;
        st.query_map([], task_from)?.collect()
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    title: String,
    note: Option<String>,
    due_date: Option<String>,
    priority: Option<i64>,
}

#[tauri::command]
pub fn task_create(state: State<AppState>, input: NewTask) -> R<Task> {
    if input.title.trim().is_empty() {
        return Err("a tarefa precisa de um título".into());
    }
    with_conn(&state, |c| {
        let id = new_id();
        c.execute(
            "INSERT INTO tasks (id, title, note, due_date, priority, sort)
             VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(sort), 0) + 1 FROM tasks))",
            params![
                id,
                input.title.trim(),
                input.note.unwrap_or_default(),
                input.due_date.filter(|d| !d.is_empty()),
                input.priority.unwrap_or(0)
            ],
        )?;
        get_task(c, &id)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    title: Option<String>,
    note: Option<String>,
    due_date: Option<String>,
    priority: Option<i64>,
    done: Option<bool>,
}

#[tauri::command]
pub fn task_update(state: State<AppState>, id: String, patch: TaskPatch) -> R<Task> {
    if matches!(&patch.title, Some(t) if t.trim().is_empty()) {
        return Err("a tarefa precisa de um título".into());
    }
    with_conn(&state, |c| {
        let tx = c.transaction()?;
        if let Some(t) = &patch.title {
            tx.execute(&format!("UPDATE tasks SET title = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, t.trim()])?;
        }
        if let Some(n) = &patch.note {
            tx.execute(&format!("UPDATE tasks SET note = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, n])?;
        }
        if let Some(d) = &patch.due_date {
            let v: Option<&str> = if d.is_empty() { None } else { Some(d) };
            tx.execute(&format!("UPDATE tasks SET due_date = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, v])?;
        }
        if let Some(p) = patch.priority {
            tx.execute(&format!("UPDATE tasks SET priority = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, p])?;
        }
        if let Some(done) = patch.done {
            let sql = if done {
                format!("UPDATE tasks SET done_at = COALESCE(done_at, {NOW}), updated_at = {NOW} WHERE id = ?1")
            } else {
                format!("UPDATE tasks SET done_at = NULL, updated_at = {NOW} WHERE id = ?1")
            };
            tx.execute(&sql, params![id])?;
        }
        tx.commit()?;
        get_task(c, &id)
    })
}

#[tauri::command]
pub fn task_delete(state: State<AppState>, id: String) -> R<()> {
    with_conn(&state, |c| c.execute("DELETE FROM tasks WHERE id = ?1", params![id]).map(|_| ()))
}

#[tauri::command]
pub fn tasks_reorder(state: State<AppState>, ids: Vec<String>) -> R<()> {
    with_conn(&state, |c| {
        let tx = c.transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute("UPDATE tasks SET sort = ?2 WHERE id = ?1", params![id, i as f64])?;
        }
        tx.commit()
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    from_date: String,
    days: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pause {
    from_date: String,
    to_date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    id: String,
    name: String,
    time_of_day: Option<String>,
    cue: String,
    minimum: String,
    why: String,
    obstacle_plan: String,
    start_date: String,
    sort: f64,
    archived_at: Option<String>,
    schedules: Vec<Schedule>,
    pauses: Vec<Pause>,
}

fn load_habit(c: &Connection, id: &str) -> rusqlite::Result<Habit> {
    let mut h = c.query_row(
        "SELECT id, name, time_of_day, cue, minimum, why, obstacle_plan, start_date, sort, archived_at
         FROM habits WHERE id = ?1",
        params![id],
        |r| {
            Ok(Habit {
                id: r.get(0)?,
                name: r.get(1)?,
                time_of_day: r.get(2)?,
                cue: r.get(3)?,
                minimum: r.get(4)?,
                why: r.get(5)?,
                obstacle_plan: r.get(6)?,
                start_date: r.get(7)?,
                sort: r.get(8)?,
                archived_at: r.get(9)?,
                schedules: vec![],
                pauses: vec![],
            })
        },
    )?;
    let mut st = c.prepare("SELECT from_date, days FROM habit_schedules WHERE habit_id = ?1 ORDER BY from_date")?;
    h.schedules = st
        .query_map(params![id], |r| Ok(Schedule { from_date: r.get(0)?, days: r.get(1)? }))?
        .collect::<rusqlite::Result<_>>()?;
    let mut st = c.prepare("SELECT from_date, to_date FROM habit_pauses WHERE habit_id = ?1 ORDER BY from_date")?;
    h.pauses = st
        .query_map(params![id], |r| Ok(Pause { from_date: r.get(0)?, to_date: r.get(1)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(h)
}

#[tauri::command]
pub fn habits_list(state: State<AppState>) -> R<Vec<Habit>> {
    with_conn(&state, |c| {
        let ids: Vec<String> = {
            let mut st = c.prepare("SELECT id FROM habits WHERE archived_at IS NULL ORDER BY sort")?;
            st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
        };
        ids.iter().map(|id| load_habit(c, id)).collect()
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewHabit {
    name: String,
    days: i64,
    time_of_day: Option<String>,
    cue: Option<String>,
    minimum: Option<String>,
    why: Option<String>,
    obstacle_plan: Option<String>,
    start_date: String,
}

#[tauri::command]
pub fn habit_create(state: State<AppState>, input: NewHabit) -> R<Habit> {
    if input.name.trim().is_empty() {
        return Err("o hábito precisa de um nome".into());
    }
    if !(1..=127).contains(&input.days) {
        return Err("escolha pelo menos um dia da semana".into());
    }
    with_conn(&state, |c| {
        let id = new_id();
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO habits (id, name, time_of_day, cue, minimum, why, obstacle_plan, start_date, sort)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, (SELECT COALESCE(MAX(sort), 0) + 1 FROM habits))",
            params![
                id,
                input.name.trim(),
                input.time_of_day.filter(|t| !t.is_empty()),
                input.cue.unwrap_or_default(),
                input.minimum.unwrap_or_default(),
                input.why.unwrap_or_default(),
                input.obstacle_plan.unwrap_or_default(),
                input.start_date
            ],
        )?;
        tx.execute(
            "INSERT INTO habit_schedules (habit_id, from_date, days) VALUES (?1, ?2, ?3)",
            params![id, input.start_date, input.days],
        )?;
        tx.commit()?;
        load_habit(c, &id)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitPatch {
    name: Option<String>,
    days: Option<i64>,
    time_of_day: Option<String>,
    cue: Option<String>,
    minimum: Option<String>,
    why: Option<String>,
    obstacle_plan: Option<String>,
    today: String,
}

#[tauri::command]
pub fn habit_update(state: State<AppState>, id: String, patch: HabitPatch) -> R<Habit> {
    with_conn(&state, |c| {
        let tx = c.transaction()?;
        let set = |col: &str, v: &Option<String>| -> rusqlite::Result<()> {
            if let Some(v) = v {
                tx.execute(&format!("UPDATE habits SET {col} = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, v])?;
            }
            Ok(())
        };
        if let Some(n) = &patch.name {
            if !n.trim().is_empty() {
                set("name", &Some(n.trim().to_string()))?;
            }
        }
        set("cue", &patch.cue)?;
        set("minimum", &patch.minimum)?;
        set("why", &patch.why)?;
        set("obstacle_plan", &patch.obstacle_plan)?;
        if let Some(t) = &patch.time_of_day {
            let v: Option<&str> = if t.is_empty() { None } else { Some(t) };
            tx.execute(&format!("UPDATE habits SET time_of_day = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, v])?;
        }
        if let Some(days) = patch.days.filter(|d| (1..=127).contains(d)) {
            let current: Option<i64> = tx
                .query_row(
                    "SELECT days FROM habit_schedules WHERE habit_id = ?1 ORDER BY from_date DESC LIMIT 1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            if current != Some(days) {
                tx.execute(
                    "INSERT INTO habit_schedules (habit_id, from_date, days) VALUES (?1, ?2, ?3)
                     ON CONFLICT (habit_id, from_date) DO UPDATE SET days = excluded.days",
                    params![id, patch.today, days],
                )?;
            }
        }
        tx.commit()?;
        load_habit(c, &id)
    })
}

#[tauri::command]
pub fn habit_set_paused(state: State<AppState>, id: String, paused: bool, today: String) -> R<Habit> {
    with_conn(&state, |c| {
        let open: Option<String> = c
            .query_row(
                "SELECT from_date FROM habit_pauses WHERE habit_id = ?1 AND to_date IS NULL",
                params![id],
                |r| r.get(0),
            )
            .optional()?;
        match (paused, open) {
            (true, None) => {
                c.execute(
                    "INSERT INTO habit_pauses (habit_id, from_date) VALUES (?1, ?2)
                     ON CONFLICT (habit_id, from_date) DO UPDATE SET to_date = NULL",
                    params![id, today],
                )?;
            }
            (false, Some(from)) => {
                c.execute(
                    "UPDATE habit_pauses SET to_date = ?3 WHERE habit_id = ?1 AND from_date = ?2",
                    params![id, from, today],
                )?;
            }
            _ => {}
        }
        load_habit(c, &id)
    })
}

#[tauri::command]
pub fn habit_archive(state: State<AppState>, id: String) -> R<()> {
    with_conn(&state, |c| {
        c.execute(&format!("UPDATE habits SET archived_at = {NOW} WHERE id = ?1"), params![id]).map(|_| ())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkin {
    habit_id: String,
    date: String,
    status: String,
}

#[tauri::command]
pub fn checkins_range(state: State<AppState>, from: String, to: String) -> R<Vec<Checkin>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(
            "SELECT habit_id, date, status FROM habit_checkins WHERE date BETWEEN ?1 AND ?2 ORDER BY date",
        )?;
        st.query_map(params![from, to], |r| Ok(Checkin { habit_id: r.get(0)?, date: r.get(1)?, status: r.get(2)? }))?
            .collect()
    })
}

#[tauri::command]
pub fn checkin_set(state: State<AppState>, habit_id: String, date: String, status: Option<String>) -> R<()> {
    with_conn(&state, |c| {
        match status.as_deref() {
            None => c.execute("DELETE FROM habit_checkins WHERE habit_id = ?1 AND date = ?2", params![habit_id, date])?,
            Some(s) => c.execute(
                &format!(
                    "INSERT INTO habit_checkins (habit_id, date, status) VALUES (?1, ?2, ?3)
                     ON CONFLICT (habit_id, date) DO UPDATE SET status = excluded.status, updated_at = {NOW}"
                ),
                params![habit_id, date, s],
            )?,
        };
        Ok(())
    })
}
