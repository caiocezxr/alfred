use crate::commands::R;
use crate::github::{git, home, parse_remote, safe_dir};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrRef {
    number: u32,
    url: String,
    repo: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    id: String,
    tool: &'static str,
    cwd: Option<String>,
    project: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
    title: Option<String>,
    first_prompt: Option<String>,
    last_prompt: Option<String>,
    started: Option<String>,
    updated: String,
    prompts: u32,
    prs: Vec<PrRef>,
    cost: Option<f64>,
    lines_added: Option<u64>,
    lines_removed: Option<u64>,
    bytes: u64,
}

struct Entry {
    len: u64,
    mtime: u64,
    path: PathBuf,
    session: Option<Session>,
}

static CACHE: Mutex<Option<HashMap<String, Entry>>> = Mutex::new(None);
static REPOS: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

fn clip(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= n {
        return t.to_string();
    }
    let mut out: String = t.chars().take(n).collect();
    out.push('…');
    out
}

fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\":\"");
    let i = line.find(&pat)? + pat.len();
    let rest = &line[i..];
    let mut end = 0;
    let b = rest.as_bytes();
    while end < b.len() {
        if b[end] == b'\\' {
            end += 2;
            continue;
        }
        if b[end] == b'"' {
            return Some(&rest[..end]);
        }
        end += 1;
    }
    None
}

fn iso_of(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn prompt_text(content: &Value) -> Option<String> {
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(a) => {
            if a.iter().any(|b| b.get("type").and_then(Value::as_str) == Some("tool_result")) {
                return None;
            }
            a.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n")
        }
        _ => return None,
    };
    let t = text.trim();
    if t.is_empty() || t.starts_with("[Request interrupted") || t.starts_with("Caveat:") || t.starts_with("This session is being continued") {
        return None;
    }
    if t.starts_with('<') {
        let cmd = t.split("<command-name>").nth(1).and_then(|r| r.split("</command-name>").next())?;
        let args = t.split("<command-args>").nth(1).and_then(|r| r.split("</command-args>").next()).unwrap_or("");
        return Some(format!("{cmd} {args}").trim().to_string());
    }
    Some(t.to_string())
}

