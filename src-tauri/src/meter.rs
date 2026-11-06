use crate::commands::R;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tauri::AppHandle;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    role: &'static str,
    cpu: f64,
    gpu: f64,
    mem: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meter {
    parts: Vec<Part>,
    cpu: f64,
    mem: u64,
    gpu: Option<f64>,
    cores: usize,
}

struct Prev {
    at: Instant,
    ticks: HashMap<i32, u64>,
    gpu: HashMap<i32, u64>,
}

static PREV: Mutex<Option<Prev>> = Mutex::new(None);
static KIDS: Mutex<Option<(Option<i32>, Option<i32>)>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn usage(pid: i32) -> Option<(u64, u64)> {
    let mut info: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V4, (&mut info as *mut libc::rusage_info_v4).cast()) };
    if rc != 0 {
        return None;
    }
    Some((info.ri_user_time + info.ri_system_time, info.ri_phys_footprint))
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct Timebase {
    numer: u32,
    denom: u32,
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn mach_timebase_info(info: *mut Timebase) -> i32;
}

#[cfg(target_os = "macos")]
fn tick_ns() -> f64 {
    let mut tb = Timebase { numer: 0, denom: 0 };
    unsafe { mach_timebase_info(&mut tb) };
    if tb.denom == 0 { 1.0 } else { tb.numer as f64 / tb.denom as f64 }
}

#[cfg(target_os = "macos")]
fn webkit_pids(app: &AppHandle) -> (Option<i32>, Option<i32>) {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    use tauri::Manager;
    let Some(w) = app.get_webview_window("main") else { return (None, None) };
    let (tx, rx) = std::sync::mpsc::channel();
    let ok = w.with_webview(move |wv| {
        let view = wv.inner() as *mut AnyObject;
        let pids = unsafe {
            match view.as_ref() {
                None => (None, None),
                Some(obj) => {
                    let has_web: bool = msg_send![obj, respondsToSelector: sel!(_webProcessIdentifier)];
                    let has_gpu: bool = msg_send![obj, respondsToSelector: sel!(_gpuProcessIdentifier)];
                    let web: Option<i32> = if has_web { Some(msg_send![obj, _webProcessIdentifier]) } else { None };
                    let gpu: Option<i32> = if has_gpu { Some(msg_send![obj, _gpuProcessIdentifier]) } else { None };
                    (web.filter(|p| *p > 0), gpu.filter(|p| *p > 0))
                }
            }
        };
        let _ = tx.send(pids);
    });
    if ok.is_err() {
        return (None, None);
    }
    rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap_or((None, None))
}

fn gpu_busy() -> Option<f64> {
    let out = std::process::Command::new("/usr/sbin/ioreg").args(["-r", "-c", "IOAccelerator", "-d", "1"]).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let key = "\"Device Utilization %\"=";
    let i = s.find(key)? + key.len();
    s[i..].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok()
}

fn gpu_times() -> HashMap<i32, u64> {
    let mut m = HashMap::new();
    let Ok(out) = std::process::Command::new("/usr/sbin/ioreg").args(["-r", "-c", "AGXDeviceUserClient", "-l", "-w0"]).output() else { return m };
    let s = String::from_utf8_lossy(&out.stdout);
    for block in s.split("+-o ") {
        let tag = "\"IOUserClientCreator\" = \"pid ";
        let Some(i) = block.find(tag) else { continue };
        let rest = &block[i + tag.len()..];
        let Ok(pid) = rest.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<i32>() else { continue };
        let mut total = 0u64;
        let key = "\"accumulatedGPUTime\"=";
        let mut from = 0;
        while let Some(j) = block[from..].find(key) {
            let at = from + j + key.len();
            total += block[at..].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<u64>().unwrap_or(0);
            from = at;
        }
        *m.entry(pid).or_insert(0) += total;
    }
    m
}

static OLLAMA: Mutex<Option<(Instant, Vec<i32>)>> = Mutex::new(None);

fn ollama_pids() -> Vec<i32> {
    let mut g = OLLAMA.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, v)) = g.as_ref() {
        if at.elapsed().as_secs() < 15 {
            return v.clone();
        }
    }
    let v = scan_ollama();
    *g = Some((Instant::now(), v.clone()));
    v
}

fn scan_ollama() -> Vec<i32> {
    let Ok(out) = std::process::Command::new("/usr/bin/pgrep").arg("-x").arg("ollama").output() else { return vec![] };
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.trim().parse().ok()).collect()
}

