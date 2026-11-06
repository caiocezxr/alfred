export type Engine = 'page' | 'worker' | 'core' | 'local'

export type Activity = {
  id: string
  label: string
  detail: string
  engine: Engine
  since: number
  work?: () => number
}

const live = new Map<string, Activity>()

export function track(id: string, label: string, engine: Engine, detail = '', work?: () => number) {
  const since = Date.now()
  live.set(id, { id, label, detail, engine, since, work })
  return () => {
    if (live.get(id)?.since === since) live.delete(id)
  }
}

export function setDetail(id: string, detail: string) {
  const a = live.get(id)
  if (a) a.detail = detail
}

export async function during<T>(id: string, label: string, engine: Engine, detail: string, p: Promise<T>): Promise<T> {
  const stop = track(id, label, engine, detail)
  try {
    return await p
  } finally {
    stop()
  }
}

export const activities = () => [...live.values()]
