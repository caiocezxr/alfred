use crate::commands::R;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

const API: &str = "https://api.github.com";
const USER_AGENT: &str = "Alfred-GitHub/1.0";
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BYTES: u64 = 4 * 1024 * 1024;
const GH_PATHS: [&str; 3] = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];
const GIT_PATHS: [&str; 3] = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
const HELPER_MARK: &str = "alfred-gh-account=";

static TOKENS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn find(paths: &[&str]) -> Option<String> {
    paths.iter().find(|p| Path::new(p).exists()).map(|p| p.to_string())
}

fn gh_bin() -> R<String> {
    find(&GH_PATHS).ok_or_else(|| "[gh-ausente] o GitHub CLI (gh) não está instalado. Instale com: brew install gh".into())
}

fn git_bin() -> R<String> {
    find(&GIT_PATHS).ok_or_else(|| "o git não foi encontrado".into())
}

fn valid_login(s: &str) -> bool {
    !s.is_empty() && s.len() <= 39 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn valid_repo(s: &str) -> bool {
    let mut parts = s.split('/');
    let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) else { return false };
    valid_login(a) && !b.is_empty() && b.len() <= 100 && b.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn valid_branch(s: &str) -> bool {
    !s.is_empty() && s.len() <= 250 && !s.starts_with('-') && !s.contains("..") && s.chars().all(|c| !c.is_control() && c != ' ' && c != '~' && c != '^' && c != ':' && c != '\\')
}

fn token_for(login: &str) -> R<String> {
    if !valid_login(login) {
        return Err("conta inválida".into());
    }
    if let Some(t) = TOKENS.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(login).cloned())) {
        return Ok(t);
    }
    let out = Command::new(gh_bin()?).args(["auth", "token", "--hostname", "github.com", "--user", login]).output().map_err(|e| format!("não deu para rodar o gh: {e}"))?;
    if !out.status.success() {
        return Err(format!("[gh-conta] a conta {login} não está logada no gh. Rode: gh auth login"));
    }
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if token.is_empty() {
        return Err(format!("[gh-conta] o gh não devolveu acesso para {login}"));
    }
    if let Ok(mut g) = TOKENS.lock() {
        g.get_or_insert_with(HashMap::new).insert(login.to_string(), token.clone());
    }
    Ok(token)
}

fn forget(login: &str) {
    if let Ok(mut g) = TOKENS.lock() {
        if let Some(m) = g.as_mut() {
            m.remove(login);
        }
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).http_status_as_error(false).user_agent(USER_AGENT).build().into()
}

fn call(login: &str, method: &str, path: &str, body: Option<&Value>) -> R<Value> {
    let token = token_for(login)?;
    let url = format!("{API}{path}");
    let auth = format!("Bearer {token}");
    let a = agent();
    let resp = match (method, body) {
        ("GET", _) => a.get(&url).header("Authorization", &auth).header("Accept", "application/vnd.github+json").call(),
        (m, b) => {
            let bytes = serde_json::to_vec(b.unwrap_or(&Value::Null)).map_err(|e| e.to_string())?;
            let req = match m {
                "POST" => a.post(&url),
                "PUT" => a.put(&url),
                "PATCH" => a.patch(&url),
                _ => return Err("método inválido".into()),
            };
            req.header("Authorization", &auth).header("Accept", "application/vnd.github+json").header("Content-Type", "application/json").send(&bytes[..])
        }
    };
    let mut resp = resp.map_err(|e| match e {
        ureq::Error::Timeout(_) => "[rede] o GitHub demorou demais".to_string(),
        _ => "[rede] sem conexão com o GitHub".to_string(),
    })?;
    let status = resp.status().as_u16();
    let text = resp.body_mut().with_config().limit(MAX_BYTES).read_to_string().map_err(|_| "[rede] a resposta do GitHub veio quebrada".to_string())?;
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status == 401 {
        forget(login);
        return Err(format!("[gh-conta] o acesso da conta {login} expirou. Rode: gh auth refresh -u {login}"));
    }
    if !(200..300).contains(&status) {
        let msg = v["message"].as_str().unwrap_or("erro");
        let detail = v["errors"].as_array().and_then(|a| a.first()).and_then(|e| e["message"].as_str()).unwrap_or("");
        return Err(format!("[github] {msg}{}", if detail.is_empty() { String::new() } else { format!(": {detail}") }));
    }
    Ok(v)
}

