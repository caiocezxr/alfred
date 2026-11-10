
use crate::commands::{AppState, NOW, R, new_id, with_conn};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::time::{Duration, Instant};
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REDIRECTS: usize = 3;
const MAX_BYTES: u64 = 3 * 1024 * 1024;
const USER_AGENT: &str = "Shed-Radar/1.0";
const ACCEPT: &str = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5";
const KEEP_DAYS: i64 = 60;
const MAX_ITEMS_PER_BATCH: usize = 400;

const SOURCE_CATEGORIES: [&str; 4] = ["ai_dev", "ai_content", "stack", "auto"];
const ITEM_CATEGORIES: [&str; 4] = ["ai_dev", "ai_content", "stack", "other"];
const KEYWORD_CATEGORIES: [&str; 3] = ["ai_dev", "ai_content", "stack"];

pub(crate) fn validate_feed_url(raw: &str) -> R<String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("[url] informe o endereço do feed".into());
    }
    if s.len() > 2048 {
        return Err("[url] endereço longo demais".into());
    }
    let uri: ureq::http::Uri = s.parse().map_err(|_| "[url] endereço inválido".to_string())?;
    let scheme = uri.scheme_str().map(|x| x.to_ascii_lowercase());
    if !matches!(scheme.as_deref(), Some("http") | Some("https")) {
        return Err("[url] use um endereço que comece com http:// ou https://".into());
    }
    let authority = uri.authority().ok_or_else(|| "[url] endereço sem domínio".to_string())?;
    if authority.as_str().contains('@') {
        return Err("[url] endereços com usuário e senha não são aceitos".into());
    }
    let host = authority.host().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if host.is_empty() {
        return Err("[url] endereço sem domínio".into());
    }
    if is_local_host(&host) {
        return Err("[url] endereços locais ou de rede interna não são aceitos".into());
    }
    Ok(s.to_string())
}

fn is_local_host(h: &str) -> bool {
    if h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") || h.ends_with(".internal") {
        return true;
    }
    match h.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || (o[0] == 100 && (64..128).contains(&o[1]))
        }
        Ok(IpAddr::V6(v6)) => {
            let s0 = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || (s0 & 0xfe00) == 0xfc00
                || (s0 & 0xffc0) == 0xfe80
                || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback() || v4.is_private() || v4.is_unspecified())
        }
        Err(_) => h.chars().all(|c| c.is_ascii_digit() || c == '.' || c == 'x'),
    }
}

fn resolve_location(base: &str, loc: &str) -> R<String> {
    let loc = loc.trim();
    let lower = loc.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(loc.to_string());
    }
    let uri: ureq::http::Uri = base.parse().map_err(|_| "[rede] redirecionamento inválido".to_string())?;
    let scheme = uri.scheme_str().unwrap_or("https");
    let auth = uri.authority().map(|a| a.as_str()).unwrap_or("");
    if loc.starts_with("//") {
        return Ok(format!("{scheme}:{loc}"));
    }
    if loc.starts_with('/') {
        return Ok(format!("{scheme}://{auth}{loc}"));
    }
    let path = uri.path();
    let dir = &path[..path.rfind('/').map(|i| i + 1).unwrap_or(0)];
    let dir = if dir.is_empty() { "/" } else { dir };
    Ok(format!("{scheme}://{auth}{dir}{loc}"))
}

fn net_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Timeout(_) => "[tempo] a fonte demorou demais para responder".into(),
        ureq::Error::HostNotFound => "[rede] domínio não encontrado — sem conexão?".into(),
        ureq::Error::ConnectionFailed => "[rede] não foi possível conectar à fonte".into(),
        ureq::Error::Io(_) => "[rede] a conexão caiu no meio da resposta".into(),
        ureq::Error::BodyExceedsLimit(_) => "[tamanho] o feed passa do limite de 3 MB".into(),
        ureq::Error::TooManyRedirects | ureq::Error::RedirectFailed => "[rede] a fonte redireciona demais".into(),
        ureq::Error::Tls(_) | ureq::Error::Rustls(_) => "[rede] falha na conexão segura (TLS)".into(),
        ureq::Error::Decompress(..) => "[formato] resposta compactada inválida".into(),
        ureq::Error::BadUri(_) => "[url] endereço inválido".into(),
        other => format!("[rede] {other}"),
    }
}

fn status_error(status: u16) -> String {
    match status {
        404 | 410 => format!("[http {status}] o feed não existe mais neste endereço"),
        401 | 403 => format!("[http {status}] a fonte recusou o acesso"),
        429 => "[http 429] a fonte pediu para esperar (limite de acessos)".into(),
        500..=599 => format!("[http {status}] a fonte está com problemas no momento"),
        _ => format!("[http {status}] resposta inesperada da fonte"),
    }
}

fn fetch_feed_blocking(url: &str) -> R<String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .max_redirects(0)
        .http_status_as_error(false)
        .user_agent(USER_AGENT)
        .build()
        .into();
    let started = Instant::now();
    let mut current = validate_feed_url(url)?;
    let mut hops = 0usize;
    loop {
        let left = TIMEOUT
            .checked_sub(started.elapsed())
            .filter(|d| !d.is_zero())
            .ok_or_else(|| "[tempo] a fonte demorou demais para responder".to_string())?;
        let mut resp = agent
            .get(&current)
            .header("Accept", ACCEPT)
            .config()
            .timeout_global(Some(left))
            .build()
            .call()
            .map_err(net_error)?;
        let status = resp.status().as_u16();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            hops += 1;
            if hops > MAX_REDIRECTS {
                return Err("[rede] a fonte redireciona demais".into());
            }
            let loc = resp
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "[rede] redirecionamento sem destino".to_string())?
                .to_string();
            current = validate_feed_url(&resolve_location(&current, &loc)?)?;
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(status_error(status));
        }
        let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).map(str::to_string);
        let bytes = resp.body_mut().with_config().limit(MAX_BYTES).read_to_vec().map_err(net_error)?;
        return decode_body(&bytes, content_type.as_deref());
    }
}

fn charset_of(content_type: Option<&str>, bytes: &[u8]) -> String {
    if let Some(ct) = content_type {
        let lower = ct.to_ascii_lowercase();
        if let Some(i) = lower.find("charset=") {
            let v = lower[i + 8..].split(';').next().unwrap_or("").trim().trim_matches('"').trim_matches('\'');
            if !v.is_empty() {
                return v.to_string();
            }
        }
    }
    let head: String = bytes.iter().take(200).map(|&b| b as char).collect::<String>().to_ascii_lowercase();
    if head.starts_with("<?xml") {
        if let Some(i) = head.find("encoding=") {
            let rest = &head[i + 9..];
            let q = rest.chars().next().unwrap_or('"');
            if let Some(end) = rest[1..].find(q) {
                return rest[1..1 + end].to_string();
            }
        }
    }
    "utf-8".into()
}

