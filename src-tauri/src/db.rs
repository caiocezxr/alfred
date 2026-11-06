
use rusqlite::{Connection, params};
use std::fs;
use std::path::{Path, PathBuf};

const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_init.sql"),
    include_str!("../migrations/002_ideas.sql"),
    include_str!("../migrations/003_radar.sql"),
    include_str!("../migrations/004_notes.sql"),
    include_str!("../migrations/005_briefing.sql"),
    include_str!("../migrations/006_mood.sql"),
    include_str!("../migrations/007_work.sql"),
    include_str!("../migrations/008_work_time.sql"),
];

pub fn latest_version() -> i64 {
    MIGRATIONS.len() as i64
}

pub fn schema_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0))
}

fn timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

pub fn backup_to(conn: &Connection, dir: &Path, prefix: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("não foi possível criar a pasta de backup: {e}"))?;
    let mut path = dir.join(format!("{prefix}-{}.sqlite", timestamp()));
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{prefix}-{}-{n}.sqlite", timestamp()));
        n += 1;
    }
    conn.execute("VACUUM INTO ?1", params![path.to_string_lossy()])
        .map_err(|e| format!("falha no backup: {e}"))?;
    Ok(path)
}

pub fn open(db_path: &Path, backup_dir: &Path) -> Result<Connection, String> {
    let existed = db_path.exists();
    let mut conn = Connection::open(db_path).map_err(|e| format!("não foi possível abrir o banco: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 3000;",
    )
    .map_err(|e| e.to_string())?;

    let current = schema_version(&conn).map_err(|e| e.to_string())?;
    if current > latest_version() {
        return Err(format!(
            "o banco está na versão {current}, mais nova que este app ({}). Atualize o app.",
            latest_version()
        ));
    }
    if existed && current > 0 && current < latest_version() {
        backup_to(&conn, backup_dir, &format!("pre-migracao-v{current}"))?;
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = (i + 1) as i64;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql)
            .map_err(|e| format!("migração {version} falhou (nada foi alterado): {e}"))?;
        tx.pragma_update(None, "user_version", version).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migra_do_zero_e_reabre_sem_erro() {
        let dir = std::env::temp_dir().join(format!("ps-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("t.sqlite");
        let conn = open(&db, &dir.join("backups")).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), latest_version());
        drop(conn);
        let conn = open(&db, &dir.join("backups")).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), latest_version());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn checkin_duplicado_e_bloqueado() {
        let dir = std::env::temp_dir().join(format!("ps-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.sqlite"), &dir.join("b")).unwrap();
        conn.execute("INSERT INTO habits (id, name, start_date, sort) VALUES ('h', 'Ler', '2026-11-01', 1)", []).unwrap();
        conn.execute("INSERT INTO habit_checkins (habit_id, date, status) VALUES ('h', '2026-11-05', 'done')", []).unwrap();
        let dup = conn.execute("INSERT INTO habit_checkins (habit_id, date, status) VALUES ('h', '2026-11-05', 'done')", []);
        assert!(dup.is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
