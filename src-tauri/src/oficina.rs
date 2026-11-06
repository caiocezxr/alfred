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
pub async fn oficina_start(app: AppHandle, state: State<'_, AppState>, mesa: String, agent: String, cwd: String, resume: Option<String>, codex_home: Option<String>) -> R<Value> {
    if !valid_id(&mesa) || !valid_id(&agent) {
        return Err("mesa ou agente inválido".into());
    }
    if let Some(r) = &resume {
        if !valid_id(r) {
            return Err("sessão inválida".into());
        }
    }
    let dir = safe_dir(&cwd)?;
    let codex_home = match codex_home {
        Some(h) => Some(safe_dir(&h)?.to_string_lossy().to_string()),
        None => None,
    };
    let k = key(&mesa, &agent);
    stop(&k);
    let conn = spawn(&app, &state, &mesa, &agent, &dir, codex_home)?;
    let cwd_s = dir.to_string_lossy().to_string();
    tauri::async_runtime::spawn_blocking(move || -> R<Value> {
        let init = call(&conn, "initialize", json!({ "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false } }), Duration::from_secs(40))?;
        let opened = match &resume {
            Some(id) => {
                let r = call(&conn, "session/resume", json!({ "sessionId": id, "cwd": cwd_s, "mcpServers": [] }), Duration::from_secs(90))?;
                let mut r = if r.is_object() { r } else { json!({}) };
                r["sessionId"] = json!(id);
                r
            }
            None => call(&conn, "session/new", json!({ "cwd": cwd_s, "mcpServers": [] }), Duration::from_secs(90))?,
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

#[tauri::command]
pub fn oficina_prompt(mesa: String, agent: String, text: String) -> R<u64> {
    if text.trim().is_empty() {
        return Err("mensagem vazia".into());
    }
    let (conn, sid) = session_of(&key(&mesa, &agent))?;
    request(&conn, "session/prompt", json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": text }] }))
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
    fn ids_are_strict() {
        assert!(valid_id("mesa-1"));
        assert!(valid_id("01a1b2db-48ff-7270-914e-b835440aafbc"));
        assert!(!valid_id("a b"));
        assert!(!valid_id("../x"));
    }
}