const CP1252: [u32; 32] = [
    0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
    0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
];

fn decode_body(bytes: &[u8], content_type: Option<&str>) -> R<String> {
    if bytes.starts_with(&[0x1f, 0x8b]) {
        return Err("[formato] a fonte enviou conteúdo compactado sem avisar".into());
    }
    let text = if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(rest).into_owned()
    } else if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        let le = bytes[0] == 0xFF;
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        match charset_of(content_type, bytes).as_str() {
            "iso-8859-1" | "latin1" | "latin-1" | "iso8859-1" | "us-ascii" | "ascii" => bytes.iter().map(|&b| b as char).collect(),
            "windows-1252" | "cp1252" => bytes
                .iter()
                .map(|&b| match b {
                    0x80..=0x9F => char::from_u32(CP1252[(b - 0x80) as usize]).unwrap_or('\u{FFFD}'),
                    _ => b as char,
                })
                .collect(),
            _ => String::from_utf8_lossy(bytes).into_owned(),
        }
    };
    if !looks_like_feed(&text) {
        return Err("[formato] o endereço respondeu, mas não é um feed RSS ou Atom".into());
    }
    Ok(text)
}

fn looks_like_feed(text: &str) -> bool {
    let end = text.char_indices().nth(4096).map(|(i, _)| i).unwrap_or(text.len());
    let head = text[..end].trim_start_matches('\u{feff}').trim_start().to_ascii_lowercase();
    if head.starts_with("<!doctype html") || head.starts_with("<html") {
        return false;
    }
    head.contains("<rss") || head.contains("<feed") || head.contains("<rdf:rdf")
}

fn source_enabled(c: &Connection, url: &str) -> rusqlite::Result<bool> {
    c.query_row("SELECT 1 FROM feed_sources WHERE url = ?1 AND enabled = 1", params![url], |_| Ok(()))
        .optional()
        .map(|o| o.is_some())
}

