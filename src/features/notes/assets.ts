import { notesApi } from './api'

const urls = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

export function peekAsset(id: string): string | undefined {
  return urls.get(id)
}

export function primeAsset(id: string, url: string) {
  urls.set(id, url)
}

export function loadAsset(id: string): Promise<string> {
  const hit = urls.get(id)
  if (hit) return Promise.resolve(hit)
  let p = inflight.get(id)
  if (!p) {
    p = notesApi
      .assetGet(id)
      .then((url) => {
        urls.set(id, url)
        return url
      })
      .finally(() => inflight.delete(id))
    inflight.set(id, p)
  }
  return p
}

export function clearAssetCache() {
  for (const u of urls.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u)
  urls.clear()
}
