
use crate::commands::{AppState, NOW, R, new_id, with_conn};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

pub(crate) const MAX_DEPTH: i64 = 3;
pub(crate) const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
const ASSET_DIR: &str = "note-assets";
const EMPTY_DOC: &str = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
const TITLE_MAX: usize = 500;

#[derive(Debug)]
pub(crate) struct NoteError(pub String);

impl From<rusqlite::Error> for NoteError {
    fn from(e: rusqlite::Error) -> Self {
        NoteError(e.to_string())
    }
}
impl From<std::io::Error> for NoteError {
    fn from(e: std::io::Error) -> Self {
        NoteError(format!("erro de arquivo: {e}"))
    }
}
impl From<&str> for NoteError {
    fn from(s: &str) -> Self {
        NoteError(s.to_string())
    }
}
impl From<String> for NoteError {
    fn from(s: String) -> Self {
        NoteError(s)
    }
}

type NR<T> = Result<T, NoteError>;

fn not_found() -> NoteError {
    "nota não encontrada".into()
}

fn run<T>(state: &State<AppState>, f: impl FnOnce(&mut Connection) -> NR<T>) -> R<T> {
    let mut out = None;
    with_conn(state, |c| {
        out = Some(f(c));
        Ok(())
    })?;
    out.unwrap_or_else(|| Err("banco indisponível".into())).map_err(|e| e.0)
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub sort: f64,
    pub archived_at: Option<String>,
    pub trashed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub excerpt: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    #[serde(flatten)]
    pub meta: NoteMeta,
    pub doc: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewNote {
    pub parent_id: Option<String>,
    pub title: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    pub title: Option<String>,
    pub doc: Option<String>,
    pub plain_text: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub snippet: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteAsset {
    pub id: String,
    pub note_id: String,
    pub mime: String,
    pub size: i64,
    pub created_at: String,
}

const META_COLS: &str =
    "id, parent_id, title, sort, archived_at, trashed_at, created_at, updated_at, substr(plain_text, 1, 180)";

fn meta_from(r: &Row) -> rusqlite::Result<NoteMeta> {
    let excerpt: String = r.get(8)?;
    Ok(NoteMeta {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        title: r.get(2)?,
        sort: r.get(3)?,
        archived_at: r.get(4)?,
        trashed_at: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        excerpt: excerpt.split_whitespace().collect::<Vec<_>>().join(" "),
    })
}

pub(crate) fn list(c: &Connection) -> NR<Vec<NoteMeta>> {
    let mut st = c.prepare(&format!("SELECT {META_COLS} FROM notes ORDER BY parent_id, sort, created_at"))?;
    Ok(st.query_map([], meta_from)?.collect::<rusqlite::Result<_>>()?)
}

fn meta(c: &Connection, id: &str) -> NR<NoteMeta> {
    c.query_row(&format!("SELECT {META_COLS} FROM notes WHERE id = ?1"), params![id], meta_from)
        .optional()?
        .ok_or_else(not_found)
}

pub(crate) fn get(c: &Connection, id: &str) -> NR<Note> {
    let m = meta(c, id)?;
    let doc: String = c.query_row("SELECT doc FROM notes WHERE id = ?1", params![id], |r| r.get(0))?;
    Ok(Note { meta: m, doc })
}

fn lineage(c: &Connection, id: &str) -> NR<(i64, bool)> {
    let (n, trashed): (i64, i64) = c.query_row(
        "WITH RECURSIVE up(id, parent_id, trashed, lvl) AS (
           SELECT id, parent_id, trashed_at IS NOT NULL, 1 FROM notes WHERE id = ?1
           UNION ALL
           SELECT n.id, n.parent_id, n.trashed_at IS NOT NULL, up.lvl + 1
           FROM notes n JOIN up ON n.id = up.parent_id WHERE up.lvl < 64
         )
         SELECT count(*), coalesce(sum(trashed), 0) FROM up",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if n == 0 {
        return Err(not_found());
    }
    Ok((n, trashed == 0))
}

fn height(c: &Connection, id: &str) -> NR<i64> {
    Ok(c.query_row(
        "WITH RECURSIVE down(id, lvl) AS (
           SELECT id, 1 FROM notes WHERE id = ?1
           UNION ALL
           SELECT n.id, down.lvl + 1 FROM notes n JOIN down ON n.parent_id = down.id
           WHERE n.trashed_at IS NULL AND down.lvl < 64
         )
         SELECT coalesce(max(lvl), 0) FROM down",
        params![id],
        |r| r.get(0),
    )?)
}