#[tauri::command]
pub async fn radar_fetch(state: State<'_, AppState>, url: String, probe: Option<bool>) -> R<String> {
    let url = validate_feed_url(&url)?;
    let allowed = with_conn(&state, |c| source_enabled(c, &url))?;
    if !allowed && !probe.unwrap_or(false) {
        return Err("[url] só fontes cadastradas e habilitadas podem ser buscadas".into());
    }
    tauri::async_runtime::spawn_blocking(move || fetch_feed_blocking(&url))
        .await
        .map_err(|e| format!("[rede] {e}"))?
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FeedSource {
    id: String,
    name: String,
    url: String,
    category: String,
    enabled: bool,
    weight: f64,
    builtin: bool,
    last_status: Option<String>,
    last_error: Option<String>,
    last_fetched_at: Option<String>,
    last_ok_at: Option<String>,
    created_at: String,
}

const SOURCE_COLS: &str =
    "id, name, url, category, enabled, weight, builtin, last_status, last_error, last_fetched_at, last_ok_at, created_at";

fn source_from(r: &Row) -> rusqlite::Result<FeedSource> {
    Ok(FeedSource {
        id: r.get(0)?,
        name: r.get(1)?,
        url: r.get(2)?,
        category: r.get(3)?,
        enabled: r.get(4)?,
        weight: r.get(5)?,
        builtin: r.get(6)?,
        last_status: r.get(7)?,
        last_error: r.get(8)?,
        last_fetched_at: r.get(9)?,
        last_ok_at: r.get(10)?,
        created_at: r.get(11)?,
    })
}

fn sql_err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn is_unique_violation(e: &rusqlite::Error) -> bool {
    matches!(e, rusqlite::Error::SqliteFailure(f, _) if f.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE)
}

fn get_source(c: &Connection, id: &str) -> R<FeedSource> {
    c.query_row(&format!("SELECT {SOURCE_COLS} FROM feed_sources WHERE id = ?1"), params![id], source_from)
        .optional()
        .map_err(sql_err)?
        .ok_or_else(|| "fonte não encontrada".to_string())
}

fn list_sources(c: &Connection) -> R<Vec<FeedSource>> {
    let mut st = c
        .prepare(&format!(
            "SELECT {SOURCE_COLS} FROM feed_sources
             ORDER BY CASE category WHEN 'ai_dev' THEN 0 WHEN 'auto' THEN 1 WHEN 'ai_content' THEN 2 ELSE 3 END,
                      name COLLATE NOCASE"
        ))
        .map_err(sql_err)?;
    st.query_map([], source_from).map_err(sql_err)?.collect::<rusqlite::Result<_>>().map_err(sql_err)
}

fn check_source_category(cat: &str) -> R<()> {
    if SOURCE_CATEGORIES.contains(&cat) { Ok(()) } else { Err("categoria de fonte inválida".into()) }
}

fn check_source_weight(w: f64) -> R<f64> {
    if !w.is_finite() || !(0.2..=2.0).contains(&w) {
        return Err("o peso da fonte vai de 0,2 a 2".into());
    }
    Ok((w * 100.0).round() / 100.0)
}

fn check_name(name: &str) -> R<String> {
    let n = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if n.is_empty() {
        return Err("a fonte precisa de um nome".into());
    }
    Ok(n.chars().take(80).collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSource {
    name: String,
    url: String,
    category: String,
    weight: Option<f64>,
}

fn add_source(c: &Connection, input: &NewSource) -> R<FeedSource> {
    let url = validate_feed_url(&input.url)?;
    let name = check_name(&input.name)?;
    check_source_category(&input.category)?;
    let weight = check_source_weight(input.weight.unwrap_or(1.0))?;
    let id = new_id();
    c.execute(
        "INSERT INTO feed_sources (id, name, url, category, weight) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, url, input.category, weight],
    )
    .map_err(|e| if is_unique_violation(&e) { "essa fonte já está no Radar".to_string() } else { e.to_string() })?;
    get_source(c, &id)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourcePatch {
    name: Option<String>,
    category: Option<String>,
    enabled: Option<bool>,
    weight: Option<f64>,
}

fn update_source(c: &mut Connection, id: &str, patch: &SourcePatch) -> R<FeedSource> {
    let tx = c.transaction().map_err(sql_err)?;
    let set = |col: &str, v: &dyn rusqlite::ToSql| -> R<()> {
        let n = tx
            .execute(&format!("UPDATE feed_sources SET {col} = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, v])
            .map_err(sql_err)?;
        if n == 0 { Err("fonte não encontrada".into()) } else { Ok(()) }
    };
    if let Some(n) = &patch.name {
        set("name", &check_name(n)?)?;
    }
    if let Some(cat) = &patch.category {
        check_source_category(cat)?;
        set("category", cat)?;
    }
    if let Some(e) = patch.enabled {
        set("enabled", &e)?;
    }
    if let Some(w) = patch.weight {
        set("weight", &check_source_weight(w)?)?;
    }
    tx.commit().map_err(sql_err)?;
    get_source(c, id)
}

fn delete_source(c: &mut Connection, id: &str) -> R<()> {
    let tx = c.transaction().map_err(sql_err)?;
    tx.execute("DELETE FROM feed_items WHERE source_id = ?1 AND saved_at IS NULL", params![id]).map_err(sql_err)?;
    tx.execute("DELETE FROM feed_sources WHERE id = ?1", params![id]).map_err(sql_err)?;
    tx.commit().map_err(sql_err)
}

fn report_source(c: &Connection, id: &str, ok: bool, error: Option<&str>) -> R<FeedSource> {
    let error: Option<String> = if ok { None } else { error.map(|e| e.chars().take(400).collect()) };
    let n = c
        .execute(
            &format!(
                "UPDATE feed_sources SET last_status = ?2, last_error = ?3, last_fetched_at = {NOW},
                   last_ok_at = CASE WHEN ?2 = 'ok' THEN {NOW} ELSE last_ok_at END, updated_at = {NOW}
                 WHERE id = ?1"
            ),
            params![id, if ok { "ok" } else { "error" }, error],
        )
        .map_err(sql_err)?;
    if n == 0 {
        return Err("fonte não encontrada".into());
    }
    get_source(c, id)
}

#[tauri::command]
pub fn radar_sources_list(state: State<AppState>) -> R<Vec<FeedSource>> {
    with_conn(&state, |c| Ok(list_sources(c)))?
}

#[tauri::command]
pub fn radar_source_add(state: State<AppState>, input: NewSource) -> R<FeedSource> {
    with_conn(&state, |c| Ok(add_source(c, &input)))?
}

#[tauri::command]
pub fn radar_source_update(state: State<AppState>, id: String, patch: SourcePatch) -> R<FeedSource> {
    with_conn(&state, |c| Ok(update_source(c, &id, &patch)))?
}

#[tauri::command]
pub fn radar_source_delete(state: State<AppState>, id: String) -> R<()> {
    with_conn(&state, |c| Ok(delete_source(c, &id)))?
}

#[tauri::command]
pub fn radar_source_report(state: State<AppState>, id: String, ok: bool, error: Option<String>) -> R<FeedSource> {
    with_conn(&state, |c| Ok(report_source(c, &id, ok, error.as_deref())))?
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FeedItem {
    id: String,
    source_id: Option<String>,
    source_name: String,
    guid: Option<String>,
    url: String,
    canonical_url: String,
    title: String,
    title_key: String,
    excerpt: String,
    category: String,
    relevance: f64,
    published_at: Option<String>,
    fetched_at: String,
    read_at: Option<String>,
    saved_at: Option<String>,
    dismissed_at: Option<String>,
    title_pt: Option<String>,
    excerpt_pt: Option<String>,
}

const ITEM_COLS: &str = "id, source_id, source_name, guid, url, canonical_url, title, title_key, excerpt, category,
  relevance, published_at, fetched_at, read_at, saved_at, dismissed_at, title_pt, excerpt_pt";

fn item_from(r: &Row) -> rusqlite::Result<FeedItem> {
    Ok(FeedItem {
        id: r.get(0)?,
        source_id: r.get(1)?,
        source_name: r.get(2)?,
        guid: r.get(3)?,
        url: r.get(4)?,
        canonical_url: r.get(5)?,
        title: r.get(6)?,
        title_key: r.get(7)?,
        excerpt: r.get(8)?,
        category: r.get(9)?,
        relevance: r.get(10)?,
        published_at: r.get(11)?,
        fetched_at: r.get(12)?,
        read_at: r.get(13)?,
        saved_at: r.get(14)?,
        dismissed_at: r.get(15)?,
        title_pt: r.get(16)?,
        excerpt_pt: r.get(17)?,
    })
}

fn get_item(c: &Connection, id: &str) -> R<FeedItem> {
    c.query_row(&format!("SELECT {ITEM_COLS} FROM feed_items WHERE id = ?1"), params![id], item_from)
        .optional()
        .map_err(sql_err)?
        .ok_or_else(|| "item não encontrado".to_string())
}

fn list_items(c: &Connection) -> R<Vec<FeedItem>> {
    let mut st = c
        .prepare(&format!(
            "SELECT {ITEM_COLS} FROM feed_items WHERE dismissed_at IS NULL
             ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 3000"
        ))
        .map_err(sql_err)?;
    st.query_map([], item_from).map_err(sql_err)?.collect::<rusqlite::Result<_>>().map_err(sql_err)
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewItem {
    guid: Option<String>,
    url: String,
    canonical_url: String,
    title: String,
    title_key: String,
    excerpt: Option<String>,
    category: String,
    relevance: Option<f64>,
    published_at: Option<String>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpsertResult {
    inserted: i64,
    updated: i64,
    unchanged: i64,
    duplicates: i64,
    skipped: i64,
}

pub(crate) fn title_dedup_eligible(key: &str) -> bool {
    key.split_whitespace().count() >= 3 && key.chars().count() >= 16
}

fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 11 && b[..4].iter().all(u8::is_ascii_digit) && b[4] == b'-' && b[7] == b'-' && b[10] == b'T'
}

fn clean_item(it: &NewItem) -> Option<NewItem> {
    let title: String = it.title.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(300).collect();
    if title.is_empty() {
        return None;
    }
    let url = it.url.trim();
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) || url.len() > 2048 {
        return None;
    }
    let canonical = it.canonical_url.trim();
    if !canonical.starts_with("https://") || canonical.len() > 2048 {
        return None;
    }
    let mut key: String = it.title_key.trim().to_lowercase().chars().take(300).collect();
    if key.is_empty() {
        key = title.to_lowercase();
    }
    let category = if ITEM_CATEGORIES.contains(&it.category.as_str()) { it.category.clone() } else { "other".into() };
    Some(NewItem {
        guid: it.guid.as_ref().map(|g| g.trim().chars().take(500).collect::<String>()).filter(|g| !g.is_empty()),
        url: url.to_string(),
        canonical_url: canonical.to_string(),
        title,
        title_key: key,
        excerpt: Some(it.excerpt.clone().unwrap_or_default().chars().take(600).collect()),
        category,
        relevance: it.relevance.filter(|r| r.is_finite()).map(|r| (r * 100.0).round() / 100.0),
        published_at: it.published_at.clone().filter(|p| is_iso_date(p)),
    })
}

fn upsert_items(c: &mut Connection, source_id: &str, items: &[NewItem]) -> R<UpsertResult> {
    let tx = c.transaction().map_err(sql_err)?;
    let source_name: String = tx
        .query_row("SELECT name FROM feed_sources WHERE id = ?1", params![source_id], |r| r.get(0))
        .optional()
        .map_err(sql_err)?
        .ok_or_else(|| "fonte não encontrada".to_string())?;
    let cutoff: String = tx
        .query_row(&format!("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-{KEEP_DAYS} days')"), [], |r| r.get(0))
        .map_err(sql_err)?;
    let mut out = UpsertResult::default();
    for raw in items.iter().take(MAX_ITEMS_PER_BATCH) {
        let Some(it) = clean_item(raw) else {
            out.skipped += 1;
            continue;
        };
        if it.published_at.as_deref().is_some_and(|p| p < cutoff.as_str()) {
            out.skipped += 1;
            continue;
        }
        let tomb: bool = tx
            .query_row("SELECT 1 FROM feed_item_tombstones WHERE canonical_url = ?1", params![it.canonical_url], |_| Ok(()))
            .optional()
            .map_err(sql_err)?
            .is_some();
        if tomb {
            out.skipped += 1;
            continue;
        }
        let existing: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT id, source_id FROM feed_items WHERE canonical_url = ?1",
                params![it.canonical_url],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(sql_err)?;
        let relevance = it.relevance.unwrap_or(0.0);
        let excerpt = it.excerpt.clone().unwrap_or_default();
        if let Some((id, owner)) = existing {
            if owner.as_deref() != Some(source_id) {
                out.duplicates += 1;
                continue;
            }
            let n = tx
                .execute(
                    &format!(
                        "UPDATE feed_items SET title_pt = CASE WHEN title IS ?2 THEN title_pt END,
                           excerpt_pt = CASE WHEN title IS ?2 AND excerpt IS ?4 THEN excerpt_pt END,
                           title = ?2, title_key = ?3, excerpt = ?4, category = ?5, relevance = ?6,
                           guid = COALESCE(guid, ?7), source_name = ?8, updated_at = {NOW}
                         WHERE id = ?1 AND (title IS NOT ?2 OR excerpt IS NOT ?4 OR category IS NOT ?5
                           OR relevance IS NOT ?6 OR source_name IS NOT ?8)"
                    ),
                    params![id, it.title, it.title_key, excerpt, it.category, relevance, it.guid, source_name],
                )
                .map_err(sql_err)?;
            if n > 0 { out.updated += 1 } else { out.unchanged += 1 }
            continue;
        }
        if let Some(g) = &it.guid {
            let same_guid = tx
                .query_row(
                    "SELECT 1 FROM feed_items WHERE source_id = ?1 AND guid = ?2",
                    params![source_id, g],
                    |_| Ok(()),
                )
                .optional()
                .map_err(sql_err)?
                .is_some();
            if same_guid {
                out.duplicates += 1;
                continue;
            }
        }
        if title_dedup_eligible(&it.title_key) {
            let same_title = tx
                .query_row("SELECT 1 FROM feed_items WHERE title_key = ?1 LIMIT 1", params![it.title_key], |_| Ok(()))
                .optional()
                .map_err(sql_err)?
                .is_some();
            if same_title {
                out.duplicates += 1;
                continue;
            }
        }
        tx.execute(
            "INSERT INTO feed_items (id, source_id, source_name, guid, url, canonical_url, title, title_key, excerpt,
               category, relevance, published_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                new_id(),
                source_id,
                source_name,
                it.guid,
                it.url,
                it.canonical_url,
                it.title,
                it.title_key,
                excerpt,
                it.category,
                relevance,
                it.published_at
            ],
        )
        .map_err(sql_err)?;
        out.inserted += 1;
    }
    tx.commit().map_err(sql_err)?;
    Ok(out)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    read: Option<bool>,
    saved: Option<bool>,
    dismissed: Option<bool>,
}

fn set_item(c: &mut Connection, id: &str, patch: &ItemPatch) -> R<FeedItem> {
    let tx = c.transaction().map_err(sql_err)?;
    for (col, v) in [("read_at", patch.read), ("saved_at", patch.saved), ("dismissed_at", patch.dismissed)] {
        let Some(on) = v else { continue };
        let value = if on { format!("COALESCE({col}, {NOW})") } else { "NULL".into() };
        let n = tx
            .execute(&format!("UPDATE feed_items SET {col} = {value}, updated_at = {NOW} WHERE id = ?1"), params![id])
            .map_err(sql_err)?;
        if n == 0 {
            return Err("item não encontrado".into());
        }
    }
    tx.commit().map_err(sql_err)?;
    get_item(c, id)
}

fn cleanup(c: &mut Connection, days: i64) -> R<i64> {
    let days = days.clamp(7, 365);
    let tx = c.transaction().map_err(sql_err)?;
    let cutoff = format!("strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-{days} days')");
    let old = format!("saved_at IS NULL AND COALESCE(published_at, fetched_at) < {cutoff}");
    tx.execute(
        &format!("INSERT OR IGNORE INTO feed_item_tombstones (canonical_url) SELECT canonical_url FROM feed_items WHERE {old}"),
        [],
    )
    .map_err(sql_err)?;
    let n = tx.execute(&format!("DELETE FROM feed_items WHERE {old}"), []).map_err(sql_err)?;
    tx.execute(
        "DELETE FROM feed_item_tombstones WHERE removed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days')",
        [],
    )
    .map_err(sql_err)?;
    tx.commit().map_err(sql_err)?;
    Ok(n as i64)
}

#[tauri::command(async)]
pub fn radar_items_list(state: State<AppState>) -> R<Vec<FeedItem>> {
    with_conn(&state, |c| Ok(list_items(c)))?
}

const MAX_TRANSLATE_IDS: usize = 30;

type PendingPt = (String, String, String);

fn pending_pt(c: &Connection, ids: &[String]) -> R<(Option<String>, Vec<PendingPt>)> {
    let model = crate::briefing::local_translate_model(c)?;
    let mut rows = vec![];
    for id in ids {
        let row: Option<PendingPt> = c
            .query_row("SELECT id, title, excerpt FROM feed_items WHERE id = ?1 AND title_pt IS NULL", params![id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()
            .map_err(sql_err)?;
        if let Some(r) = row {
            rows.push(r);
        }
    }
    Ok((model, rows))
}

fn save_pt(c: &Connection, rows: &[PendingPt], done: Vec<(String, String, Option<String>)>) -> R<Vec<FeedItem>> {
    let mut out = vec![];
    for (key, title, summary) in done {
        let Some(idx) = key.strip_prefix('r').and_then(|n| n.parse::<usize>().ok()) else { continue };
        let Some((id, _, _)) = rows.get(idx) else { continue };
        let title: String = title.trim().chars().take(300).collect();
        if title.is_empty() {
            continue;
        }
        let excerpt = summary.map(|s| s.trim().chars().take(600).collect::<String>()).filter(|s| !s.is_empty());
        c.execute(
            &format!("UPDATE feed_items SET title_pt = ?2, excerpt_pt = ?3, updated_at = {NOW} WHERE id = ?1"),
            params![id, title, excerpt],
        )
        .map_err(sql_err)?;
        out.push(get_item(c, id)?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn radar_translate(state: State<'_, AppState>, ids: Vec<String>) -> R<Vec<FeedItem>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    if ids.len() > MAX_TRANSLATE_IDS {
        return Err(format!("envie até {MAX_TRANSLATE_IDS} itens por vez"));
    }
    let (model, rows) = with_conn(&state, |c| Ok(pending_pt(c, &ids)))??;
    let Some(model) = model else {
        return Err("[local-ausente] os modelos locais estão desligados".into());
    };
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let triples: Vec<(String, String, Option<String>)> = rows
        .iter()
        .enumerate()
        .map(|(i, (_, title, excerpt))| (format!("r{i}"), title.clone(), if excerpt.trim().is_empty() { None } else { Some(excerpt.clone()) }))
        .collect();
    let done = tauri::async_runtime::spawn_blocking(move || crate::briefing::translate_triples(&model, triples))
        .await
        .map_err(|e| format!("[local-falhou] {e}"))??;
    with_conn(&state, |c| Ok(save_pt(c, &rows, done)))?
}

#[tauri::command(async)]
pub fn radar_items_upsert(state: State<AppState>, source_id: String, items: Vec<NewItem>) -> R<UpsertResult> {
    with_conn(&state, |c| Ok(upsert_items(c, &source_id, &items)))?
}

#[tauri::command]
pub fn radar_item_set(state: State<AppState>, id: String, patch: ItemPatch) -> R<FeedItem> {
    with_conn(&state, |c| Ok(set_item(c, &id, &patch)))?
}

#[tauri::command(async)]
pub fn radar_cleanup(state: State<AppState>, days: Option<i64>) -> R<i64> {
    with_conn(&state, |c| Ok(cleanup(c, days.unwrap_or(KEEP_DAYS))))?
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Keyword {
    id: String,
    term: String,
    kind: String,
    category: Option<String>,
    weight: f64,
    builtin: bool,
}

const KEYWORD_COLS: &str = "id, term, kind, category, weight, builtin";

fn keyword_from(r: &Row) -> rusqlite::Result<Keyword> {
    Ok(Keyword { id: r.get(0)?, term: r.get(1)?, kind: r.get(2)?, category: r.get(3)?, weight: r.get(4)?, builtin: r.get(5)? })
}

fn list_keywords(c: &Connection) -> R<Vec<Keyword>> {
    let mut st = c
        .prepare(&format!("SELECT {KEYWORD_COLS} FROM radar_keywords ORDER BY kind, weight DESC, term"))
        .map_err(sql_err)?;
    st.query_map([], keyword_from).map_err(sql_err)?.collect::<rusqlite::Result<_>>().map_err(sql_err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordInput {
    id: Option<String>,
    term: String,
    kind: String,
    category: Option<String>,
    weight: f64,
}

pub(crate) fn normalize_term(t: &str) -> String {
    t.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn save_keyword(c: &Connection, input: &KeywordInput) -> R<Keyword> {
    let term = normalize_term(&input.term);
    if term.is_empty() || term.trim_end_matches('*').is_empty() {
        return Err("escreva a palavra-chave".into());
    }
    if term.chars().count() > 60 {
        return Err("palavra-chave longa demais (até 60 caracteres)".into());
    }
    if input.kind != "boost" && input.kind != "mute" {
        return Err("tipo de palavra-chave inválido".into());
    }
    let category = match input.category.as_deref() {
        _ if input.kind == "mute" => None,
        None | Some("") => None,
        Some(cat) if KEYWORD_CATEGORIES.contains(&cat) => Some(cat.to_string()),
        Some(_) => return Err("categoria inválida".into()),
    };
    if !input.weight.is_finite() || input.weight <= 0.0 || input.weight > 5.0 {
        return Err("o peso vai de 0,1 a 5".into());
    }
    let weight = ((input.weight * 100.0).round() / 100.0).max(0.1);
    let dup = |e: rusqlite::Error| if is_unique_violation(&e) { "essa palavra já está na lista".to_string() } else { e.to_string() };
    let id = match &input.id {
        Some(id) => {
            let n = c
                .execute(
                    &format!(
                        "UPDATE radar_keywords SET term = ?2, kind = ?3, category = ?4, weight = ?5, updated_at = {NOW}
                         WHERE id = ?1"
                    ),
                    params![id, term, input.kind, category, weight],
                )
                .map_err(dup)?;
            if n == 0 {
                return Err("palavra-chave não encontrada".into());
            }
            id.clone()
        }
        None => {
            let id = new_id();
            c.execute(
                "INSERT INTO radar_keywords (id, term, kind, category, weight) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, term, input.kind, category, weight],
            )
            .map_err(dup)?;
            id
        }
    };
    c.query_row(&format!("SELECT {KEYWORD_COLS} FROM radar_keywords WHERE id = ?1"), params![id], keyword_from)
        .map_err(sql_err)
}

#[tauri::command]
pub fn radar_keywords_list(state: State<AppState>) -> R<Vec<Keyword>> {
    with_conn(&state, |c| Ok(list_keywords(c)))?
}

#[tauri::command]
pub fn radar_keyword_save(state: State<AppState>, input: KeywordInput) -> R<Keyword> {
    with_conn(&state, |c| Ok(save_keyword(c, &input)))?
}

#[tauri::command]
pub fn radar_keyword_delete(state: State<AppState>, id: String) -> R<()> {
    with_conn(&state, |c| c.execute("DELETE FROM radar_keywords WHERE id = ?1", params![id]).map(|_| ()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct TempDb {
        dir: PathBuf,
        conn: Connection,
    }
    impl Drop for TempDb {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.dir).ok();
        }
    }
    fn temp_db() -> TempDb {
        let dir = std::env::temp_dir().join(format!("ps-radar-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let conn = crate::db::open(&dir.join("t.sqlite"), &dir.join("b")).unwrap();
        TempDb { dir, conn }
    }

    fn item(url: &str, title: &str, published: Option<&str>) -> NewItem {
        let key = title.to_lowercase().replace(|c: char| !c.is_alphanumeric(), " ");
        NewItem {
            guid: Some(url.to_string()),
            url: url.to_string(),
            canonical_url: url.replace("http://", "https://"),
            title: title.to_string(),
            title_key: key.split_whitespace().collect::<Vec<_>>().join(" "),
            excerpt: Some("trecho".into()),
            category: "ai_dev".into(),
            relevance: Some(4.0),
            published_at: published.map(str::to_string),
        }
    }

    fn ago(modifier: &str) -> String {
        let c = Connection::open_in_memory().unwrap();
        c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)", params![modifier], |r| r.get(0)).unwrap()
    }
    fn recent() -> String {
        ago("-1 hours")
    }

    fn count(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn migracao_do_zero_cria_tabelas_e_semeia() {
        let t = temp_db();
        assert_eq!(crate::db::schema_version(&t.conn).unwrap(), crate::db::latest_version());
        let sources = list_sources(&t.conn).unwrap();
        assert_eq!(sources.len(), 18);
        assert!(sources.iter().all(|s| s.enabled && s.builtin && s.last_fetched_at.is_none()));
        assert!(sources.iter().all(|s| validate_feed_url(&s.url).is_ok()));
        assert_eq!(sources[0].category, "ai_dev");
        let kws = list_keywords(&t.conn).unwrap();
        assert!(kws.len() > 150, "{} palavras", kws.len());
        assert!(kws.iter().any(|k| k.term == "claude code" && k.kind == "boost" && k.category.as_deref() == Some("ai_dev")));
        assert!(kws.iter().any(|k| k.term == "hiring" && k.kind == "mute" && k.category.is_none()));
        assert_eq!(count(&t.conn, "PRAGMA foreign_keys"), 1);
        assert_eq!(count(&t.conn, "SELECT COUNT(*) FROM feed_item_tombstones"), 0);
    }

    fn tuples(src: &str) -> Vec<Vec<String>> {
        let mut out = vec![];
        let mut rest = src;
        while let Some(i) = rest.find("['") {
            let body = &rest[i + 1..];
            let end = body.find(']').unwrap();
            let inner = &body[..end];
            let mut fields = vec![];
            let mut cur = String::new();
            let mut quoted = false;
            for ch in inner.chars() {
                match ch {
                    '\'' => quoted = !quoted,
                    ',' if !quoted => {
                        fields.push(cur.trim().to_string());
                        cur.clear();
                    }
                    _ => cur.push(ch),
                }
            }
            fields.push(cur.trim().to_string());
            out.push(fields);
            rest = &body[end..];
        }
        out
    }

    #[test]
    fn semente_igual_ao_front() {
        let ts = include_str!("../../src/features/radar/seed.ts");
        let t = temp_db();
        let s_start = ts.find("SEED_SOURCES").unwrap();
        let s_end = ts[s_start..].find("\n]").unwrap() + s_start;
        let front: Vec<Vec<String>> = tuples(&ts[s_start..s_end]);
        let db = list_sources(&t.conn).unwrap();
        assert_eq!(front.len(), db.len(), "número de fontes difere entre seed.ts e 003_radar.sql");
        for f in &front {
            let s = db.iter().find(|s| s.id == f[0]).unwrap_or_else(|| panic!("fonte {} ausente no SQL", f[0]));
            assert_eq!((s.name.as_str(), s.url.as_str(), s.category.as_str()), (f[1].as_str(), f[2].as_str(), f[3].as_str()));
            assert!((s.weight - f[4].parse::<f64>().unwrap()).abs() < 1e-9, "peso de {}", s.id);
        }
        let k_start = ts.find("SEED_KEYWORDS").unwrap();
        let k_end = ts[k_start..].find("\n}").unwrap() + k_start;
        let kws = list_keywords(&t.conn).unwrap();
        let mut seen = 0;
        let mut group = "";
        for line in ts[k_start..k_end].lines() {
            let l = line.trim();
            if l.ends_with(": [") {
                group = l.trim_end_matches(": [");
                continue;
            }
            for f in tuples(l) {
                let k = kws.iter().find(|k| k.term == f[0]).unwrap_or_else(|| panic!("palavra '{}' ausente no SQL", f[0]));
                let (kind, cat) = match group {
                    "mute" => ("mute", None),
                    "signal" => ("boost", None),
                    g => ("boost", Some(g)),
                };
                assert_eq!((k.kind.as_str(), k.category.as_deref()), (kind, cat), "grupo de '{}'", f[0]);
                assert!((k.weight - f[1].parse::<f64>().unwrap()).abs() < 1e-9, "peso de '{}'", f[0]);
                seen += 1;
            }
        }
        assert_eq!(seen, kws.len(), "número de palavras difere entre seed.ts e 003_radar.sql");
    }

    #[test]
    fn upsert_nao_duplica_e_preserva_estados() {
        let mut t = temp_db();
        let now = recent();
        let a = item("https://example.com/a", "Primeira notícia sobre agentes de código", Some(&now));
        let b = item("https://example.com/b", "Segunda notícia sobre modelos novos", Some(&now));
        let r = upsert_items(&mut t.conn, "seed-openai", &[a.clone(), b.clone()]).unwrap();
        assert_eq!(r, UpsertResult { inserted: 2, ..Default::default() });

        let items = list_items(&t.conn).unwrap();
        let id_a = items.iter().find(|i| i.canonical_url == "https://example.com/a").unwrap().id.clone();
        set_item(&mut t.conn, &id_a, &ItemPatch { read: Some(true), saved: Some(true), ..Default::default() }).unwrap();

        let mut a2 = a.clone();
        a2.title = "Primeira notícia sobre agentes de código (atualizada)".into();
        a2.published_at = Some(ago("-5 minutes"));
        let r = upsert_items(&mut t.conn, "seed-openai", &[a2, b.clone(), b]).unwrap();
        assert_eq!((r.inserted, r.updated, r.unchanged), (0, 1, 2));
        assert_eq!(count(&t.conn, "SELECT COUNT(*) FROM feed_items"), 2);
        let it = get_item(&t.conn, &id_a).unwrap();
        assert!(it.read_at.is_some() && it.saved_at.is_some(), "estados preservados");
        assert!(it.title.ends_with("(atualizada)"));
        assert_eq!(it.published_at.as_deref(), Some(now.as_str()));
    }

    #[test]
    fn dedup_por_titulo_guid_e_outra_fonte() {
        let mut t = temp_db();
        let now = recent();
        let a = item("https://example.com/post", "OpenAI lança novo modelo de código", Some(&now));
        upsert_items(&mut t.conn, "seed-openai", &[a.clone()]).unwrap();

        let r = upsert_items(&mut t.conn, "seed-hn", &[a.clone()]).unwrap();
        assert_eq!(r.duplicates, 1);
        let r = upsert_items(&mut t.conn, "seed-hn", &[item("https://news.example/x", "OpenAI lança novo modelo de código", Some(&now))]).unwrap();
        assert_eq!(r.duplicates, 1);
        let mut g = item("https://example.com/post-v2", "Título totalmente diferente aqui", Some(&now));
        g.guid = Some("https://example.com/post".into());
        assert_eq!(upsert_items(&mut t.conn, "seed-openai", &[g]).unwrap().duplicates, 1);
        let v1 = item("https://github.com/a/a/releases/tag/v1.2.0", "v1.2.0", Some(&now));
        let v2 = item("https://github.com/b/b/releases/tag/v1.2.0", "v1.2.0", Some(&now));
        assert_eq!(upsert_items(&mut t.conn, "seed-vite", &[v1, v2]).unwrap().inserted, 2);
        assert_eq!(count(&t.conn, "SELECT COUNT(*) FROM feed_items"), 3);
        assert!(title_dedup_eligible("openai lanca novo modelo"));
        assert!(!title_dedup_eligible("vite 8 3 6"));
    }

    #[test]
    fn upsert_descarta_invalidos_e_antigos() {
        let mut t = temp_db();
        let now = recent();
        let mut bad_url = item("javascript:alert(1)", "Título qualquer bem longo", Some(&now));
        bad_url.canonical_url = "javascript:alert(1)".into();
        let empty = item("https://example.com/e", "   ", Some(&now));
        let old = item("https://example.com/old", "Notícia de muito tempo atrás", Some("2020-01-01T00:00:00.000Z"));
        let mut weird_cat = item("https://example.com/w", "Categoria desconhecida vira outra", Some(&now));
        weird_cat.category = "politica".into();
        let r = upsert_items(&mut t.conn, "seed-openai", &[bad_url, empty, old, weird_cat]).unwrap();
        assert_eq!((r.inserted, r.skipped), (1, 3));
        assert_eq!(list_items(&t.conn).unwrap()[0].category, "other");
        assert!(upsert_items(&mut t.conn, "nao-existe", &[]).is_err());
    }

    #[test]
    fn limpeza_apaga_antigos_menos_salvos_e_nao_deixa_voltar() {
        let mut t = temp_db();
        let ins = |c: &Connection, id: &str, url: &str, published: &str, saved: bool| {
            c.execute(
                "INSERT INTO feed_items (id, source_id, source_name, url, canonical_url, title, title_key, category, published_at, saved_at)
                 VALUES (?1, 'seed-openai', 'OpenAI News', ?2, ?2, 'Título', 'titulo', 'ai_dev', ?3, ?4)",
                params![id, url, published, if saved { Some("2026-01-01T00:00:00.000Z") } else { None }],
            )
            .unwrap();
        };
        let now = recent();
        ins(&t.conn, "velho", "https://example.com/velho", "2026-01-01T00:00:00.000Z", false);
        ins(&t.conn, "velho-salvo", "https://example.com/velho-salvo", "2026-01-01T00:00:00.000Z", true);
        ins(&t.conn, "novo", "https://example.com/novo", &now, false);
        assert_eq!(cleanup(&mut t.conn, 60).unwrap(), 1);
        let ids: Vec<String> = list_items(&t.conn).unwrap().into_iter().map(|i| i.id).collect();
        assert!(ids.contains(&"velho-salvo".to_string()) && ids.contains(&"novo".to_string()) && ids.len() == 2);
        let back = item("https://example.com/velho", "Título que voltou no feed", Some(&now));
        assert_eq!(upsert_items(&mut t.conn, "seed-openai", &[back]).unwrap().skipped, 1);
        assert_eq!(count(&t.conn, "SELECT COUNT(*) FROM feed_item_tombstones"), 1);
    }

    #[test]
    fn validacao_de_url() {
        for ok in ["https://openai.com/news/rss.xml", "http://example.com/feed", "https://github.com/a/b/releases.atom?x=1", "  https://hnrss.org/frontpage  "] {
            assert!(validate_feed_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "feed",
            "/rss.xml",
            "ftp://example.com/feed",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "http://localhost:5173/x",
            "http://app.localhost/x",
            "http://127.0.0.1/feed",
            "http://10.0.0.8/feed",
            "http://192.168.1.10/rss",
            "http://172.16.0.1/rss",
            "http://169.254.169.254/latest",
            "http://[::1]/feed",
            "http://2130706433/",
            "https://user:senha@example.com/feed",
            "https://exa mple.com/feed",
        ] {
            assert!(validate_feed_url(bad).is_err(), "deveria recusar {bad:?}");
        }
        assert_eq!(validate_feed_url(" https://a.com/x ").unwrap(), "https://a.com/x");
        assert!(validate_feed_url("http://localhost/x").unwrap_err().starts_with("[url]"));
    }

    #[test]
    fn redirecionamento_relativo() {
        assert_eq!(resolve_location("https://a.com/x/feed.xml", "https://b.com/f").unwrap(), "https://b.com/f");
        assert_eq!(resolve_location("https://a.com/x/feed.xml", "//c.com/f").unwrap(), "https://c.com/f");
        assert_eq!(resolve_location("https://a.com/x/feed.xml", "/novo.xml").unwrap(), "https://a.com/novo.xml");
        assert_eq!(resolve_location("https://a.com/x/feed.xml?q=1", "rss2.xml").unwrap(), "https://a.com/x/rss2.xml");
        assert_eq!(resolve_location("https://a.com", "rss").unwrap(), "https://a.com/rss");
        assert!(validate_feed_url(&resolve_location("https://a.com/f", "http://127.0.0.1/").unwrap()).is_err());
    }

    #[test]
    fn decodificacao_e_cheiro_de_feed() {
        let rss = "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel></channel></rss>";
        assert_eq!(decode_body(rss.as_bytes(), Some("application/rss+xml")).unwrap(), rss);
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(b"<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>");
        assert!(decode_body(&bom, None).unwrap().starts_with("<feed"));
        let mut latin = b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><rss><title>Not".to_vec();
        latin.push(0xED);
        latin.extend_from_slice(b"cias</title></rss>");
        assert!(decode_body(&latin, None).unwrap().contains("Notícias"));
        let mut cp = b"<rss>".to_vec();
        cp.push(0x93);
        cp.extend_from_slice(b"aspas");
        cp.push(0x94);
        cp.extend_from_slice(b"</rss>");
        assert!(decode_body(&cp, Some("text/xml; charset=windows-1252")).unwrap().contains("\u{201C}aspas\u{201D}"));
        assert!(decode_body(b"<!DOCTYPE html><html><body>rss</body></html>", Some("text/html")).unwrap_err().starts_with("[formato]"));
        assert!(decode_body(b"{\"items\": []}", None).is_err());
        assert!(decode_body(&[0x1f, 0x8b, 8, 0], None).unwrap_err().contains("compactado"));
        assert_eq!(charset_of(Some("text/xml; charset=\"UTF-8\""), b""), "utf-8");
    }

    #[test]
    fn fontes_crud_e_permissao_de_busca() {
        let mut t = temp_db();
        let url = "https://example.com/feed.xml";
        assert!(!source_enabled(&t.conn, url).unwrap());
        let s = add_source(&t.conn, &NewSource { name: "  Exemplo  ".into(), url: url.into(), category: "stack".into(), weight: None }).unwrap();
        assert_eq!((s.name.as_str(), s.weight, s.enabled), ("Exemplo", 1.0, true));
        assert!(source_enabled(&t.conn, url).unwrap());
        let dup = add_source(&t.conn, &NewSource { name: "x".into(), url: url.into(), category: "stack".into(), weight: None });
        assert_eq!(dup.unwrap_err(), "essa fonte já está no Radar");
        assert!(add_source(&t.conn, &NewSource { name: "x".into(), url: "http://localhost/x".into(), category: "stack".into(), weight: None }).is_err());
        assert!(add_source(&t.conn, &NewSource { name: "x".into(), url: "https://b.com/x".into(), category: "noticias".into(), weight: None }).is_err());

        assert!(update_source(&mut t.conn, &s.id, &SourcePatch { weight: Some(9.0), ..Default::default() }).is_err());
        let s2 = update_source(&mut t.conn, &s.id, &SourcePatch { enabled: Some(false), weight: Some(0.756), ..Default::default() }).unwrap();
        assert_eq!((s2.enabled, s2.weight), (false, 0.76));
        assert!(!source_enabled(&t.conn, url).unwrap(), "desabilitada não pode ser buscada");

        let r = report_source(&t.conn, &s.id, false, Some("[tempo] a fonte demorou demais")).unwrap();
        assert_eq!(r.last_status.as_deref(), Some("error"));
        assert!(r.last_fetched_at.is_some() && r.last_ok_at.is_none());
        let r = report_source(&t.conn, &s.id, true, None).unwrap();
        assert!(r.last_error.is_none() && r.last_ok_at.is_some());

        let now = recent();
        upsert_items(&mut t.conn, &s.id, &[item("https://example.com/1", "Item um da fonte de exemplo", Some(&now)), item("https://example.com/2", "Item dois da fonte de exemplo", Some(&now))]).unwrap();
        let first = list_items(&t.conn).unwrap().into_iter().find(|i| i.canonical_url.ends_with("/1")).unwrap();
        set_item(&mut t.conn, &first.id, &ItemPatch { saved: Some(true), ..Default::default() }).unwrap();
        delete_source(&mut t.conn, &s.id).unwrap();
        let left = list_items(&t.conn).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!((left[0].source_id.as_deref(), left[0].source_name.as_str()), (None, "Exemplo"));
        assert!(get_source(&t.conn, &s.id).is_err());
    }

    #[test]
    fn estados_do_item_ligam_e_desligam() {
        let mut t = temp_db();
        upsert_items(&mut t.conn, "seed-vite", &[item("https://example.com/i", "Um item qualquer para estados", Some(&recent()))]).unwrap();
        let id = list_items(&t.conn).unwrap()[0].id.clone();
        let i = set_item(&mut t.conn, &id, &ItemPatch { dismissed: Some(true), ..Default::default() }).unwrap();
        assert!(i.dismissed_at.is_some());
        assert!(list_items(&t.conn).unwrap().is_empty(), "dispensados não aparecem");
        let i = set_item(&mut t.conn, &id, &ItemPatch { dismissed: Some(false), read: Some(true), ..Default::default() }).unwrap();
        assert!(i.dismissed_at.is_none() && i.read_at.is_some());
        let read_at = i.read_at.clone();
        let i = set_item(&mut t.conn, &id, &ItemPatch { read: Some(true), ..Default::default() }).unwrap();
        assert_eq!(i.read_at, read_at, "marcar de novo não muda a data");
        assert!(set_item(&mut t.conn, "nada", &ItemPatch { read: Some(true), ..Default::default() }).is_err());
    }

    #[test]
    fn palavras_chave_validam_e_normalizam() {
        let t = temp_db();
        let k = save_keyword(&t.conn, &KeywordInput { id: None, term: "  Model   Routing ".into(), kind: "boost".into(), category: Some("ai_dev".into()), weight: 1.234 }).unwrap();
        assert_eq!((k.term.as_str(), k.weight, k.builtin), ("model routing", 1.23, false));
        let dup = save_keyword(&t.conn, &KeywordInput { id: None, term: "MODEL ROUTING".into(), kind: "mute".into(), category: None, weight: 1.0 });
        assert_eq!(dup.unwrap_err(), "essa palavra já está na lista");
        let m = save_keyword(&t.conn, &KeywordInput { id: None, term: "podcast ao vivo".into(), kind: "mute".into(), category: Some("ai_content".into()), weight: 2.0 }).unwrap();
        assert!(m.category.is_none(), "penalização não tem categoria");
        assert!(save_keyword(&t.conn, &KeywordInput { id: None, term: "*".into(), kind: "boost".into(), category: None, weight: 1.0 }).is_err());
        assert!(save_keyword(&t.conn, &KeywordInput { id: None, term: "x".into(), kind: "boost".into(), category: None, weight: 0.0 }).is_err());
        let up = save_keyword(&t.conn, &KeywordInput { id: Some(k.id.clone()), term: "model routing".into(), kind: "boost".into(), category: Some("ai_dev".into()), weight: 0.5 }).unwrap();
        assert_eq!(up.weight, 0.5);
    }

    #[test]
    fn comandos_registraveis() {
        let _builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(tauri::generate_handler![
            super::radar_fetch,
            super::radar_sources_list,
            super::radar_source_add,
            super::radar_source_update,
            super::radar_source_delete,
            super::radar_source_report,
            super::radar_items_list,
            super::radar_items_upsert,
            super::radar_item_set,
            super::radar_cleanup,
            super::radar_keywords_list,
            super::radar_keyword_save,
            super::radar_keyword_delete,
        ]);
    }

    #[test]
    #[ignore]
    fn busca_real_segue_redirecionamento() {
        for url in ["https://simonwillison.net/atom/everything", "https://www.openai.com/news/rss.xml"] {
            let body = fetch_feed_blocking(url).unwrap_or_else(|e| panic!("{url}: {e}"));
            assert!(looks_like_feed(&body), "{url}");
        }
        assert!(fetch_feed_blocking("https://api.github.com/").unwrap_err().starts_with("[formato]"));
        assert!(fetch_feed_blocking("https://www.anthropic.com/news/rss.xml").unwrap_err().starts_with("[http 404]"));
    }

    #[test]
    #[ignore]
    fn busca_real_das_fontes_semeadas() {
        let t = temp_db();
        let mut failures = vec![];
        for s in list_sources(&t.conn).unwrap() {
            match fetch_feed_blocking(&s.url) {
                Ok(body) => println!("ok  {:>8} B  {}", body.len(), s.url),
                Err(e) => failures.push(format!("{}: {e}", s.url)),
            }
        }
        assert!(failures.is_empty(), "{failures:#?}");
    }
}
