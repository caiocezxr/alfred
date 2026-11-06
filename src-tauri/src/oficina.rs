use crate::commands::{AppState, R};
use crate::github::{home, safe_dir};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const AGENTS: &[(&str, &str)] = &[("claude", "claude-agent-acp"), ("codex", "codex-acp")];
const SECRET_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_SIMPLE",
];

struct Conn {
    child: Child,
    stdin: ChildStdin,
    next: u64,
    waiting: HashMap<u64, Sender<Value>>,
    session: Option<String>,
}

type Shared = Arc<Mutex<Conn>>;

static CONNS: Mutex<Option<HashMap<String, Shared>>> = Mutex::new(None);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Out {
    mesa: String,
    agent: String,
    kind: &'static str,
    data: Value,
}

fn key(mesa: &str, agent: &str) -> String {
    format!("{mesa}:{agent}")
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn conns<T>(f: impl FnOnce(&mut HashMap<String, Shared>) -> T) -> T {
    let mut g = CONNS.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

fn emit(app: &AppHandle, mesa: &str, agent: &str, kind: &'static str, data: Value) {
    let _ = app.emit("oficina", Out { mesa: mesa.into(), agent: agent.into(), kind, data });
}

fn adapter(state: &State<AppState>, agent: &str) -> R<PathBuf> {
    let bin = AGENTS.iter().find(|(a, _)| *a == agent).map(|(_, b)| *b).ok_or("agente desconhecido")?;
    let p = state.data_dir.join("oficina/node_modules/.bin").join(bin);
    if p.exists() { Ok(p) } else { Err(format!("o adaptador do {agent} não está instalado")) }
}

fn path_env() -> String {
    let h = home().map(|h| h.to_string_lossy().to_string()).unwrap_or_default();
    let mut parts = vec![format!("{h}/.local/bin"), "/opt/homebrew/bin".into(), "/usr/local/bin".into()];
    if let Ok(rd) = std::fs::read_dir(format!("{h}/.nvm/versions/node")) {
        let mut v: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path().join("bin")).collect();
        v.sort();
        if let Some(last) = v.pop() {
            parts.insert(0, last.to_string_lossy().to_string());
        }
    }
    parts.extend(["/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(String::from));
    parts.join(":")
}

pub(crate) fn auth_refused(status: &Value) -> Option<String> {
    let kind = status.pointer("/authStatus/kind").and_then(Value::as_str)?;
    let lower = kind.to_ascii_lowercase();
    (lower.contains("api") || lower.contains("key")).then(|| "o agente tentou entrar com chave de API; a Oficina só roda pela assinatura".to_string())
}

fn write(conn: &mut Conn, v: &Value) -> R<()> {
    let line = v.to_string();
    conn.stdin.write_all(line.as_bytes()).and_then(|_| conn.stdin.write_all(b"\n")).and_then(|_| conn.stdin.flush()).map_err(|e| format!("o agente fechou: {e}"))
}

fn request(conn: &Shared, method: &str, params: Value) -> R<u64> {
    let mut c = conn.lock().map_err(|_| "agente ocupado")?;
    c.next += 1;
    let id = c.next;
    write(&mut c, &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
    Ok(id)
}

fn call(conn: &Shared, method: &str, params: Value, wait: Duration) -> R<Value> {
    let (tx, rx) = channel();
    let id = {
        let mut c = conn.lock().map_err(|_| "agente ocupado")?;
        c.next += 1;
        let id = c.next;
        c.waiting.insert(id, tx);
        write(&mut c, &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        id
    };
    let msg = rx.recv_timeout(wait).map_err(|_| {
        if let Ok(mut c) = conn.lock() {
            c.waiting.remove(&id);
        }
        format!("o agente não respondeu a {method}")
    })?;
    if let Some(e) = msg.get("error") {
        return Err(e.get("message").and_then(Value::as_str).unwrap_or("erro do agente").to_string());
    }
    Ok(msg.get("result").cloned().unwrap_or(Value::Null))
}

fn stop(k: &str) {
    if let Some(c) = conns(|m| m.remove(k)) {
        if let Ok(mut c) = c.lock() {
            let _ = c.child.kill();
            let _ = c.child.wait();
        }
    }
}

fn spawn(app: &AppHandle, state: &State<AppState>, mesa: &str, agent: &str, cwd: &PathBuf, codex_home: Option<String>) -> R<Shared> {
    let bin = adapter(state, agent)?;
    let mut cmd = Command::new(bin);
    cmd.current_dir(cwd).env("PATH", path_env()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for k in SECRET_ENV {
        cmd.env_remove(k);
    }
    if let Some(h) = codex_home {
        cmd.env("CODEX_HOME", h);
    }
    if agent == "claude" {
        if let Ok(h) = home() {
            let own = h.join(".local/bin/claude");
            if own.exists() {
                cmd.env("CLAUDE_CODE_EXECUTABLE", own);
            }
        }
    }
    let mut child = cmd.spawn().map_err(|e| format!("não deu para abrir o agente: {e}"))?;
    let stdout = child.stdout.take().ok_or("sem saída")?;
    let stderr = child.stderr.take().ok_or("sem saída de erro")?;
    let stdin = child.stdin.take().ok_or("sem entrada")?;
    let conn: Shared = Arc::new(Mutex::new(Conn { child, stdin, next: 0, waiting: HashMap::new(), session: None }));
    let k = key(mesa, agent);
    conns(|m| m.insert(k.clone(), conn.clone()));

    let tail = Arc::new(Mutex::new(Vec::<String>::new()));
    {
        let tail = tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut t) = tail.lock() {
                    t.push(line);
                    let n = t.len();
                    if n > 30 {
                        t.drain(..n - 30);
                    }
                }
            }
        });
    }
    {
        let app = app.clone();
        let (mesa, agent, conn) = (mesa.to_string(), agent.to_string(), conn.clone());
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                let has_id = v.get("id").is_some();
                let method = v.get("method").and_then(Value::as_str).map(str::to_string);
                match (has_id, method) {
                    (true, None) => {
                        let id = v.get("id").and_then(Value::as_u64).unwrap_or(0);
                        let waiter = conn.lock().ok().and_then(|mut c| c.waiting.remove(&id));
                        match waiter {
                            Some(tx) => {
                                let _ = tx.send(v);
                            }
                            None => emit(&app, &mesa, &agent, "response", v),
                        }
                    }
                    (true, Some(_)) => emit(&app, &mesa, &agent, "request", v),
                    (false, Some(m)) => {
                        if m == "_auth/status_update" {
                            if let Some(why) = v.get("params").and_then(auth_refused) {
                                emit(&app, &mesa, &agent, "error", json!({ "message": why }));
                                stop(&key(&mesa, &agent));
                                return;
                            }
                        }
                        emit(&app, &mesa, &agent, "notify", v)
                    }
                    _ => {}
                }
            }
            let k = key(&mesa, &agent);
            let mine = conns(|m| m.get(&k).map(|c| Arc::ptr_eq(c, &conn)).unwrap_or(false));
            if mine {
                conns(|m| m.remove(&k));
            }
            let code = conn.lock().ok().and_then(|mut c| c.child.try_wait().ok().flatten()).and_then(|s| s.code());
            let lines = tail.lock().map(|t| t.iter().filter(|l| !l.starts_with('[')).cloned().collect::<Vec<_>>().join("\n")).unwrap_or_default();
            emit(&app, &mesa, &agent, "exit", json!({ "code": code, "stderr": lines }));
        });
    }
    Ok(conn)
}