fn subtree_ids(c: &Connection, id: &str) -> NR<Vec<String>> {
    let mut st = c.prepare(
        "WITH RECURSIVE down(id, lvl) AS (
           SELECT id, 0 FROM notes WHERE id = ?1
           UNION ALL
           SELECT n.id, down.lvl + 1 FROM notes n JOIN down ON n.parent_id = down.id WHERE down.lvl < 64
         )
         SELECT id FROM down",
    )?;
    Ok(st.query_map(params![id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
}

fn clean_title(t: &str) -> String {
    let one_line = t.replace(['\n', '\r', '\t'], " ");
    one_line.trim().chars().take(TITLE_MAX).collect()
}

fn validate_doc(doc: &str) -> NR<()> {
    let v: serde_json::Value = serde_json::from_str(doc).map_err(|_| NoteError::from("documento inválido"))?;
    if v.get("type").and_then(|t| t.as_str()) != Some("doc") {
        return Err("documento inválido".into());
    }
    Ok(())
}

fn place(c: &Connection, id: &str, parent: Option<&str>, before: Option<&str>) -> NR<()> {
    let mut sibs: Vec<String> = {
        let mut st =
            c.prepare("SELECT id FROM notes WHERE parent_id IS ?1 AND id <> ?2 ORDER BY sort, created_at")?;
        st.query_map(params![parent, id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
    };
    let pos = before.and_then(|b| sibs.iter().position(|s| s == b)).unwrap_or(sibs.len());
    sibs.insert(pos, id.to_string());
    let mut up = c.prepare("UPDATE notes SET parent_id = ?2, sort = ?3 WHERE id = ?1")?;
    for (i, s) in sibs.iter().enumerate() {
        up.execute(params![s, parent, (i + 1) as f64])?;
    }
    Ok(())
}

fn depth_error() -> NoteError {
    format!("as subpáginas vão até {MAX_DEPTH} níveis").into()
}

pub(crate) fn create(c: &mut Connection, parent_id: Option<&str>, title: &str) -> NR<Note> {
    if let Some(p) = parent_id {
        let (depth, live) = lineage(c, p)?;
        if !live {
            return Err("a página de destino está na lixeira".into());
        }
        if depth >= MAX_DEPTH {
            return Err(depth_error());
        }
    }
    let id = new_id();
    let tx = c.transaction()?;
    tx.execute(
        "INSERT INTO notes (id, parent_id, title, doc) VALUES (?1, ?2, ?3, ?4)",
        params![id, parent_id, clean_title(title), EMPTY_DOC],
    )?;
    place(&tx, &id, parent_id, None)?;
    tx.commit()?;
    get(c, &id)
}

pub(crate) fn save(c: &mut Connection, id: &str, p: &NotePatch) -> NR<NoteMeta> {
    if let Some(d) = &p.doc {
        validate_doc(d)?;
    }
    let (title, doc, plain): (String, String, String) = c
        .query_row("SELECT title, doc, plain_text FROM notes WHERE id = ?1", params![id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .ok_or_else(not_found)?;
    let next_title = p.title.as_deref().map(clean_title).unwrap_or_else(|| title.clone());
    let next_doc = p.doc.clone().unwrap_or_else(|| doc.clone());
    let next_plain = p.plain_text.clone().unwrap_or_else(|| plain.clone());
    if next_title != title || next_doc != doc || next_plain != plain {
        c.execute(
            &format!("UPDATE notes SET title = ?2, doc = ?3, plain_text = ?4, updated_at = {NOW} WHERE id = ?1"),
            params![id, next_title, next_doc, next_plain],
        )?;
    }
    meta(c, id)
}

pub(crate) fn move_to(c: &mut Connection, id: &str, parent: Option<&str>, before: Option<&str>) -> NR<NoteMeta> {
    let (_, live) = lineage(c, id)?;
    if !live {
        return Err("restaure a página antes de movê-la".into());
    }
    if let Some(p) = parent {
        if subtree_ids(c, id)?.iter().any(|s| s == p) {
            return Err("não dá para mover uma página para dentro dela mesma".into());
        }
        let (depth, live) = lineage(c, p)?;
        if !live {
            return Err("a página de destino está na lixeira".into());
        }
        if depth + height(c, id)? > MAX_DEPTH {
            return Err(depth_error());
        }
    }
    let tx = c.transaction()?;
    place(&tx, id, parent, before)?;
    tx.commit()?;
    meta(c, id)
}

pub(crate) fn duplicate(c: &mut Connection, id: &str) -> NR<Note> {
    let (_, live) = lineage(c, id)?;
    if !live {
        return Err("restaure a página antes de duplicá-la".into());
    }
    let (parent, title, doc, plain, sort): (Option<String>, String, String, String, f64) = c.query_row(
        "SELECT parent_id, title, doc, plain_text, sort FROM notes WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )?;
    let next: Option<String> = c
        .query_row(
            "SELECT id FROM notes WHERE parent_id IS ?1 AND id <> ?2 AND sort > ?3 ORDER BY sort LIMIT 1",
            params![parent, id, sort],
            |r| r.get(0),
        )
        .optional()?;
    let base = if title.trim().is_empty() { "Sem título".to_string() } else { title };
    let new = new_id();
    let tx = c.transaction()?;
    tx.execute(
        "INSERT INTO notes (id, parent_id, title, doc, plain_text) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new, parent, clean_title(&format!("{base} (cópia)")), doc, plain],
    )?;
    place(&tx, &new, parent.as_deref(), next.as_deref())?;
    tx.commit()?;
    get(c, &new)
}

pub(crate) fn set_archived(c: &Connection, id: &str, archived: bool) -> NR<NoteMeta> {
    let sql = if archived {
        format!("UPDATE notes SET archived_at = coalesce(archived_at, {NOW}) WHERE id = ?1")
    } else {
        "UPDATE notes SET archived_at = NULL WHERE id = ?1".to_string()
    };
    if c.execute(&sql, params![id])? == 0 {
        return Err(not_found());
    }
    meta(c, id)
}

pub(crate) fn trash(c: &Connection, id: &str) -> NR<NoteMeta> {
    let n = c.execute(&format!("UPDATE notes SET trashed_at = coalesce(trashed_at, {NOW}) WHERE id = ?1"), params![id])?;
    if n == 0 {
        return Err(not_found());
    }
    meta(c, id)
}

pub(crate) fn restore(c: &mut Connection, id: &str) -> NR<NoteMeta> {
    let parent: Option<String> = c
        .query_row("SELECT parent_id FROM notes WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .ok_or_else(not_found)?;
    let tx = c.transaction()?;
    tx.execute("UPDATE notes SET trashed_at = NULL WHERE id = ?1", params![id])?;
    if let Some(p) = parent {
        let fits = match lineage(&tx, &p) {
            Ok((depth, live)) => live && depth + height(&tx, id)? <= MAX_DEPTH,
            Err(_) => false,
        };
        if !fits {
            place(&tx, id, None, None)?;
        }
    }
    tx.commit()?;
    meta(c, id)
}

fn safe_rel(rel: &str) -> bool {
    rel.starts_with("note-assets/")
        && !rel.contains("..")
        && !rel.contains('\\')
        && rel.matches('/').count() == 1
        && rel.len() > "note-assets/".len()
}

pub(crate) fn purge(c: &mut Connection, data_dir: &Path, id: &str) -> NR<usize> {
    let (_, live) = lineage(c, id)?;
    if live {
        return Err("só dá para excluir definitivamente o que está na lixeira".into());
    }
    let ids = subtree_ids(c, id)?;
    let ids_json = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    let tx = c.transaction()?;
    let assets: Vec<(String, String)> = {
        let mut st =
            tx.prepare("SELECT id, rel_path FROM note_assets WHERE note_id IN (SELECT value FROM json_each(?1))")?;
        st.query_map(params![ids_json], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?
    };
    let mut doomed = vec![];
    for (aid, rel) in assets {
        let heir: Option<String> = tx
            .query_row(
                "SELECT id FROM notes WHERE id NOT IN (SELECT value FROM json_each(?1)) AND instr(doc, ?2) > 0 LIMIT 1",
                params![ids_json, aid],
                |r| r.get(0),
            )
            .optional()?;
        match heir {
            Some(h) => {
                tx.execute(
                    &format!("UPDATE note_assets SET note_id = ?2, updated_at = {NOW} WHERE id = ?1"),
                    params![aid, h],
                )?;
            }
            None => doomed.push(rel),
        }
    }
    tx.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    tx.commit()?;
    for rel in doomed.iter().filter(|r| safe_rel(r)) {
        fs::remove_file(data_dir.join(rel)).ok();
    }
    Ok(ids.len())
}

pub(crate) fn empty_trash(c: &mut Connection, data_dir: &Path) -> NR<i64> {
    let ids: Vec<String> = {
        let mut st = c.prepare("SELECT id FROM notes WHERE trashed_at IS NOT NULL ORDER BY trashed_at")?;
        st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
    };
    let mut n = 0;
    for id in ids {
        let exists: bool = c.query_row("SELECT EXISTS (SELECT 1 FROM notes WHERE id = ?1)", params![id], |r| r.get(0))?;
        if exists {
            purge(c, data_dir, &id)?;
            n += 1;
        }
    }
    Ok(n)
}

pub(crate) fn fts_query(q: &str) -> Option<String> {
    let toks: Vec<String> = q
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .take(8)
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if toks.is_empty() { None } else { Some(toks.join(" ")) }
}

pub(crate) fn search(c: &Connection, query: &str, limit: i64) -> NR<Vec<SearchHit>> {
    let Some(q) = fts_query(query) else { return Ok(vec![]) };
    let mut st = c.prepare(
        "WITH RECURSIVE live(id) AS (
           SELECT id FROM notes WHERE parent_id IS NULL AND trashed_at IS NULL
           UNION ALL
           SELECT n.id FROM notes n JOIN live ON n.parent_id = live.id WHERE n.trashed_at IS NULL
         )
         SELECT n.id, n.parent_id,
                highlight(notes_fts, 0, char(1), char(2)),
                snippet(notes_fts, 1, char(1), char(2), '…', 14),
                n.updated_at, n.archived_at
         FROM notes_fts JOIN notes n ON n.rid = notes_fts.rowid
         WHERE notes_fts MATCH ?1 AND n.id IN (SELECT id FROM live)
         ORDER BY bm25(notes_fts, 8.0, 1.0), n.updated_at DESC
         LIMIT ?2",
    )?;
    let hits = st
        .query_map(params![q, limit.clamp(1, 200)], |r| {
            Ok(SearchHit {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                title: r.get(2)?,
                snippet: r.get::<_, String>(3)?.split_whitespace().collect::<Vec<_>>().join(" "),
                updated_at: r.get(4)?,
                archived_at: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(hits)
}

pub(crate) fn sniff_image(b: &[u8]) -> Option<(&'static str, &'static str)> {
    if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(("image/png", "png"))
    } else if b.len() >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF {
        Some(("image/jpeg", "jpg"))
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

pub(crate) fn asset_save(c: &Connection, data_dir: &Path, note_id: &str, bytes: &[u8]) -> NR<NoteAsset> {
    if bytes.is_empty() {
        return Err("a imagem está vazia".into());
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("a imagem passa de 10 MB".into());
    }
    let (mime, ext) = sniff_image(bytes).ok_or_else(|| NoteError::from("formato não suportado: use PNG, JPEG, GIF ou WebP"))?;
    let exists: bool = c.query_row("SELECT EXISTS (SELECT 1 FROM notes WHERE id = ?1)", params![note_id], |r| r.get(0))?;
    if !exists {
        return Err(not_found());
    }
    let id = new_id();
    let rel = format!("{ASSET_DIR}/{id}.{ext}");
    let dir = data_dir.join(ASSET_DIR);
    fs::create_dir_all(&dir)?;
    let tmp = dir.join(format!(".{id}.part"));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, data_dir.join(&rel))?;
    if let Err(e) = c.execute(
        "INSERT INTO note_assets (id, note_id, rel_path, mime, size) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, note_id, rel, mime, bytes.len() as i64],
    ) {
        fs::remove_file(data_dir.join(&rel)).ok();
        return Err(e.into());
    }
    Ok(c.query_row(
        "SELECT id, note_id, mime, size, created_at FROM note_assets WHERE id = ?1",
        params![id],
        |r| Ok(NoteAsset { id: r.get(0)?, note_id: r.get(1)?, mime: r.get(2)?, size: r.get(3)?, created_at: r.get(4)? }),
    )?)
}

pub(crate) fn asset_data_url(c: &Connection, data_dir: &Path, id: &str) -> NR<String> {
    let (rel, mime): (String, String) = c
        .query_row("SELECT rel_path, mime FROM note_assets WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| NoteError::from("imagem não encontrada"))?;
    if !safe_rel(&rel) {
        return Err("caminho de imagem inválido".into());
    }
    let bytes = fs::read(data_dir.join(&rel)).map_err(|_| NoteError::from("o arquivo da imagem não está na pasta do app"))?;
    Ok(format!("data:{mime};base64,{}", base64(&bytes)))
}

pub(crate) fn base64(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (chunk[0] as u32) << 16 | b1 << 8 | b2;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

pub(crate) fn safe_file_stem(name: &str) -> String {
    let base = name.trim();
    let base = base.strip_suffix(".md").unwrap_or(base);
    let mut s = String::new();
    for ch in base.chars() {
        let ok = ch.is_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '.' | ',');
        let ch = if ok { ch } else { '-' };
        if (ch == '-' || ch == ' ') && s.ends_with(ch) {
            continue;
        }
        s.push(ch);
    }
    let s: String = s.trim_matches(|c: char| c == '.' || c == ' ' || c == '-').chars().take(80).collect();
    let s = s.trim_end_matches(|c: char| c == '.' || c == ' ' || c == '-').to_string();
    if s.is_empty() { "nota".to_string() } else { s }
}

fn asset_refs(md: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut rest = md;
    while let Some(i) = rest.find("(asset:") {
        let after = &rest[i + 7..];
        let id: String = after.chars().take_while(|c| c.is_ascii_hexdigit() || *c == '-').collect();
        if !id.is_empty() && after[id.len()..].starts_with(')') && !out.contains(&id) {
            out.push(id.clone());
        }
        rest = &after[id.len()..];
    }
    out
}

pub(crate) fn export_markdown(c: &Connection, data_dir: &Path, out_dir: &Path, name: &str, markdown: &str) -> NR<PathBuf> {
    let stem = safe_file_stem(name);
    let ids = asset_refs(markdown);
    fs::create_dir_all(out_dir)?;
    let mut n = 0;
    let (md_path, img_dir_name) = loop {
        let s = if n == 0 { stem.clone() } else { format!("{stem}-{n}") };
        let md = out_dir.join(format!("{s}.md"));
        let dir = format!("{s}-imagens");
        if !md.exists() && (ids.is_empty() || !out_dir.join(&dir).exists()) {
            break (md, dir);
        }
        n += 1;
        if n > 9999 {
            return Err("não encontrei um nome livre na pasta".into());
        }
    };
    let mut text = markdown.to_string();
    if !ids.is_empty() {
        let img_dir = out_dir.join(&img_dir_name);
        fs::create_dir_all(&img_dir)?;
        for id in &ids {
            let rel: Option<String> = c
                .query_row("SELECT rel_path FROM note_assets WHERE id = ?1", params![id], |r| r.get(0))
                .optional()?;
            let Some(rel) = rel.filter(|r| safe_rel(r)) else { continue };
            let file = rel.rsplit('/').next().unwrap_or_default().to_string();
            if fs::copy(data_dir.join(&rel), img_dir.join(&file)).is_ok() {
                text = text.replace(&format!("(asset:{id})"), &format!("({}/{file})", img_dir_name.replace(' ', "%20")));
            }
        }
    }
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&md_path)?;
    f.write_all(text.as_bytes())?;
    Ok(md_path)
}

#[tauri::command]
pub fn notes_list(state: State<AppState>) -> R<Vec<NoteMeta>> {
    run(&state, |c| list(c))
}

#[tauri::command]
pub fn note_get(state: State<AppState>, id: String) -> R<Note> {
    run(&state, |c| get(c, &id))
}

#[tauri::command]
pub fn note_create(state: State<AppState>, input: NewNote) -> R<Note> {
    run(&state, |c| create(c, input.parent_id.as_deref(), input.title.as_deref().unwrap_or("")))
}

#[tauri::command]
pub fn note_save(state: State<AppState>, id: String, patch: NotePatch) -> R<NoteMeta> {
    run(&state, |c| save(c, &id, &patch))
}

#[tauri::command]
pub fn note_move(state: State<AppState>, id: String, parent_id: Option<String>, before_id: Option<String>) -> R<NoteMeta> {
    run(&state, |c| move_to(c, &id, parent_id.as_deref(), before_id.as_deref()))
}

#[tauri::command]
pub fn note_duplicate(state: State<AppState>, id: String) -> R<Note> {
    run(&state, |c| duplicate(c, &id))
}

#[tauri::command]
pub fn note_set_archived(state: State<AppState>, id: String, archived: bool) -> R<NoteMeta> {
    run(&state, |c| set_archived(c, &id, archived))
}

#[tauri::command]
pub fn note_trash(state: State<AppState>, id: String) -> R<NoteMeta> {
    run(&state, |c| trash(c, &id))
}

#[tauri::command]
pub fn note_restore(state: State<AppState>, id: String) -> R<NoteMeta> {
    run(&state, |c| restore(c, &id))
}

#[tauri::command]
pub fn note_purge(state: State<AppState>, id: String) -> R<usize> {
    let dir = state.data_dir.clone();
    run(&state, |c| purge(c, &dir, &id))
}

#[tauri::command]
pub fn notes_trash_empty(state: State<AppState>) -> R<i64> {
    let dir = state.data_dir.clone();
    run(&state, |c| empty_trash(c, &dir))
}

#[tauri::command]
pub fn notes_search(state: State<AppState>, query: String, limit: Option<i64>) -> R<Vec<SearchHit>> {
    run(&state, |c| search(c, &query, limit.unwrap_or(40)))
}

#[tauri::command]
pub fn note_asset_save(state: State<AppState>, request: tauri::ipc::Request<'_>) -> R<NoteAsset> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("envie os bytes da imagem".into());
    };
    let note_id = request
        .headers()
        .get("x-note-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("nota não informada")?
        .to_string();
    let dir = state.data_dir.clone();
    run(&state, |c| asset_save(c, &dir, &note_id, bytes))
}

#[tauri::command]
pub fn note_asset_get(state: State<AppState>, id: String) -> R<String> {
    let dir = state.data_dir.clone();
    run(&state, |c| asset_data_url(c, &dir, &id))
}

#[tauri::command]
pub fn note_export_markdown(app: tauri::AppHandle, state: State<AppState>, file_name: String, markdown: String) -> R<String> {
    let out = app.path().download_dir().map_err(|e| format!("pasta Downloads indisponível: {e}"))?;
    let dir = state.data_dir.clone();
    run(&state, |c| export_markdown(c, &dir, &out, &file_name, &markdown)).map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Env {
        conn: Connection,
        dir: PathBuf,
    }
    impl Drop for Env {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.dir).ok();
        }
    }

    fn env() -> Env {
        let dir = std::env::temp_dir().join(format!("ps-notes-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let conn = crate::db::open(&dir.join("t.sqlite"), &dir.join("backups")).unwrap();
        Env { conn, dir }
    }

    fn doc_with(text: &str) -> String {
        serde_json::json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }]
        })
        .to_string()
    }

    fn write(c: &mut Connection, id: &str, title: &str, text: &str) {
        save(
            c,
            id,
            &NotePatch { title: Some(title.into()), doc: Some(doc_with(text)), plain_text: Some(text.into()) },
        )
        .unwrap();
    }

    fn fts_ok(c: &Connection) {
        c.execute("INSERT INTO notes_fts (notes_fts, rank) VALUES ('integrity-check', 1)", []).unwrap();
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];

    #[test]
    fn migracao_cria_tabelas_e_indice_de_busca() {
        let e = env();
        for t in ["notes", "note_assets", "notes_fts"] {
            let n: i64 = e
                .conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", params![t], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "tabela {t}");
        }
        fts_ok(&e.conn);
    }

    #[test]
    fn crud_basico_e_salvar_sem_mudanca_nao_mexe_na_data() {
        let mut e = env();
        let n = create(&mut e.conn, None, "  Primeira\nnota  ").unwrap();
        assert_eq!(n.meta.title, "Primeira nota");
        assert!(n.doc.contains("\"doc\""));
        write(&mut e.conn, &n.meta.id, "Diário", "Hoje foi um bom dia");
        let got = get(&e.conn, &n.meta.id).unwrap();
        assert_eq!(got.meta.title, "Diário");
        assert_eq!(got.meta.excerpt, "Hoje foi um bom dia");
        assert!(got.doc.contains("bom dia"));

        let before = got.meta.updated_at.clone();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let same = save(&mut e.conn, &n.meta.id, &NotePatch { title: Some("Diário".into()), ..Default::default() }).unwrap();
        assert_eq!(same.updated_at, before);

        assert!(save(&mut e.conn, &n.meta.id, &NotePatch { doc: Some("{oops".into()), ..Default::default() }).is_err());
        assert!(save(&mut e.conn, &n.meta.id, &NotePatch { doc: Some("[1]".into()), ..Default::default() }).is_err());
        assert!(save(&mut e.conn, "nao-existe", &NotePatch::default()).is_err());
        assert_eq!(list(&e.conn).unwrap().len(), 1);
    }

    #[test]
    fn arvore_respeita_limite_de_niveis_e_ciclos() {
        let mut e = env();
        let a = create(&mut e.conn, None, "A").unwrap().meta.id;
        let b = create(&mut e.conn, Some(&a), "B").unwrap().meta.id;
        let c = create(&mut e.conn, Some(&b), "C").unwrap().meta.id;
        assert!(create(&mut e.conn, Some(&c), "D").is_err(), "4º nível bloqueado");

        assert!(move_to(&mut e.conn, &a, Some(&c), None).is_err());
        assert!(move_to(&mut e.conn, &a, Some(&a), None).is_err());

        let x = create(&mut e.conn, None, "X").unwrap().meta.id;
        let _y = create(&mut e.conn, Some(&x), "Y").unwrap();
        assert!(move_to(&mut e.conn, &x, Some(&b), None).is_err());
        let m = move_to(&mut e.conn, &x, Some(&a), None).unwrap();
        assert_eq!(m.parent_id.as_deref(), Some(a.as_str()));

        move_to(&mut e.conn, &x, Some(&a), Some(&b)).unwrap();
        let kids: Vec<String> = list(&e.conn)
            .unwrap()
            .into_iter()
            .filter(|n| n.parent_id.as_deref() == Some(a.as_str()))
            .map(|n| n.id)
            .collect();
        assert_eq!(kids, vec![x.clone(), b.clone()]);

        let top = move_to(&mut e.conn, &x, None, None).unwrap();
        assert!(top.parent_id.is_none());
    }

    #[test]
    fn lixeira_leva_filhos_restaura_e_exclui_definitivo() {
        let mut e = env();
        let pai = create(&mut e.conn, None, "Projeto").unwrap().meta.id;
        let filho = create(&mut e.conn, Some(&pai), "Tarefas do projeto").unwrap().meta.id;
        write(&mut e.conn, &filho, "Tarefas do projeto", "girassol");
        assert_eq!(search(&e.conn, "girassol", 10).unwrap().len(), 1);

        trash(&e.conn, &pai).unwrap();
        assert!(search(&e.conn, "girassol", 10).unwrap().is_empty(), "filho some da busca com o pai");
        assert!(create(&mut e.conn, Some(&filho), "neto").is_err(), "não cria dentro da lixeira");
        assert!(move_to(&mut e.conn, &filho, None, None).is_err());

        restore(&mut e.conn, &pai).unwrap();
        assert_eq!(search(&e.conn, "girassol", 10).unwrap().len(), 1, "restaurar traz o filho");

        trash(&e.conn, &filho).unwrap();
        trash(&e.conn, &pai).unwrap();
        let m = restore(&mut e.conn, &filho).unwrap();
        assert!(m.parent_id.is_none());
        assert!(m.trashed_at.is_none());

        assert!(purge(&mut e.conn, &e.dir, &filho).is_err());
        let neto = create(&mut e.conn, Some(&pai), "neto").err();
        assert!(neto.is_some(), "pai está na lixeira");
        move_to(&mut e.conn, &filho, None, None).unwrap();
        let sub = create(&mut e.conn, None, "Outro").unwrap().meta.id;
        let sub2 = create(&mut e.conn, Some(&sub), "Sub").unwrap().meta.id;
        trash(&e.conn, &sub).unwrap();
        assert_eq!(purge(&mut e.conn, &e.dir, &sub).unwrap(), 2);
        assert!(get(&e.conn, &sub2).is_err(), "subárvore apagada em cascata");
        fts_ok(&e.conn);

        assert_eq!(empty_trash(&mut e.conn, &e.dir).unwrap(), 1);
        assert!(get(&e.conn, &pai).is_err());
        assert!(get(&e.conn, &filho).is_ok());
        fts_ok(&e.conn);
    }

    #[test]
    fn busca_sem_acento_por_prefixo_e_titulo_primeiro() {
        let mut e = env();
        let a = create(&mut e.conn, None, "").unwrap().meta.id;
        write(&mut e.conn, &a, "Receitas", "Pão de queijo com AÇÃO rápida");
        let b = create(&mut e.conn, None, "").unwrap().meta.id;
        write(&mut e.conn, &b, "Ação de graças", "lista de convidados");

        let hits = search(&e.conn, "acao", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].id, b, "título pesa mais");
        assert!(hits[0].title.contains('\u{1}'));
        assert!(hits[1].snippet.contains("\u{1}AÇÃO\u{2}"));

        assert_eq!(search(&e.conn, "PÃO qu", 10).unwrap().len(), 1, "todos os termos, por prefixo");
        assert!(search(&e.conn, "\"*()", 10).unwrap().is_empty(), "consulta só com símbolos");
        assert!(search(&e.conn, "inexistente", 10).unwrap().is_empty());

        write(&mut e.conn, &a, "Receitas", "bolo de cenoura");
        assert!(search(&e.conn, "queijo", 10).unwrap().is_empty());
        assert_eq!(search(&e.conn, "cenoura", 10).unwrap().len(), 1);
        fts_ok(&e.conn);

        assert_eq!(fts_query("olá, mundo!").as_deref(), Some("\"olá\"* \"mundo\"*"));
        assert_eq!(fts_query("  -- "), None);
    }

    #[test]
    fn duplicar_e_arquivar() {
        let mut e = env();
        let a = create(&mut e.conn, None, "A").unwrap().meta.id;
        let z = create(&mut e.conn, None, "Z").unwrap().meta.id;
        write(&mut e.conn, &a, "Plano", "conteúdo");
        let d = duplicate(&mut e.conn, &a).unwrap();
        assert_eq!(d.meta.title, "Plano (cópia)");
        assert!(d.doc.contains("conteúdo"));
        let order: Vec<String> = list(&e.conn).unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(order, vec![a.clone(), d.meta.id.clone(), z], "cópia logo abaixo da original");

        let m = set_archived(&e.conn, &a, true).unwrap();
        assert!(m.archived_at.is_some());
        assert!(set_archived(&e.conn, &a, false).unwrap().archived_at.is_none());
        assert!(set_archived(&e.conn, "x", true).is_err());
    }

    #[test]
    fn imagens_validam_tipo_tamanho_e_somem_ao_excluir() {
        let mut e = env();
        let a = create(&mut e.conn, None, "Fotos").unwrap().meta.id;

        assert!(asset_save(&e.conn, &e.dir, &a, b"nao sou imagem").is_err());
        assert!(asset_save(&e.conn, &e.dir, &a, &[]).is_err());
        let mut big = PNG.to_vec();
        big.resize(MAX_ASSET_BYTES + 1, 0);
        assert!(asset_save(&e.conn, &e.dir, &a, &big).is_err());
        assert!(asset_save(&e.conn, &e.dir, "nota-inexistente", PNG).is_err());

        let img = asset_save(&e.conn, &e.dir, &a, PNG).unwrap();
        assert_eq!(img.mime, "image/png");
        assert_eq!(img.size, PNG.len() as i64);
        let file = e.dir.join(format!("note-assets/{}.png", img.id));
        assert!(file.exists());
        let url = asset_data_url(&e.conn, &e.dir, &img.id).unwrap();
        assert_eq!(url, format!("data:image/png;base64,{}", base64(PNG)));
        assert!(asset_data_url(&e.conn, &e.dir, "x").is_err());

        trash(&e.conn, &a).unwrap();
        purge(&mut e.conn, &e.dir, &a).unwrap();
        assert!(!file.exists());
        let n: i64 = e.conn.query_row("SELECT count(*) FROM note_assets", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn imagem_usada_por_outra_pagina_sobrevive() {
        let mut e = env();
        let a = create(&mut e.conn, None, "Original").unwrap().meta.id;
        let img = asset_save(&e.conn, &e.dir, &a, &[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).unwrap();
        assert_eq!(img.mime, "image/jpeg");
        let doc = serde_json::json!({
            "type": "doc",
            "content": [{ "type": "image", "attrs": { "assetId": img.id } }]
        })
        .to_string();
        save(&mut e.conn, &a, &NotePatch { doc: Some(doc), ..Default::default() }).unwrap();
        let copy = duplicate(&mut e.conn, &a).unwrap().meta.id;
        trash(&e.conn, &a).unwrap();
        purge(&mut e.conn, &e.dir, &a).unwrap();
        let owner: String = e
            .conn
            .query_row("SELECT note_id FROM note_assets WHERE id = ?1", params![img.id], |r| r.get(0))
            .unwrap();
        assert_eq!(owner, copy);
        assert!(asset_data_url(&e.conn, &e.dir, &img.id).is_ok());
    }

    #[test]
    fn tipos_de_imagem_pelo_conteudo() {
        assert_eq!(sniff_image(PNG).map(|x| x.0), Some("image/png"));
        assert_eq!(sniff_image(b"GIF89a....").map(|x| x.0), Some("image/gif"));
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WEBPVP8 ").map(|x| x.0), Some("image/webp"));
        assert_eq!(sniff_image(b"<svg xmlns=").map(|x| x.0), None);
        assert_eq!(sniff_image(b"%PDF-1.7").map(|x| x.0), None);
    }

    #[test]
    fn base64_confere_com_vetores_padrao() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xFF, 0xEF]), "/+8=");
    }

    #[test]
    fn exporta_sem_sobrescrever_e_copia_imagens() {
        let mut e = env();
        assert_eq!(safe_file_stem("  Reunião: 5/11 <final>?.md "), "Reunião- 5-11 -final");
        assert_eq!(safe_file_stem("../../etc/passwd"), "etc-passwd");
        assert_eq!(safe_file_stem("..."), "nota");
        assert_eq!(safe_file_stem(""), "nota");

        let out = e.dir.join("Downloads");
        let p1 = export_markdown(&e.conn, &e.dir, &out, "Minha nota", "# Oi\n").unwrap();
        let p2 = export_markdown(&e.conn, &e.dir, &out, "Minha nota", "# Oi de novo\n").unwrap();
        assert_eq!(p1.file_name().unwrap(), "Minha nota.md");
        assert_eq!(p2.file_name().unwrap(), "Minha nota-1.md");
        assert_eq!(fs::read_to_string(&p1).unwrap(), "# Oi\n");

        let a = create(&mut e.conn, None, "Fotos").unwrap().meta.id;
        let img = asset_save(&e.conn, &e.dir, &a, PNG).unwrap();
        let md = format!("![foto](asset:{})\n\n![sumida](asset:00000000-0000-0000-0000-000000000000)\n", img.id);
        let p3 = export_markdown(&e.conn, &e.dir, &out, "Fotos", &md).unwrap();
        let text = fs::read_to_string(&p3).unwrap();
        assert!(text.contains(&format!("![foto](Fotos-imagens/{}.png)", img.id)), "{text}");
        assert!(text.contains("asset:00000000"), "referência desconhecida fica como está");
        assert!(out.join(format!("Fotos-imagens/{}.png", img.id)).exists());
    }
}