#[cfg(target_os = "macos")]
fn sample(app: &AppHandle, detail: bool) -> Meter {
    let me = std::process::id() as i32;
    let kids = {
        let cached = KIDS.lock().ok().and_then(|g| *g);
        match cached {
            Some((w, g)) if w.is_none_or(|p| usage(p).is_some()) && g.is_none_or(|p| usage(p).is_some()) && (w.is_some() || g.is_some()) => (w, g),
            _ => {
                let fresh = webkit_pids(app);
                if let Ok(mut g) = KIDS.lock() {
                    *g = Some(fresh);
                }
                fresh
            }
        }
    };
    let mut roles: Vec<(&'static str, i32)> = [("app", Some(me)), ("pagina", kids.0), ("graficos", kids.1)].into_iter().filter_map(|(r, p)| p.map(|p| (r, p))).collect();
    roles.extend(ollama_pids().into_iter().map(|p| ("local", p)));
    let now = Instant::now();
    let ns = tick_ns();
    let gpu_now = if detail { gpu_times() } else { HashMap::new() };
    let mut prev = PREV.lock().unwrap_or_else(|e| e.into_inner());
    let mut ticks = HashMap::new();
    let mut gpu_seen = HashMap::new();
    let mut parts: Vec<Part> = vec![];
    for (role, pid) in roles {
        let Some((t, mem)) = usage(pid) else { continue };
        let g = gpu_now.get(&pid).copied().unwrap_or(0);
        let (cpu, gpu) = match prev.as_ref() {
            Some(p) => {
                let dt = now.duration_since(p.at).as_nanos() as f64;
                let cpu = match p.ticks.get(&pid) {
                    Some(&before) if dt > 0.0 && t >= before => (t - before) as f64 * ns / dt * 100.0,
                    _ => 0.0,
                };
                let gpu = match p.gpu.get(&pid) {
                    Some(&before) if detail && dt > 0.0 && g >= before => ((g - before) as f64 / dt * 100.0).min(100.0),
                    _ => 0.0,
                };
                (cpu, gpu)
            }
            None => (0.0, 0.0),
        };
        ticks.insert(pid, t);
        gpu_seen.insert(pid, g);
        if let Some(same) = parts.iter_mut().find(|x| x.role == role) {
            same.cpu += cpu;
            same.gpu += gpu;
            same.mem += mem;
        } else {
            parts.push(Part { role, cpu, gpu, mem });
        }
    }
    for p in parts.iter_mut() {
        p.cpu = (p.cpu * 10.0).round() / 10.0;
        p.gpu = (p.gpu.min(100.0) * 10.0).round() / 10.0;
    }
    *prev = Some(Prev { at: now, ticks, gpu: gpu_seen });
    let own = parts.iter().filter(|p| p.role != "local");
    Meter {
        cpu: (own.clone().map(|p| p.cpu).sum::<f64>() * 10.0).round() / 10.0,
        mem: own.map(|p| p.mem).sum(),
        parts,
        gpu: gpu_busy(),
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
    }
}

#[cfg(not(target_os = "macos"))]
fn sample(_app: &AppHandle, _detail: bool) -> Meter {
    Meter { parts: vec![], cpu: 0.0, mem: 0, gpu: None, cores: 1 }
}

#[tauri::command]
pub async fn meter_sample(app: AppHandle, detail: Option<bool>) -> R<Meter> {
    let detail = detail.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || sample(&app, detail)).await.map_err(|e| e.to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn reads_own_process() {
        let (t0, mem) = usage(std::process::id() as i32).expect("rusage");
        assert!(mem > 0);
        let mut x = 0u64;
        for i in 0..20_000_000u64 {
            x = x.wrapping_add(i ^ (x >> 3));
        }
        assert!(x != 1);
        let (t1, _) = usage(std::process::id() as i32).unwrap();
        let ms = (t1 - t0) as f64 * tick_ns() / 1e6;
        assert!(ms > 1.0 && ms < 10_000.0, "{ms}");
    }

    #[test]
    fn gpu_times_parse() {
        let m = gpu_times();
        assert!(!m.is_empty());
        assert!(m.values().any(|v| *v > 0));
    }

    #[test]
    fn gpu_reading_is_a_percent() {
        if let Some(g) = gpu_busy() {
            assert!((0.0..=100.0).contains(&g));
        }
    }
}