#[tauri::command]
pub(crate) fn session_params(agent: &str, cwd: &str, dirs: &[String], persona: Option<&str>, resume: Option<&str>) -> Value {
    let mut p = json!({ "cwd": cwd, "mcpServers": [] });
    if !dirs.is_empty() {
        p["additionalDirectories"] = json!(dirs);
    }
    if let Some(id) = resume {
        p["sessionId"] = json!(id);
    }
    if let Some(text) = persona.filter(|t| !t.trim().is_empty()) {
        if agent == "claude" {
            p["_meta"] = json!({ "systemPrompt": { "append": text } });
        } else {
            p["systemPrompt"] = json!({ "mode": "append", "content": [{ "type": "text", "text": text }] });
        }
    }
    p
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn oficina_start(app: AppHandle, state: State<'_, AppState>, mesa: String, agent: String, cwd: String, dirs: Option<Vec<String>>, persona: Option<String>, resume: Option<String>, codex_home: Option<String>) -> R<Value> {
    if !valid_id(&mesa) || !valid_id(&agent) {
        return Err("mesa ou agente inválido".into());
    }
    if let Some(r) = &resume {
        if !valid_id(r) {
            return Err("sessão inválida".into());
        }
    }
    let dir = safe_dir(&cwd)?;
    let mut extra = vec![];
    for d in dirs.unwrap_or_default().iter().take(12) {
        let p = safe_dir(d)?;
        if p != dir && !extra.contains(&p) {
            extra.push(p);
        }
    }
    let extra: Vec<String> = extra.iter().map(|p| p.to_string_lossy().to_string()).collect();
    if persona.as_ref().is_some_and(|p| p.len() > 8000) {
        return Err("instrução grande demais".into());
    }
    let codex_home = match codex_home {
        Some(h) => Some(safe_dir(&h)?.to_string_lossy().to_string()),
        None => None,
    };
    let k = key(&mesa, &agent);
    stop(&k);
    let conn = spawn(&app, &state, &mesa, &agent, &dir, codex_home)?;
    let cwd_s = dir.to_string_lossy().to_string();
    let agent = agent.clone();
    tauri::async_runtime::spawn_blocking(move || -> R<Value> {
        let init = call(&conn, "initialize", json!({ "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false } }), Duration::from_secs(40))?;
        let params = session_params(&agent, &cwd_s, &extra, persona.as_deref(), resume.as_deref());
        let opened = match &resume {
            Some(id) => {
                let r = call(&conn, "session/resume", params, Duration::from_secs(90))?;
                let mut r = if r.is_object() { r } else { json!({}) };
                r["sessionId"] = json!(id);
                r
            }
            None => call(&conn, "session/new", params, Duration::from_secs(90))?,
        };
        let sid = opened.get("sessionId").and_then(Value::as_str).ok_or("o agente não abriu a sessão")?.to_string();
        if let Ok(mut c) = conn.lock() {
            c.session = Some(sid);
        }
        Ok(json!({ "agent": init.get("agentInfo"), "session": opened }))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn session_of(k: &str) -> R<(Shared, String)> {
    let conn = conns(|m| m.get(k).cloned()).ok_or("o agente não está aberto nesta mesa")?;
    let sid = conn.lock().map_err(|_| "agente ocupado")?.session.clone().ok_or("sessão ainda abrindo")?;
    Ok((conn, sid))
}

pub(crate) fn prompt_blocks(text: &str, images: &[(String, String)]) -> R<Value> {
    if text.trim().is_empty() && images.is_empty() {
        return Err("mensagem vazia".into());
    }
    let mut blocks = vec![];
    for (mime, data) in images.iter().take(6) {
        if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp") {
            return Err("formato de imagem não suportado".into());
        }
        if data.len() > 12_000_000 {
            return Err("imagem grande demais".into());
        }
        blocks.push(json!({ "type": "image", "mimeType": mime, "data": data }));
    }
    if !text.trim().is_empty() {
        blocks.push(json!({ "type": "text", "text": text }));
    }
    Ok(Value::Array(blocks))
}

#[derive(serde::Deserialize)]
pub struct Image {
    mime: String,
    data: String,
}

#[tauri::command]
pub fn oficina_prompt(mesa: String, agent: String, text: String, images: Option<Vec<Image>>) -> R<u64> {
    let imgs: Vec<(String, String)> = images.unwrap_or_default().into_iter().map(|i| (i.mime, i.data)).collect();
    let blocks = prompt_blocks(&text, &imgs)?;
    let (conn, sid) = session_of(&key(&mesa, &agent))?;
    request(&conn, "session/prompt", json!({ "sessionId": sid, "prompt": blocks }))
}

#[tauri::command]
pub fn oficina_cancel(mesa: String, agent: String) -> R<()> {
    let (conn, sid) = session_of(&key(&mesa, &agent))?;
    let mut c = conn.lock().map_err(|_| "agente ocupado")?;
    write(&mut c, &json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": sid } }))
}

#[tauri::command]
pub async fn oficina_config(mesa: String, agent: String, option: String, value: String) -> R<Value> {
    if !valid_id(&option) || value.len() > 80 {
        return Err("opção inválida".into());
    }
    let (conn, sid) = session_of(&key(&mesa, &agent))?;
    tauri::async_runtime::spawn_blocking(move || {
        call(&conn, "session/set_config_option", json!({ "sessionId": sid, "configId": option, "value": value }), Duration::from_secs(20))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn oficina_reply(mesa: String, agent: String, id: Value, result: Value) -> R<()> {
    let conn = conns(|m| m.get(&key(&mesa, &agent)).cloned()).ok_or("o agente não está aberto")?;
    let mut c = conn.lock().map_err(|_| "agente ocupado")?;
    write(&mut c, &json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

#[tauri::command]
pub fn oficina_close(mesa: String, agent: String) -> R<()> {
    stop(&key(&mesa, &agent));
    Ok(())
}

#[tauri::command]
pub fn oficina_status(state: State<AppState>) -> Value {
    json!({
        "claude": adapter(&state, "claude").is_ok(),
        "codex": adapter(&state, "codex").is_ok(),
        "open": conns(|m| m.keys().cloned().collect::<Vec<_>>()),
    })
}

const OLLAMA: &str = "http://127.0.0.1:11434";

static STOPS: Mutex<Option<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>> = Mutex::new(None);

fn ollama() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(600))).http_status_as_error(false).build().into()
}

fn post_json(a: &ureq::Agent, path: &str, body: &Value) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    a.post(&format!("{OLLAMA}{path}")).header("Content-Type", "application/json").send(body.to_string().as_bytes())
}

fn read_value(r: &mut ureq::http::Response<ureq::Body>) -> Option<Value> {
    r.body_mut().with_config().limit(8_000_000).read_to_string().ok().and_then(|t| serde_json::from_str(&t).ok())
}

fn context_of(show: &Value) -> Option<u64> {
    show.get("model_info")?.as_object()?.iter().find(|(k, _)| k.ends_with(".context_length")).and_then(|(_, v)| v.as_u64())
}

#[tauri::command]
pub async fn oficina_local_models() -> R<Vec<Value>> {
    tauri::async_runtime::spawn_blocking(|| -> R<Vec<Value>> {
        let a = ollama();
        let mut r = a.get(&format!("{OLLAMA}/api/tags")).call().map_err(|_| "o Ollama não está rodando".to_string())?;
        let tags = read_value(&mut r).ok_or_else(|| "resposta inválida do Ollama".to_string())?;
        let mut out = vec![];
        for m in tags.get("models").and_then(Value::as_array).cloned().unwrap_or_default().iter().take(16) {
            let name = m.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            if name.is_empty() || name.contains("embed") {
                continue;
            }
            let show = post_json(&a, "/api/show", &json!({ "model": name })).ok().and_then(|mut r| read_value(&mut r)).unwrap_or(Value::Null);
            out.push(json!({
                "name": name,
                "size": m.get("size"),
                "params": m.pointer("/details/parameter_size"),
                "context": context_of(&show),
            }));
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
pub struct Msg {
    role: String,
    content: String,
}

#[tauri::command]
pub fn oficina_local_chat(app: AppHandle, mesa: String, model: String, messages: Vec<Msg>, persona: Option<String>, context: Option<u64>) -> R<()> {
    if !valid_id(&mesa) || model.is_empty() || model.len() > 120 || model.contains(char::is_whitespace) {
        return Err("modelo inválido".into());
    }
    let mut msgs = vec![];
    if let Some(p) = persona.filter(|p| !p.trim().is_empty()) {
        msgs.push(json!({ "role": "system", "content": p }));
    }
    for m in messages.iter().rev().take(40).collect::<Vec<_>>().into_iter().rev() {
        let role = if m.role == "assistant" { "assistant" } else { "user" };
        msgs.push(json!({ "role": role, "content": m.content }));
    }
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut g = STOPS.lock().unwrap_or_else(|e| e.into_inner());
        g.get_or_insert_with(HashMap::new).insert(mesa.clone(), stop.clone());
    }
    std::thread::spawn(move || {
        let note = |kind: &'static str, data: Value| emit(&app, &mesa, "local", kind, data);
        let update = |u: Value| note("notify", json!({ "method": "session/update", "params": { "update": u } }));
        let mut opts = json!({});
        if let Some(c) = context {
            opts["num_ctx"] = json!(c.min(32768));
        }
        let res = post_json(&ollama(), "/api/chat", &json!({ "model": model, "messages": msgs, "stream": true, "options": opts }));
        let mut resp = match res {
            Ok(r) if r.status().as_u16() == 200 => r,
            Ok(r) => {
                let code = r.status().as_u16();
                return note("response", json!({ "error": { "message": if code == 404 { format!("o modelo {model} não está baixado no Ollama") } else { format!("o Ollama respondeu {code}") } } }));
            }
            Err(_) => return note("response", json!({ "error": { "message": "o Ollama não está rodando" } })),
        };
        let reader = BufReader::new(resp.body_mut().as_reader());
        for line in reader.lines().map_while(Result::ok) {
            if stop.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if let Some(t) = v.pointer("/message/content").and_then(Value::as_str) {
                if !t.is_empty() {
                    update(json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": t } }));
                }
            }
            if v.get("done").and_then(Value::as_bool) == Some(true) {
                let used = v.get("prompt_eval_count").and_then(Value::as_u64).unwrap_or(0) + v.get("eval_count").and_then(Value::as_u64).unwrap_or(0);
                if let Some(c) = context {
                    update(json!({ "sessionUpdate": "usage_update", "used": used, "size": c.min(32768) }));
                }
                break;
            }
        }
        note("response", json!({ "result": { "stopReason": "end_turn" } }));
    });
    Ok(())
}

#[tauri::command]
pub fn oficina_local_cancel(mesa: String) {
    if let Some(f) = STOPS.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(&mesa).cloned())) {
        f.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_api_key_auth() {
        assert!(auth_refused(&json!({"authStatus": {"kind": "account"}})).is_none());
        assert!(auth_refused(&json!({"authStatus": {"kind": "none"}})).is_none());
        assert!(auth_refused(&json!({"authStatus": {"kind": "api-key"}})).is_some());
        assert!(auth_refused(&json!({})).is_none());
    }

    #[test]
    fn persona_goes_where_each_agent_reads_it() {
        let c = session_params("claude", "/x", &[], Some("fala direto"), None);
        assert_eq!(c["_meta"]["systemPrompt"]["append"], "fala direto");
        assert!(c.get("systemPrompt").is_none());
        let x = session_params("codex", "/x", &["/y".into()], Some("fala direto"), Some("s1"));
        assert_eq!(x["systemPrompt"]["mode"], "append");
        assert_eq!(x["systemPrompt"]["content"][0]["text"], "fala direto");
        assert_eq!(x["additionalDirectories"][0], "/y");
        assert_eq!(x["sessionId"], "s1");
        assert!(session_params("codex", "/x", &[], None, None).get("systemPrompt").is_none());
    }

    #[test]
    fn prompt_blocks_validate() {
        assert!(prompt_blocks("  ", &[]).is_err());
        let b = prompt_blocks("oi", &[("image/png".into(), "AAAA".into())]).unwrap();
        assert_eq!(b[0]["type"], "image");
        assert_eq!(b[1]["text"], "oi");
        assert!(prompt_blocks("oi", &[("application/pdf".into(), "AAAA".into())]).is_err());
    }

    #[test]
    fn reads_context_length() {
        assert_eq!(context_of(&json!({"model_info": {"gemma3.context_length": 131072, "x": 1}})), Some(131072));
        assert_eq!(context_of(&json!({})), None);
    }

    #[test]
    fn ids_are_strict() {
        assert!(valid_id("mesa-1"));
        assert!(valid_id("01a1b2db-48ff-7270-914e-b835440aafbc"));
        assert!(!valid_id("a b"));
        assert!(!valid_id("../x"));
    }
}
