export type City = { name: string; lat: number; lon: number; tz: string }

export const CITIES: City[] = [
  { name: 'Fortaleza', lat: -3.73, lon: -38.52, tz: 'America/Fortaleza' },
  { name: 'Recife', lat: -8.05, lon: -34.88, tz: 'America/Recife' },
]

export function homeCity(): City {
  return CITIES[0]
}

export function localTime(tz: string, d = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d)
}
