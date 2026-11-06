use crate::commands::{AppState, R};
use crate::github::{home, safe_dir};
use serde::Serialize;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::State;

pub(crate) const ENGINE_PKGS: &[(&str, &str, &str)] = &[("claude", "@agentclientprotocol/claude-agent-acp", "claude-agent-acp"), ("codex", "@agentclientprotocol/codex-acp", "codex-acp")];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    id: String,
    name: String,
    description: String,
    source: &'static str,
    origin: String,
    path: String,
}

fn front(text: &str, key: &str) -> Option<String> {
    let body = text.strip_prefix("---")?;
    let end = body.find("\n---")?;
    for line in body[..end].lines() {
        if let Some(v) = line.strip_prefix(&format!("{key}:")) {
            let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

fn read_skill(dir: &Path, source: &'static str, prefix: Option<&str>, origin: &str) -> Option<Skill> {
    let text = std::fs::read_to_string(dir.join("SKILL.md")).ok()?;
    let folder = dir.file_name()?.to_string_lossy().to_string();
    let name = front(&text, "name").unwrap_or_else(|| folder.clone());
    let mut description = front(&text, "description").unwrap_or_default();
    if description.chars().count() > 220 {
        description = description.chars().take(220).collect::<String>() + "…";
    }
    let id = match prefix {
        Some(p) => format!("{p}:{name}"),
        None => name.clone(),
    };
    Some(Skill { id, name, description, source, origin: origin.to_string(), path: dir.to_string_lossy().to_string() })
}

fn subdirs(p: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(p).map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default();
    v.sort();
    v
}

fn latest(dir: &Path) -> Option<PathBuf> {
    let mut v = subdirs(dir);
    v.sort_by(|a, b| {
        let key = |p: &PathBuf| p.file_name().map(|n| n.to_string_lossy().split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>()).unwrap_or_default();
        key(a).cmp(&key(b))
    });
    v.pop()
}

pub(crate) fn library(state: &State<AppState>) -> PathBuf {
    state.data_dir.join("skills-plugin")
}

fn ensure_library(root: &Path) -> R<()> {
    std::fs::create_dir_all(root.join(".claude-plugin")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(root.join("skills")).map_err(|e| e.to_string())?;
    let manifest = root.join(".claude-plugin/plugin.json");
    if !manifest.exists() {
        std::fs::write(&manifest, json!({ "name": "alfred", "version": "1.0.0", "description": "Skills carregadas pela Sessão do Alfred" }).to_string()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn sessao_skills(state: State<AppState>) -> R<Vec<Skill>> {
    let h = home()?;
    let mut out = vec![];
    for d in subdirs(&h.join(".claude/skills")) {
        if let Some(s) = read_skill(&d, "user", None, "~/.claude/skills") {
            out.push(s);
        }
    }
    for market in subdirs(&h.join(".claude/plugins/cache")) {
        for plugin in subdirs(&market) {
            let Some(v) = latest(&plugin) else { continue };
            let pname = plugin.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            for d in subdirs(&v.join("skills")) {
                if let Some(s) = read_skill(&d, "plugin", Some(&pname), &pname) {
                    out.push(s);
                }
            }
        }
    }
    let lib = library(&state);
    for d in subdirs(&lib.join("skills")) {
        if let Some(s) = read_skill(&d, "alfred", Some("alfred"), "Alfred") {
            out.push(s);
        }
    }
    Ok(out)
}

fn safe_name(s: &str) -> String {
    let n: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c.to_ascii_lowercase() } else { '-' }).collect();
    n.trim_matches('-').chars().take(60).collect()
}

fn find_skills(root: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if out.len() > 50 {
        return;
    }
    if root.join("SKILL.md").is_file() {
        out.push(root.to_path_buf());
        return;
    }
    if depth == 0 {
        return;
    }
    for d in subdirs(root) {
        let n = d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if n.starts_with('.') || n == "node_modules" {
            continue;
        }
        find_skills(&d, depth - 1, out);
    }
}

fn copy_dir(from: &Path, to: &Path, budget: &mut u64) -> R<()> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for e in std::fs::read_dir(from).map_err(|e| e.to_string())?.filter_map(|e| e.ok()) {
        let p = e.path();
        let meta = std::fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        let dest = to.join(e.file_name());
        if meta.is_dir() {
            copy_dir(&p, &dest, budget)?;
        } else {
            *budget = budget.checked_sub(meta.len()).ok_or("a skill é grande demais (limite de 20 MB)")?;
            std::fs::copy(&p, &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn github_url(s: &str) -> Option<String> {
    let t = s.trim().trim_end_matches('/').trim_end_matches(".git");
    let rest = t.strip_prefix("https://github.com/")?;
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() < 2 || parts[..2].iter().any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')) {
        return None;
    }
    Some(format!("https://github.com/{}/{}.git", parts[0], parts[1]))
}

#[tauri::command]
pub async fn sessao_skill_import(state: State<'_, AppState>, source: String) -> R<Vec<String>> {
    let lib = library(&state);
    let tmp = state.data_dir.join("tmp").join(format!("skill-{}", uuid::Uuid::new_v4()));
    tauri::async_runtime::spawn_blocking(move || -> R<Vec<String>> {
        ensure_library(&lib)?;
        let root = if let Some(url) = github_url(&source) {
            std::fs::create_dir_all(tmp.parent().unwrap_or(&tmp)).map_err(|e| e.to_string())?;
            let git = ["/usr/bin/git", "/opt/homebrew/bin/git"].into_iter().find(|p| Path::new(p).exists()).ok_or("git não encontrado")?;
            let out = Command::new(git).args(["clone", "--depth", "1", "--quiet", &url]).arg(&tmp).env("GIT_TERMINAL_PROMPT", "0").output().map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Err(format!("não deu para baixar: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("")));
            }
            tmp.clone()
        } else {
            safe_dir(&source)?
        };
        let mut found = vec![];
        find_skills(&root, 4, &mut found);
        if found.is_empty() {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err("não achei nenhum SKILL.md ali".into());
        }
        let mut names = vec![];
        let mut budget: u64 = 20 * 1024 * 1024;
        for dir in found {
            let text = std::fs::read_to_string(dir.join("SKILL.md")).unwrap_or_default();
            let name = safe_name(&front(&text, "name").unwrap_or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
            if name.is_empty() {
                continue;
            }
            let dest = lib.join("skills").join(&name);
            let _ = std::fs::remove_dir_all(&dest);
            copy_dir(&dir, &dest, &mut budget)?;
            names.push(name);
        }
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(names)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn sessao_skill_remove(state: State<AppState>, name: String) -> R<()> {
    let n = safe_name(&name);
    if n.is_empty() || n != name {
        return Err("nome inválido".into());
    }
    let p = library(&state).join("skills").join(&n);
    if p.exists() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn node_path() -> String {
    let h = home().map(|h| h.to_string_lossy().to_string()).unwrap_or_default();
    let mut parts = vec![];
    if let Ok(rd) = std::fs::read_dir(format!("{h}/.nvm/versions/node")) {
        let mut v: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path().join("bin")).collect();
        v.sort();
        if let Some(last) = v.pop() {
            parts.push(last.to_string_lossy().to_string());
        }
    }
    parts.extend([format!("{h}/.local/bin"), "/opt/homebrew/bin".into(), "/usr/local/bin".into(), "/usr/bin".into(), "/bin".into()]);
    parts.join(":")
}

fn installed(dir: &Path, pkg: &str) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("node_modules").join(pkg).join("package.json")).ok()?;
    serde_json::from_str::<Value>(&text).ok()?.get("version").and_then(Value::as_str).map(str::to_string)
}

fn npm(dir: &Path, args: &[&str]) -> R<String> {
    let out = Command::new("npm").args(args).current_dir(dir).env("PATH", node_path()).output().map_err(|e| format!("npm não encontrado: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("npm falhou").to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn sessao_engines(state: State<'_, AppState>, check: bool) -> R<Value> {
    let dir = state.data_dir.join("oficina");
    let prev = state.data_dir.join("oficina-prev").exists();
    tauri::async_runtime::spawn_blocking(move || -> R<Value> {
        let mut list = vec![];
        for (id, pkg, _) in ENGINE_PKGS {
            let latest = if check { npm(&dir, &["view", pkg, "version"]).ok() } else { None };
            list.push(json!({ "id": id, "package": pkg, "installed": installed(&dir, pkg), "latest": latest }));
        }
        Ok(json!({ "engines": list, "canRollback": prev }))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn handshake(bin: &Path) -> R<String> {
    let mut child = Command::new(bin).env("PATH", node_path()).env_remove("ANTHROPIC_API_KEY").env_remove("OPENAI_API_KEY").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("sem entrada")?;
    let stdout = child.stdout.take().ok_or("sem saída")?;
    let msg = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false } } });
    writeln!(stdin, "{msg}").map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if v.get("id") == Some(&json!(1)) {
                    let _ = tx.send(v);
                    return;
                }
            }
        }
    });
    let res = rx.recv_timeout(Duration::from_secs(40));
    let _ = child.kill();
    let _ = child.wait();
    let v = res.map_err(|_| "o motor novo não respondeu ao teste".to_string())?;
    let version = v.pointer("/result/protocolVersion").and_then(Value::as_u64).ok_or("o motor novo respondeu fora do protocolo")?;
    if version != 1 {
        return Err(format!("o motor novo fala o protocolo {version}, a Sessão fala o 1"));
    }
    Ok(v.pointer("/result/agentInfo/version").and_then(Value::as_str).unwrap_or("?").to_string())
}

#[tauri::command]
pub async fn sessao_engines_update(state: State<'_, AppState>) -> R<Value> {
    crate::oficina::close_all();
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || -> R<Value> {
        let cur = data.join("oficina");
        let next = data.join("oficina-next");
        let prev = data.join("oficina-prev");
        let _ = std::fs::remove_dir_all(&next);
        std::fs::create_dir_all(&next).map_err(|e| e.to_string())?;
        std::fs::write(next.join("package.json"), json!({ "name": "alfred-oficina-agents", "private": true }).to_string()).map_err(|e| e.to_string())?;
        let started = Instant::now();
        let specs: Vec<String> = ENGINE_PKGS.iter().map(|(_, p, _)| format!("{p}@latest")).collect();
        let mut args = vec!["install", "--ignore-scripts", "--save-exact", "--no-audit", "--no-fund"];
        args.extend(specs.iter().map(String::as_str));
        if let Err(e) = npm(&next, &args) {
            let _ = std::fs::remove_dir_all(&next);
            return Err(format!("não deu para baixar a versão nova: {e}"));
        }
        let mut tested = vec![];
        for (id, pkg, bin) in ENGINE_PKGS {
            match handshake(&next.join("node_modules/.bin").join(bin)) {
                Ok(v) => tested.push(json!({ "id": id, "package": pkg, "version": v })),
                Err(e) => {
                    let _ = std::fs::remove_dir_all(&next);
                    return Err(format!("{id}: {e}. Mantive a versão atual."));
                }
            }
        }
        let _ = std::fs::remove_dir_all(&prev);
        std::fs::rename(&cur, &prev).map_err(|e| e.to_string())?;
        if let Err(e) = std::fs::rename(&next, &cur) {
            let _ = std::fs::rename(&prev, &cur);
            return Err(e.to_string());
        }
        Ok(json!({ "engines": tested, "seconds": started.elapsed().as_secs() }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn sessao_engines_rollback(state: State<AppState>) -> R<()> {
    crate::oficina::close_all();
    let cur = state.data_dir.join("oficina");
    let prev = state.data_dir.join("oficina-prev");
    let tmp = state.data_dir.join("oficina-swap");
    if !prev.exists() {
        return Err("não há versão anterior guardada".into());
    }
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::rename(&cur, &tmp).map_err(|e| e.to_string())?;
    std::fs::rename(&prev, &cur).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &prev).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn valid_account(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
pub fn sessao_codex_account(state: State<AppState>, id: String) -> R<String> {
    if !valid_account(&id) {
        return Err("conta inválida".into());
    }
    let h = home()?;
    let dir = state.data_dir.join("codex-accounts").join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let shared = h.join(".codex/sessions");
    std::fs::create_dir_all(&shared).map_err(|e| e.to_string())?;
    let link = dir.join("sessions");
    if !link.exists() {
        #[cfg(unix)]
        std::os::unix::fs::symlink(&shared, &link).map_err(|e| e.to_string())?;
    }
    let cfg = h.join(".codex/config.toml");
    if cfg.exists() && !dir.join("config.toml").exists() {
        let _ = std::fs::copy(&cfg, dir.join("config.toml"));
    }
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn sessao_codex_login(state: State<'_, AppState>, id: String) -> R<()> {
    if !valid_account(&id) {
        return Err("conta inválida".into());
    }
    let dir = state.data_dir.join("codex-accounts").join(&id);
    tauri::async_runtime::spawn_blocking(move || {
        if !dir.exists() {
            return Err("crie a conta antes de entrar".to_string());
        }
        let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        let cmd = format!("export PATH={}; CODEX_HOME={} codex login", q(&node_path()), q(&dir.to_string_lossy()));
        let script = format!("tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell", cmd.replace('\\', "\\\\").replace('"', "\\\""));
        let out = Command::new("/usr/bin/osascript").arg("-e").arg(script).output().map_err(|e| e.to_string())?;
        if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_frontmatter() {
        let t = "---\nname: maivado\ndescription: \"Fluxo amarrado\"\n---\n# x";
        assert_eq!(front(t, "name").as_deref(), Some("maivado"));
        assert_eq!(front(t, "description").as_deref(), Some("Fluxo amarrado"));
        assert_eq!(front("# sem frontmatter", "name"), None);
    }

    #[test]
    fn github_urls_are_strict() {
        assert_eq!(github_url("https://github.com/DietrichGebert/ponytail").as_deref(), Some("https://github.com/DietrichGebert/ponytail.git"));
        assert_eq!(github_url("https://github.com/a/b/tree/main/skills").as_deref(), Some("https://github.com/a/b.git"));
        assert!(github_url("https://evil.com/a/b").is_none());
        assert!(github_url("https://github.com/a;rm/b").is_none());
        assert!(github_url("https://github.com/a").is_none());
    }

    #[test]
    fn names_are_sanitized() {
        assert_eq!(safe_name("Pony Tail!"), "pony-tail");
        assert_eq!(safe_name("../../etc"), "etc");
        assert!(valid_account("pessoal-1"));
        assert!(!valid_account("../x"));
    }
}
