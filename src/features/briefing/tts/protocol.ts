export type VoicePhase = 'idle' | 'loading' | 'downloading' | 'ready' | 'error'

export type ToWorker = { t: 'init'; device?: 'wasm' | 'webgpu'; dtype?: 'q8' | 'fp32' } | { t: 'synth'; id: string; speech: string; voice: string }

export type FromWorker =
  | { t: 'state'; phase: VoicePhase; device?: string; dtype?: string; ms?: number; error?: string }
  | { t: 'progress'; loaded: number; total: number }
  | { t: 'audio'; id: string; pcm: Float32Array; sr: number; cached: boolean; ms: number; phonemes?: string }
  | { t: 'fail'; id: string; error: string }
