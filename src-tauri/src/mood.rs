use crate::commands::{with_conn, AppState, NOW, R};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayCheckin {
    date: String,
    mood: Option<i64>,
    note: String,
    coffee: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DayPatch {
    #[serde(default, with = "double_option")]
    mood: Option<Option<i64>>,
    note: Option<String>,
    #[serde(default, with = "double_option")]
    coffee: Option<Option<bool>>,
}

mod double_option {
    use serde::{Deserialize, Deserializer};
    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
        Deserialize::deserialize(d).map(Some)
    }
}

fn row(r: &Row) -> rusqlite::Result<DayCheckin> {
    Ok(DayCheckin { date: r.get(0)?, mood: r.get(1)?, note: r.get(2)?, coffee: r.get::<_, Option<i64>>(3)?.map(|v| v == 1) })
}

fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && d.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

pub fn get(c: &Connection, date: &str) -> rusqlite::Result<Option<DayCheckin>> {
    c.query_row("SELECT date, mood, note, coffee FROM day_checkins WHERE date = ?1", params![date], row).optional()
}

pub fn set(c: &Connection, date: &str, p: DayPatch) -> Result<DayCheckin, String> {
    if !valid_date(date) {
        return Err("data inválida".into());
    }
    if let Some(Some(m)) = p.mood {
        if !(1..=5).contains(&m) {
            return Err("humor deve ser de 1 a 5".into());
        }
    }
    let cur = get(c, date).map_err(|e| e.to_string())?;
    let mood = p.mood.unwrap_or(cur.as_ref().and_then(|x| x.mood));
    let note = p.note.map(|n| n.trim().chars().take(280).collect::<String>()).unwrap_or(cur.as_ref().map(|x| x.note.clone()).unwrap_or_default());
    let coffee = p.coffee.unwrap_or(cur.as_ref().and_then(|x| x.coffee));
    c.execute(
        &format!(
            "INSERT INTO day_checkins (date, mood, note, coffee) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (date) DO UPDATE SET mood = excluded.mood, note = excluded.note, coffee = excluded.coffee, updated_at = {NOW}"
        ),
        params![date, mood, note, coffee.map(|b| b as i64)],
    )
    .map_err(|e| e.to_string())?;
    get(c, date).map_err(|e| e.to_string())?.ok_or_else(|| "falha ao salvar".into())
}

pub fn range(c: &Connection, from: &str, to: &str) -> rusqlite::Result<Vec<DayCheckin>> {
    let mut st = c.prepare("SELECT date, mood, note, coffee FROM day_checkins WHERE date BETWEEN ?1 AND ?2 ORDER BY date")?;
    let rows = st.query_map(params![from, to], row)?;
    rows.collect()
}

#[tauri::command]
pub fn day_get(state: State<AppState>, date: String) -> R<Option<DayCheckin>> {
    with_conn(&state, |c| get(c, &date))
}

#[tauri::command]
pub fn day_set(state: State<AppState>, date: String, patch: DayPatch) -> R<DayCheckin> {
    let mut out: Result<DayCheckin, String> = Err("banco indisponível".into());
    with_conn(&state, |c| {
        out = set(c, &date, patch);
        Ok(())
    })?;
    out
}

#[tauri::command]
pub fn days_range(state: State<AppState>, from: String, to: String) -> R<Vec<DayCheckin>> {
    with_conn(&state, |c| range(c, &from, &to))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> (Connection, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("ps-mood-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        (crate::db::open(&dir.join("t.sqlite"), &dir.join("b")).unwrap(), dir)
    }

    #[test]
    fn salva_humor_e_cafe_sem_apagar_o_outro() {
        let (c, dir) = db();
        set(&c, "2026-11-06", DayPatch { mood: Some(Some(4)), ..Default::default() }).unwrap();
        let d = set(&c, "2026-11-06", DayPatch { coffee: Some(Some(true)), ..Default::default() }).unwrap();
        assert_eq!(d.mood, Some(4));
        assert_eq!(d.coffee, Some(true));
        let d = set(&c, "2026-11-06", DayPatch { mood: Some(None), ..Default::default() }).unwrap();
        assert_eq!(d.mood, None);
        assert_eq!(d.coffee, Some(true));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn rejeita_humor_e_data_invalidos() {
        let (c, dir) = db();
        assert!(set(&c, "2026-11-06", DayPatch { mood: Some(Some(7)), ..Default::default() }).is_err());
        assert!(set(&c, "06/11/2026", DayPatch::default()).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn intervalo_ordenado() {
        let (c, dir) = db();
        for (d, m) in [("2026-11-03", 2), ("2026-11-01", 5), ("2026-12-01", 3)] {
            set(&c, d, DayPatch { mood: Some(Some(m)), ..Default::default() }).unwrap();
        }
        let r = range(&c, "2026-11-01", "2026-11-30").unwrap();
        assert_eq!(r.iter().map(|x| x.date.as_str()).collect::<Vec<_>>(), vec!["2026-11-01", "2026-11-03"]);
        std::fs::remove_dir_all(dir).ok();
    }
}
