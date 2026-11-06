import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { civil } from '../../shared/dates'
import { isTauri } from '../../shared/db/api'
import { planNotifications, pruneSent } from './logic'
import { getWork, loadWork, readUi, subscribeWork, syncDay, writeUi } from './store'

const SENT_KEY = 'ps.work.notified.v1'

function readSent(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
function writeSent(v: Record<string, string>) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(v))
  } catch {
    return
  }
}

export type Permission = 'granted' | 'denied' | 'default' | 'unsupported'

export async function permission(): Promise<Permission> {
  try {
    if (isTauri) return (await isPermissionGranted()) ? 'granted' : 'default'
    if (!('Notification' in window)) return 'unsupported'
    return Notification.permission
  } catch {
    return 'unsupported'
  }
}

export async function askPermission(): Promise<Permission> {
  writeUi({ asked: true })
  try {
    if (isTauri) {
      if (await isPermissionGranted()) return 'granted'
      return (await requestPermission()) === 'granted' ? 'granted' : 'denied'
    }
    if (!('Notification' in window)) return 'unsupported'
    return await Notification.requestPermission()
  } catch {
    return 'unsupported'
  }
}

async function send(title: string, body: string): Promise<boolean> {
  let p = await permission()
  if (p === 'default' && !readUi().asked) p = await askPermission()
  if (p !== 'granted') return false
  try {
    if (isTauri) sendNotification({ title, body })
    else new Notification(title, { body, silent: false })
    return true
  } catch {
    return false
  }
}

export function testNotification() {
  return send('Trabalho', 'As notificações estão funcionando.')
}

let running = false
let busy = false

async function tick() {
  if (busy) return
  busy = true
  try {
    await loadWork()
    const st = getWork().state
    if (!st) return
    const now = new Date()
    const today = civil(now)
    let sent = pruneSent(readSent(), today)
    for (const n of planNotifications(st, now, sent)) {
      const ok = await send(n.title, n.body)
      if (!ok && (await permission()) !== 'granted') break
      sent = { ...sent, [n.key]: today }
    }
    writeSent(sent)
    syncDay()
  } finally {
    busy = false
  }
}

export function startNotifier() {
  if (running || typeof window === 'undefined') return
  running = true
  setTimeout(() => void tick(), 4000)
  setInterval(() => void tick(), 60_000)
  subscribeWork(syncDay)
}