fn graphql(login: &str, query: &str, variables: Value) -> R<Value> {
    let v = call(login, "POST", "/graphql", Some(&json!({ "query": query, "variables": variables })))?;
    if let Some(errs) = v["errors"].as_array() {
        if v["data"].is_null() {
            let msg = errs.first().and_then(|e| e["message"].as_str()).unwrap_or("erro");
            return Err(format!("[github] {msg}"));
        }
    }
    Ok(v["data"].clone())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhAccount {
    login: String,
    active: bool,
    ok: bool,
    scopes: String,
}

fn accounts_blocking() -> R<Vec<GhAccount>> {
    let out = Command::new(gh_bin()?).args(["auth", "status", "--hostname", "github.com", "--json", "hosts"]).output().map_err(|e| format!("não deu para rodar o gh: {e}"))?;
    let v: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    let list = v["hosts"]["github.com"].as_array().cloned().unwrap_or_default();
    Ok(list
        .iter()
        .filter_map(|a| {
            let login = a["login"].as_str()?.to_string();
            valid_login(&login).then(|| GhAccount {
                login,
                active: a["active"].as_bool().unwrap_or(false),
                ok: a["state"].as_str() == Some("success"),
                scopes: a["scopes"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_accounts() -> R<Vec<GhAccount>> {
    blocking(accounts_blocking).await
}

#[tauri::command]
pub async fn github_switch(login: String) -> R<Vec<GhAccount>> {
    if !valid_login(&login) {
        return Err("conta inválida".into());
    }
    blocking(move || {
        let out = Command::new(gh_bin()?).args(["auth", "switch", "--hostname", "github.com", "--user", &login]).output().map_err(|e| format!("não deu para rodar o gh: {e}"))?;
        if !out.status.success() {
            return Err(format!("o gh não conseguiu trocar para {login}"));
        }
        accounts_blocking()
    })
    .await
}

const PR_FIELDS: &str = "... on PullRequest { number title url isDraft updatedAt headRefName baseRefName mergeable reviewDecision additions deletions \
    repository { nameWithOwner } author { login } \
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } \
    comments(last: 5) { totalCount nodes { author { login avatarUrl } bodyText createdAt } } \
    reviews(last: 5) { nodes { author { login avatarUrl } state bodyText submittedAt comments { totalCount } } } }";

#[tauri::command]
pub async fn github_dashboard(login: String) -> R<Value> {
    blocking(move || {
        let q = format!(
            "query {{ viewer {{ login name avatarUrl databaseId }} \
             mine: search(query: \"is:pr is:open author:@me archived:false sort:updated-desc\", type: ISSUE, first: 30) {{ nodes {{ {PR_FIELDS} }} }} \
             review: search(query: \"is:pr is:open review-requested:@me archived:false sort:updated-desc\", type: ISSUE, first: 30) {{ nodes {{ {PR_FIELDS} }} }} \
             issues: search(query: \"is:issue is:open assignee:@me archived:false sort:updated-desc\", type: ISSUE, first: 30) {{ nodes {{ ... on Issue {{ number title url updatedAt repository {{ nameWithOwner }} labels(first: 4) {{ nodes {{ name color }} }} }} }} }} }}"
        );
        graphql(&login, &q, json!({}))
    })
    .await
}

#[tauri::command]
pub async fn github_repos(login: String) -> R<Value> {
    blocking(move || {
        graphql(
            &login,
            "query { viewer { repositories(first: 100, orderBy: {field: PUSHED_AT, direction: DESC}, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) { nodes { nameWithOwner isPrivate pushedAt defaultBranchRef { name } } } } }",
            json!({}),
        )
    })
    .await
}

#[tauri::command]
pub async fn github_branches(login: String, repo: String) -> R<Value> {
    if !valid_repo(&repo) {
        return Err("repositório inválido".into());
    }
    blocking(move || {
        let (owner, name) = repo.split_once('/').unwrap();
        graphql(
            &login,
            "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { name } \
             refs(refPrefix: \"refs/heads/\", first: 60, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) { nodes { name target { ... on Commit { committedDate messageHeadline } } } } \
             pullRequests(states: OPEN, first: 60) { nodes { number headRefName url } } } }",
            json!({ "owner": owner, "name": name }),
        )
    })
    .await
}

#[tauri::command]
pub async fn github_pr_create(login: String, repo: String, head: String, base: String, title: String, body: String, draft: bool) -> R<Value> {
    if !valid_repo(&repo) || !valid_branch(&head) || !valid_branch(&base) {
        return Err("repositório ou branch inválido".into());
    }
    let title: String = title.trim().chars().take(250).collect();
    if title.is_empty() {
        return Err("o PR precisa de um título".into());
    }
    let body: String = body.chars().take(20000).collect();
    blocking(move || {
        let v = call(&login, "POST", &format!("/repos/{repo}/pulls"), Some(&json!({ "title": title, "head": head, "base": base, "body": body, "draft": draft })))?;
        Ok(json!({ "number": v["number"], "url": v["html_url"] }))
    })
    .await
}

#[tauri::command]
pub async fn github_pr_merge(login: String, repo: String, number: u32, method: String) -> R<Value> {
    if !valid_repo(&repo) || number == 0 {
        return Err("PR inválido".into());
    }
    let method = match method.as_str() {
        "merge" | "rebase" => method,
        _ => "squash".to_string(),
    };
    blocking(move || {
        let v = call(&login, "PUT", &format!("/repos/{repo}/pulls/{number}/merge"), Some(&json!({ "merge_method": method })))?;
        Ok(json!({ "merged": v["merged"], "message": v["message"] }))
    })
    .await
}

#[tauri::command]
pub async fn github_pr_detail(login: String, repo: String, number: u32) -> R<Value> {
    if !valid_repo(&repo) || number == 0 {
        return Err("PR inválido".into());
    }
    blocking(move || {
        let (owner, name) = repo.split_once('/').unwrap();
        let data = graphql(
            &login,
            "query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $n) { \
             number title url state isDraft merged mergeable reviewDecision headRefName baseRefName additions deletions changedFiles createdAt bodyHTML \
             author { login avatarUrl } \
             commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 40) { nodes { \
               ... on CheckRun { __typename name conclusion status detailsUrl } \
               ... on StatusContext { __typename context state targetUrl } } } } } } } \
             reviews(last: 15) { nodes { author { login avatarUrl } state submittedAt bodyText } } \
             comments(last: 15) { nodes { author { login avatarUrl } bodyText createdAt } } } } }",
            json!({ "owner": owner, "name": name, "n": number }),
        )?;
        let files = call(&login, "GET", &format!("/repos/{repo}/pulls/{number}/files?per_page=80"), None)?;
        let list: Vec<Value> = files
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|f| {
                let patch: String = f["patch"].as_str().unwrap_or("").chars().take(24000).collect();
                json!({ "filename": f["filename"], "status": f["status"], "additions": f["additions"], "deletions": f["deletions"], "patch": patch })
            })
            .collect();
        Ok(json!({ "pr": data["repository"]["pullRequest"], "files": list }))
    })
    .await
}

#[tauri::command]
pub async fn github_pr_review(login: String, repo: String, number: u32, event: String, body: String) -> R<Value> {
    if !valid_repo(&repo) || number == 0 {
        return Err("PR inválido".into());
    }
    let event = match event.as_str() {
        "APPROVE" | "REQUEST_CHANGES" | "COMMENT" => event,
        _ => return Err("ação de review inválida".into()),
    };
    let body: String = body.chars().take(8000).collect();
    if event != "APPROVE" && body.trim().is_empty() {
        return Err("escreva um comentário".into());
    }
    blocking(move || {
        let v = call(&login, "POST", &format!("/repos/{repo}/pulls/{number}/reviews"), Some(&json!({ "event": event, "body": body })))?;
        Ok(json!({ "state": v["state"] }))
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepo {
    path: String,
    name: String,
    remote: Option<String>,
    repo: Option<String>,
    ssh: bool,
    branch: Option<String>,
    name_cfg: Option<String>,
    email_cfg: Option<String>,
    email_local: bool,
    account: Option<String>,
}

pub(crate) fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new(git_bin().ok()?).arg("-C").arg(dir).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

pub(crate) fn parse_remote(url: &str) -> (Option<String>, bool) {
    let u = url.trim();
    let ssh = u.starts_with("git@") || u.starts_with("ssh://");
    let rest = u
        .strip_prefix("git@github.com:")
        .or_else(|| u.strip_prefix("ssh://git@github.com/"))
        .or_else(|| u.strip_prefix("https://github.com/"))
        .or_else(|| u.split_once("@github.com/").map(|(_, r)| r));
    let repo = rest.map(|r| r.trim_end_matches('/').trim_end_matches(".git").to_string()).filter(|r| valid_repo(r));
    (repo, ssh)
}

fn read_repo(dir: &Path) -> LocalRepo {
    let remote = git(dir, &["config", "--get", "remote.origin.url"]);
    let (repo, ssh) = remote.as_deref().map(parse_remote).unwrap_or((None, false));
    let helpers = git(dir, &["config", "--local", "--get-all", "credential.https://github.com.helper"]).unwrap_or_default();
    let account = helpers.lines().find_map(|l| l.split(HELPER_MARK).nth(1).map(|r| r.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')).next().unwrap_or("").to_string())).filter(|l| valid_login(l));
    LocalRepo {
        path: dir.to_string_lossy().to_string(),
        name: dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        remote,
        repo,
        ssh,
        branch: git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]),
        name_cfg: git(dir, &["config", "user.name"]),
        email_cfg: git(dir, &["config", "user.email"]),
        email_local: git(dir, &["config", "--local", "user.email"]).is_some(),
        account,
    }
}

fn scan_dirs(base: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if out.len() >= 300 {
        return;
    }
    if base.join(".git").exists() {
        out.push(base.to_path_buf());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(base) else { return };
    let mut dirs: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    for d in dirs {
        let n = d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if n.starts_with('.') || n == "node_modules" || n == "target" || n == "Library" {
            continue;
        }
        scan_dirs(&d, depth - 1, out);
    }
}

pub(crate) fn home() -> R<PathBuf> {
    std::env::var("HOME").map(PathBuf::from).map_err(|_| "pasta pessoal não encontrada".to_string())
}

pub(crate) fn safe_dir(p: &str) -> R<PathBuf> {
    let h = home()?;
    let raw = if let Some(rest) = p.strip_prefix("~/") { h.join(rest) } else { PathBuf::from(p) };
    let real = std::fs::canonicalize(&raw).map_err(|_| format!("a pasta {p} não existe"))?;
    if !real.starts_with(&h) {
        return Err("use uma pasta dentro da sua pasta pessoal".into());
    }
    Ok(real)
}

#[tauri::command]
pub async fn github_local_scan(base: String) -> R<Vec<LocalRepo>> {
    blocking(move || {
        let dir = safe_dir(&base)?;
        let mut found = vec![];
        scan_dirs(&dir, 3, &mut found);
        Ok(found.iter().map(|d| read_repo(d)).collect())
    })
    .await
}

#[tauri::command]
pub async fn github_identity_apply(path: String, login: String, name: String, email: String) -> R<LocalRepo> {
    if !valid_login(&login) {
        return Err("conta inválida".into());
    }
    let name: String = name.trim().chars().filter(|c| !c.is_control()).take(100).collect();
    let email: String = email.trim().chars().filter(|c| !c.is_control()).take(200).collect();
    if name.is_empty() || !email.contains('@') {
        return Err("informe nome e e-mail para os commits".into());
    }
    blocking(move || {
        let dir = safe_dir(&path)?;
        if !dir.join(".git").exists() {
            return Err("essa pasta não é um repositório git".into());
        }
        let gh = gh_bin()?;
        let gitb = git_bin()?;
        let run = |args: &[&str]| -> R<()> {
            let ok = Command::new(&gitb).arg("-C").arg(&dir).args(args).status().map_err(|e| e.to_string())?.success();
            if ok { Ok(()) } else { Err(format!("o git recusou: {}", args.join(" "))) }
        };
        run(&["config", "--local", "user.name", &name])?;
        run(&["config", "--local", "user.email", &email])?;
        let key = "credential.https://github.com.helper";
        let _ = Command::new(&gitb).arg("-C").arg(&dir).args(["config", "--local", "--unset-all", key]).status();
        run(&["config", "--local", "--add", key, ""])?;
        let helper = format!("!f() {{ : {HELPER_MARK}{login}; test \"$1\" = get || exit 0; echo username={login}; echo password=$(\"{gh}\" auth token --hostname github.com --user {login}); }}; f");
        run(&["config", "--local", "--add", key, &helper])?;
        run(&["config", "--local", "credential.https://github.com.username", &login])?;
        Ok(read_repo(&dir))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remotes_are_parsed() {
        assert_eq!(parse_remote("git@github.com:caiocezxr/alfred.git"), (Some("caiocezxr/alfred".into()), true));
        assert_eq!(parse_remote("https://github.com/statix/conciliador-ngc.git"), (Some("statix/conciliador-ngc".into()), false));
        assert_eq!(parse_remote("https://user@github.com/a-b/c.d"), (Some("a-b/c.d".into()), false));
        assert_eq!(parse_remote("https://gitlab.com/x/y"), (None, false));
    }

    #[test]
    fn inputs_are_validated() {
        assert!(valid_login("caio-stx"));
        assert!(!valid_login("caio;rm"));
        assert!(valid_repo("org/repo.name_1"));
        assert!(!valid_repo("org/repo/extra"));
        assert!(valid_branch("feature/abc-123"));
        assert!(!valid_branch("-oops"));
        assert!(!valid_branch("a..b"));
    }
}
