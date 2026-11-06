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

#[cfg(target_os = "macos")]
fn sample(app: &AppHandle) -> Meter {
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
    let roles: Vec<(&'static str, i32)> = [("app", Some(me)), ("pagina", kids.0), ("graficos", kids.1)].into_iter().filter_map(|(r, p)| p.map(|p| (r, p))).collect();
    let now = Instant::now();
    let ns = tick_ns();
    let mut prev = PREV.lock().unwrap_or_else(|e| e.into_inner());
    let mut ticks = HashMap::new();
    let mut parts = vec![];
    for (role, pid) in roles {
        let Some((t, mem)) = usage(pid) else { continue };
        let cpu = match prev.as_ref() {
            Some(p) => {
                let dt = now.duration_since(p.at).as_nanos() as f64;
                match p.ticks.get(&pid) {
                    Some(&before) if dt > 0.0 && t >= before => (t - before) as f64 * ns / dt * 100.0,
                    _ => 0.0,
                }
            }
            None => 0.0,
        };
        ticks.insert(pid, t);
        parts.push(Part { role, cpu: (cpu * 10.0).round() / 10.0, mem });
    }
    *prev = Some(Prev { at: now, ticks });
    Meter {
        cpu: (parts.iter().map(|p| p.cpu).sum::<f64>() * 10.0).round() / 10.0,
        mem: parts.iter().map(|p| p.mem).sum(),
        parts,
        gpu: gpu_busy(),
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
    }
}

#[cfg(not(target_os = "macos"))]
fn sample(_app: &AppHandle) -> Meter {
    Meter { parts: vec![], cpu: 0.0, mem: 0, gpu: None, cores: 1 }
}

#[tauri::command]
pub async fn meter_sample(app: AppHandle) -> R<Meter> {
    tauri::async_runtime::spawn_blocking(move || sample(&app)).await.map_err(|e| e.to_string())
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
    fn gpu_reading_is_a_percent() {
        if let Some(g) = gpu_busy() {
            assert!((0.0..=100.0).contains(&g));
        }
    }
}
