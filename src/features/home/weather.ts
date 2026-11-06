import { useEffect, useState } from 'react'
import { CITIES } from './geo'

export type Weather = {
  city: string
  temp: number
  feels: number
  humidity: number
  wind: number
  code: number
  isDay: boolean
  max: number
  min: number
  rain: number
}

type Cache = { at: number; data: Weather[] }

const KEY = 'ps.weather.v1'
const TTL = 30 * 60 * 1000

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Cache) : null
  } catch {
    return null
  }
}

async function fetchWeather(): Promise<Weather[]> {
  const lat = CITIES.map((c) => c.lat).join(',')
  const lon = CITIES.map((c) => c.lon).join(',')
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1'
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`clima indisponível (${res.status})`)
    const body = await res.json()
    const list = Array.isArray(body) ? body : [body]
    return list.map((d: Record<string, Record<string, number[] & number>>, i: number) => ({
      city: CITIES[i].name,
      temp: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      wind: d.current.wind_speed_10m,
      code: d.current.weather_code,
      isDay: d.current.is_day === 1,
      max: d.daily.temperature_2m_max[0],
      min: d.daily.temperature_2m_min[0],
      rain: d.daily.precipitation_probability_max[0] ?? 0,
    }))
  } finally {
    clearTimeout(t)
  }
}

export function useWeather() {
  const [state, setState] = useState<{ data: Weather[] | null; at: number | null; error: string | null; loading: boolean }>(() => {
    const c = readCache()
    return { data: c?.data ?? null, at: c?.at ?? null, error: null, loading: false }
  })

  const refresh = async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await fetchWeather()
      const at = Date.now()
      localStorage.setItem(KEY, JSON.stringify({ at, data }))
      setState({ data, at, error: null, loading: false })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'sem conexão' }))
    }
  }

  useEffect(() => {
    const c = readCache()
    if (!c || Date.now() - c.at > TTL) void refresh()
    const id = setInterval(() => void refresh(), TTL)
    return () => clearInterval(id)
  }, [])

  return { ...state, refresh }
}

export function describe(code: number): { label: string; icon: 'sun' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'storm' } {
  if (code === 0) return { label: 'Céu limpo', icon: 'sun' }
  if (code <= 2) return { label: code === 1 ? 'Poucas nuvens' : 'Parcialmente nublado', icon: 'partly' }
  if (code === 3) return { label: 'Nublado', icon: 'cloud' }
  if (code === 45 || code === 48) return { label: 'Neblina', icon: 'fog' }
  if (code >= 51 && code <= 57) return { label: 'Garoa', icon: 'drizzle' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: code >= 80 ? 'Pancadas de chuva' : 'Chuva', icon: 'rain' }
  if (code >= 95) return { label: 'Trovoadas', icon: 'storm' }
  return { label: 'Tempo instável', icon: 'cloud' }
}