fn scan_claude(path: &Path, len: u64, mtime: u64) -> Option<Session> {
    let f = std::fs::File::open(path).ok()?;
    let id = path.file_stem()?.to_string_lossy().to_string();
    let mut s = Session {
        id,
        tool: "claude",
        cwd: None,
        project: None,
        repo: None,
        branch: None,
        title: None,
        first_prompt: None,
        last_prompt: None,
        started: None,
        updated: iso_of(mtime),
        prompts: 0,
        prs: vec![],
        cost: None,
        lines_added: None,
        lines_removed: None,
        bytes: len,
    };
    let (mut custom, mut ai, mut last_ts) = (None::<String>, None::<String>, None::<String>);
    let mut reader = BufReader::new(f);
    let mut buf = String::new();
    loop {
        buf.clear();
        match reader.read_line(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = buf.as_str();
        if line.starts_with("{\"type\":\"") {
            let ty = field(line, "type").unwrap_or("");
            match ty {
                "custom-title" | "ai-title" | "last-prompt" | "pr-link" | "cost-state" | "relocated" => {
                    let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                    let g = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
                    match ty {
                        "custom-title" => custom = g("customTitle").filter(|t| !t.trim().is_empty()),
                        "ai-title" => ai = g("aiTitle").filter(|t| !t.trim().is_empty()),
                        "last-prompt" => {
                            if let Some(p) = g("lastPrompt").and_then(|p| prompt_text(&Value::String(p))) {
                                s.last_prompt = Some(clip(&p, 280));
                            }
                        }
                        "relocated" => {
                            if let Some(c) = g("relocatedCwd") {
                                s.cwd = Some(c);
                            }
                        }
                        "pr-link" => {
                            let num = v.get("prNumber").and_then(|n| n.as_u64().or_else(|| n.as_str().and_then(|x| x.parse().ok())));
                            if let (Some(number), Some(url), Some(repo)) = (num, g("prUrl"), g("prRepository")) {
                                let pr = PrRef { number: number as u32, url, repo };
                                if !s.prs.contains(&pr) {
                                    s.prs.push(pr);
                                }
                            }
                        }
                        _ => {
                            s.cost = v.get("totalCostUSD").and_then(Value::as_f64);
                            s.lines_added = v.get("totalLinesAdded").and_then(Value::as_u64);
                            s.lines_removed = v.get("totalLinesRemoved").and_then(Value::as_u64);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        if !line.contains("\"type\":\"user\"") && !line.contains("\"type\":\"assistant\"") {
            continue;
        }
        if line.contains("\"isSidechain\":true") {
            continue;
        }
        if let Some(t) = field(line, "timestamp") {
            if s.started.is_none() {
                s.started = Some(t.to_string());
            }
            last_ts = Some(t.to_string());
        }
        if s.cwd.is_none() {
            s.cwd = field(line, "cwd").map(|c| c.replace("\\/", "/"));
        }
        if let Some(b) = field(line, "gitBranch") {
            if !b.is_empty() && b != "HEAD" {
                s.branch = Some(b.to_string());
            }
        }
        let is_user = field(line, "type") == Some("user") || line.contains("\"role\":\"user\"");
        if !is_user || line.contains("\"isMeta\":true") || line.contains("\"isCompactSummary\":true") || line.contains("\"tool_result\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v.get("type").and_then(Value::as_str) != Some("user") {
            continue;
        }
        let Some(p) = v.pointer("/message/content").and_then(prompt_text) else { continue };
        s.prompts += 1;
        if s.first_prompt.is_none() {
            s.first_prompt = Some(clip(&p, 280));
        }
        s.last_prompt = Some(clip(&p, 280));
    }
    if s.prompts == 0 {
        return None;
    }
    if let Some(t) = last_ts {
        s.updated = t;
    }
    s.title = custom.or(ai).or_else(|| s.first_prompt.as_ref().map(|p| clip(p.lines().next().unwrap_or(p), 90)));
    Some(s)
}

fn codex_names() -> HashMap<String, String> {
    let mut m = HashMap::new();
    let Ok(h) = home() else { return m };
    let Ok(f) = std::fs::File::open(h.join(".codex/session_index.jsonl")) else { return m };
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let (Some(id), Some(n)) = (v.get("id").and_then(Value::as_str), v.get("thread_name").and_then(Value::as_str)) {
            m.insert(id.to_string(), n.to_string());
        }
    }
    m
}

fn codex_text(p: &Value) -> Option<String> {
    let a = p.get("content")?.as_array()?;
    let t = a.iter().filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n");
    let t = t.trim();
    if t.is_empty() || t.starts_with('<') || t.starts_with("# AGENTS.md") {
        return None;
    }
    Some(t.to_string())
}

fn scan_codex(path: &Path, len: u64, mtime: u64, names: &HashMap<String, String>) -> Option<Session> {
    let f = std::fs::File::open(path).ok()?;
    let mut s: Option<Session> = None;
    let mut last_ts = None::<String>;
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(t) = v.get("timestamp").and_then(Value::as_str) {
            last_ts = Some(t.to_string());
        }
        let ty = v.get("type").and_then(Value::as_str).unwrap_or("");
        let p = v.get("payload").cloned().unwrap_or(Value::Null);
        if ty == "session_meta" && s.is_none() {
            if p.get("source").map(|x| x.get("subagent").is_some()).unwrap_or(false) {
                return None;
            }
            let id = p.get("id").and_then(Value::as_str)?.to_string();
            s = Some(Session {
                title: names.get(&id).cloned(),
                id,
                tool: "codex",
                cwd: p.get("cwd").and_then(Value::as_str).map(str::to_string),
                project: None,
                repo: p.pointer("/git/repository_url").and_then(Value::as_str).and_then(|u| parse_remote(u).0),
                branch: p.pointer("/git/branch").and_then(Value::as_str).map(str::to_string),
                first_prompt: None,
                last_prompt: None,
                started: p.get("timestamp").and_then(Value::as_str).map(str::to_string),
                updated: iso_of(mtime),
                prompts: 0,
                prs: vec![],
                cost: None,
                lines_added: None,
                lines_removed: None,
                bytes: len,
            });
            continue;
        }
        let Some(cur) = s.as_mut() else { continue };
        if ty == "response_item" && p.get("type").and_then(Value::as_str) == Some("message") && p.get("role").and_then(Value::as_str) == Some("user") {
            if let Some(t) = codex_text(&p) {
                cur.prompts += 1;
                if cur.first_prompt.is_none() {
                    cur.first_prompt = Some(clip(&t, 280));
                }
                cur.last_prompt = Some(clip(&t, 280));
            }
        }
    }
    let mut s = s?;
    if s.prompts == 0 {
        return None;
    }
    if let Some(t) = last_ts {
        s.updated = t;
    }
    if s.title.is_none() {
        s.title = s.first_prompt.as_ref().map(|p| clip(p.lines().next().unwrap_or(p), 90));
    }
    Some(s)
}

fn files() -> Vec<(PathBuf, &'static str)> {
    let mut out = vec![];
    let Ok(h) = home() else { return out };
    if let Ok(rd) = std::fs::read_dir(h.join(".claude/projects")) {
        for d in rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()) {
            if let Ok(fs) = std::fs::read_dir(&d) {
                for f in fs.filter_map(|e| e.ok()).map(|e| e.path()) {
                    if f.extension().is_some_and(|x| x == "jsonl") {
                        out.push((f, "claude"));
                    }
                }
            }
        }
    }
    fn walk(dir: &Path, depth: u32, out: &mut Vec<(PathBuf, &'static str)>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for p in rd.filter_map(|e| e.ok()).map(|e| e.path()) {
            if p.is_dir() && depth > 0 {
                walk(&p, depth - 1, out);
            } else if p.extension().is_some_and(|x| x == "jsonl") {
                out.push((p, "codex"));
            }
        }
    }
    walk(&h.join(".codex/sessions"), 4, &mut out);
    out
}

fn repo_of(cwd: &str) -> Option<String> {
    let mut g = REPOS.lock().ok()?;
    let m = g.get_or_insert_with(HashMap::new);
    if let Some(r) = m.get(cwd) {
        return r.clone();
    }
    let p = Path::new(cwd);
    let r = if p.is_dir() { git(p, &["config", "--get", "remote.origin.url"]).and_then(|u| parse_remote(&u).0) } else { None };
    m.insert(cwd.to_string(), r.clone());
    r
}

fn index() -> R<Vec<Session>> {
    let list = files();
    let mut todo = vec![];
    let mut fresh: HashMap<String, Entry> = HashMap::new();
    {
        let mut g = CACHE.lock().map_err(|_| "índice ocupado".to_string())?;
        let old = g.get_or_insert_with(HashMap::new);
        for (path, tool) in list {
            let Ok(md) = std::fs::metadata(&path) else { continue };
            let len = md.len();
            let mtime = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            let key = path.to_string_lossy().to_string();
            match old.remove(&key) {
                Some(e) if e.len == len && e.mtime == mtime => {
                    fresh.insert(key, e);
                }
                _ => todo.push((path, tool, len, mtime)),
            }
        }
    }
    let names = if todo.iter().any(|t| t.1 == "codex") { codex_names() } else { HashMap::new() };
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
    let chunk = todo.len().div_ceil(workers).max(1);
    let scanned: Vec<(String, Entry)> = std::thread::scope(|sc| {
        let hs: Vec<_> = todo
            .chunks(chunk)
            .map(|part| {
                let names = &names;
                sc.spawn(move || {
                    part.iter()
                        .map(|(path, tool, len, mtime)| {
                            let session = if *tool == "claude" { scan_claude(path, *len, *mtime) } else { scan_codex(path, *len, *mtime, names) };
                            (path.to_string_lossy().to_string(), Entry { len: *len, mtime: *mtime, path: path.clone(), session })
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    fresh.extend(scanned);
    let mut out: Vec<Session> = fresh.values().filter_map(|e| e.session.clone()).collect();
    *CACHE.lock().map_err(|_| "índice ocupado".to_string())? = Some(fresh);
    for s in out.iter_mut() {
        if let Some(c) = s.cwd.clone() {
            s.project = Path::new(&c).file_name().map(|n| n.to_string_lossy().to_string());
            if s.repo.is_none() {
                s.repo = repo_of(&c);
            }
        }
        if s.repo.is_none() {
            s.repo = s.prs.first().map(|p| p.repo.clone());
        }
    }
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

fn path_of(tool: &str, id: &str) -> R<PathBuf> {
    let find = || -> Option<PathBuf> {
        let g = CACHE.lock().ok()?;
        g.as_ref()?.values().find(|e| e.session.as_ref().is_some_and(|s| s.id == id && s.tool == tool)).map(|e| e.path.clone())
    };
    if let Some(p) = find() {
        return Ok(p);
    }
    index()?;
    find().ok_or_else(|| "sessão não encontrada".to_string())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    role: &'static str,
    text: String,
    at: Option<String>,
    tools: Vec<String>,
}

fn tool_label(name: &str, input: &Value) -> String {
    let g = |k: &str| input.get(k).and_then(Value::as_str);
    let file = g("file_path").or_else(|| g("path")).or_else(|| g("notebook_path")).map(|p| Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string()));
    let detail = match name {
        "Bash" => g("description").map(str::to_string).or_else(|| g("command").map(|c| clip(c, 80))),
        "Grep" | "Glob" => g("pattern").map(|p| clip(p, 60)),
        "WebFetch" => g("url").map(|u| clip(u, 70)),
        "WebSearch" => g("query").map(|q| clip(q, 70)),
        "Agent" | "Task" => g("description").map(str::to_string),
        _ => file,
    };
    let short = name.rsplit("__").next().unwrap_or(name);
    match detail {
        Some(d) if !d.is_empty() => format!("{short} · {d}"),
        _ => short.to_string(),
    }
}

fn push(turns: &mut Vec<Turn>, role: &'static str, text: String, at: Option<String>, tool: Option<String>) {
    if let Some(t) = tool {
        if let Some(last) = turns.last_mut().filter(|l| l.role == "tools") {
            last.tools.push(t);
            return;
        }
        turns.push(Turn { role: "tools", text: String::new(), at, tools: vec![t] });
        return;
    }
    let text = clip(&text, 12000);
    if text.is_empty() {
        return;
    }
    if role == "assistant" {
        if let Some(last) = turns.last_mut().filter(|l| l.role == "assistant") {
            last.text.push_str("\n\n");
            last.text.push_str(&text);
            return;
        }
    }
    turns.push(Turn { role, text, at, tools: vec![] });
}

fn read_claude(path: &Path) -> R<Vec<Turn>> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut turns = vec![];
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        if line.starts_with("{\"type\":\"") || line.contains("\"isSidechain\":true") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let ty = v.get("type").and_then(Value::as_str).unwrap_or("");
        let at = v.get("timestamp").and_then(Value::as_str).map(str::to_string);
        if ty == "user" {
            if v.get("isMeta").and_then(Value::as_bool) == Some(true) || v.get("isCompactSummary").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            if let Some(p) = v.pointer("/message/content").and_then(prompt_text) {
                push(&mut turns, "user", p, at, None);
            }
        } else if ty == "assistant" {
            let Some(blocks) = v.pointer("/message/content").and_then(Value::as_array) else { continue };
            for b in blocks {
                match b.get("type").and_then(Value::as_str) {
                    Some("text") => push(&mut turns, "assistant", b.get("text").and_then(Value::as_str).unwrap_or("").to_string(), at.clone(), None),
                    Some("tool_use") => {
                        let name = b.get("name").and_then(Value::as_str).unwrap_or("ferramenta");
                        push(&mut turns, "tools", String::new(), at.clone(), Some(tool_label(name, b.get("input").unwrap_or(&Value::Null))));
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(turns)
}

fn read_codex(path: &Path) -> R<Vec<Turn>> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut turns = vec![];
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("type").and_then(Value::as_str) != Some("response_item") {
            continue;
        }
        let at = v.get("timestamp").and_then(Value::as_str).map(str::to_string);
        let Some(p) = v.get("payload") else { continue };
        match p.get("type").and_then(Value::as_str) {
            Some("message") => {
                let role = match p.get("role").and_then(Value::as_str) {
                    Some("user") => "user",
                    Some("assistant") => "assistant",
                    _ => continue,
                };
                if let Some(t) = codex_text(p) {
                    push(&mut turns, role, t, at, None);
                }
            }
            Some("function_call") | Some("custom_tool_call") | Some("local_shell_call") => {
                let name = p.get("name").and_then(Value::as_str).unwrap_or("shell");
                let input = p.get("arguments").and_then(Value::as_str).and_then(|a| serde_json::from_str::<Value>(a).ok()).unwrap_or(Value::Null);
                push(&mut turns, "tools", String::new(), at, Some(tool_label(name, &input)));
            }
            _ => {}
        }
    }
    Ok(turns)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sessions_list() -> R<Vec<Session>> {
    blocking(index).await
}

#[tauri::command]
pub async fn sessions_read(tool: String, id: String) -> R<Vec<Turn>> {
    if !valid_id(&id) {
        return Err("sessão inválida".into());
    }
    blocking(move || {
        let path = path_of(&tool, &id)?;
        let mut turns = if tool == "codex" { read_codex(&path)? } else { read_claude(&path)? };
        if turns.len() > 600 {
            turns.drain(..turns.len() - 600);
        }
        Ok(turns)
    })
    .await
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn as_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

#[tauri::command]
pub async fn sessions_resume(tool: String, id: String, cwd: String) -> R<()> {
    if !valid_id(&id) {
        return Err("sessão inválida".into());
    }
    let bin = match tool.as_str() {
        "claude" => "claude --resume",
        "codex" => "codex resume",
        _ => return Err("ferramenta desconhecida".into()),
    };
    blocking(move || {
        let dir = safe_dir(&cwd)?;
        let cmd = format!("cd {} && {} {}", sh_quote(&dir.to_string_lossy()), bin, id);
        let script = format!("tell application \"Terminal\"\nactivate\ndo script {}\nend tell", as_quote(&cmd));
        let out = Command::new("/usr/bin/osascript").arg("-e").arg(script).output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_reads_top_level_strings() {
        let l = r#"{"cwd":"/Users/x/a b","gitBranch":"feat/x","message":{"content":"say \"gitBranch\":\"no\""}}"#;
        assert_eq!(field(l, "cwd"), Some("/Users/x/a b"));
        assert_eq!(field(l, "gitBranch"), Some("feat/x"));
    }

    #[test]
    fn prompt_text_skips_tool_results_and_reads_commands() {
        assert_eq!(prompt_text(&serde_json::json!([{"type":"tool_result","content":"x"}])), None);
        assert_eq!(prompt_text(&serde_json::json!("<command-name>/review</command-name><command-args>12</command-args>")), Some("/review 12".into()));
        assert_eq!(prompt_text(&serde_json::json!("  oi  ")), Some("oi".into()));
    }

    #[test]
    fn ids_are_strict() {
        assert!(valid_id("1db762c9-b33b-4fdb-bdb7-c33dc45ed959"));
        assert!(!valid_id("1; rm -rf ~"));
        assert!(!valid_id(""));
    }

    #[test]
    fn quoting_is_safe() {
        assert_eq!(sh_quote("a'b"), "'a'\\''b'");
        assert_eq!(as_quote("x \"y\" \\"), "\"x \\\"y\\\" \\\\\"");
    }

    #[test]
    fn iso_from_epoch() {
        assert_eq!(iso_of(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_of(1_700_000_000), "2023-11-14T22:13:20.000Z");
    }
}
