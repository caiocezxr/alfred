import { isTauri } from './db/api'

export async function openExternal(url: string) {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(u.toString())
  } else window.open(u.toString(), '_blank', 'noopener,noreferrer')
}
