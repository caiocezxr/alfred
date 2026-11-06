import { AutoTokenizer, env, StyleTextToSpeech2Model, Tensor, type PreTrainedTokenizer } from '@huggingface/transformers'
import espeakFactory from '@echogarden/espeak-ng-emscripten'
import espeakData from '@echogarden/espeak-ng-emscripten/espeak-ng.data?url'
import ortWasm from '/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'
import doraUrl from './pf_dora.bin?url'
import { idbCache, audioGet, audioPut, audioPrune } from './store.ts'
import { phonemize, trimSilence } from './phonemes.ts'
import type { ToWorker, FromWorker } from './protocol.ts'

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
export const MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'
const SR = 24000

type Scope = { postMessage(m: FromWorker, t?: Transferable[]): void; onmessage: ((ev: MessageEvent<ToWorker>) => void) | null }
const scope = self as unknown as Scope
const post = (m: FromWorker, t?: Transferable[]) => scope.postMessage(m, t)

env.allowLocalModels = false
env.useBrowserCache = false
env.useCustomCache = true
env.customCache = idbCache
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } }
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href }
  onnx.wasm.numThreads = 1
  onnx.wasm.proxy = false
}

type Engine = {
  model: StyleTextToSpeech2Model
  tokenizer: PreTrainedTokenizer
  ipa: (s: string) => string
  voices: Map<string, Float32Array>
}

let ready: Promise<Engine> | null = null

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function loadEspeak(): Promise<(s: string) => string> {
  const data = await (await fetch(espeakData)).arrayBuffer()
  const mod = await espeakFactory({ getPreloadedPackage: () => data, print: () => {}, printErr: () => {} })
  const w = new mod.eSpeakNGWorker()
  w.set_voice('pt-br')
  return (s: string) => w.synthesize_ipa(s).ipa ?? ''
}

async function loadVoice(id: string): Promise<Float32Array> {
  if (id !== 'pf_dora') throw new Error(`voz desconhecida: ${id}`)
  return new Float32Array(await (await fetch(doraUrl)).arrayBuffer())
}

function init(force?: 'wasm' | 'webgpu', dtype?: 'q8' | 'fp32'): Promise<Engine> {
  if (ready) return ready
  ready = (async () => {
    post({ t: 'state', phase: 'loading' })
    await audioPrune(4 * 864e5).catch(() => {})
    const gpu = force ? force === 'webgpu' : await hasWebGpu()
    try {
      return await load(gpu ? 'webgpu' : 'wasm', dtype)
    } catch (e) {
      if (!gpu) throw e
      return await load('wasm', dtype)
    }
  })()
  ready.catch((e: unknown) => {
    ready = null
    post({ t: 'state', phase: 'error', error: e instanceof Error ? e.message : String(e) })
  })
  return ready
}

async function load(device: 'webgpu' | 'wasm', want?: 'q8' | 'fp32'): Promise<Engine> {
  const dtype = want ?? 'fp32'
  const files = new Map<string, { loaded: number; total: number }>()
  let downloading = false
  idbCache.onMiss = () => {
    if (!downloading) {
      downloading = true
      post({ t: 'state', phase: 'downloading' })
    }
  }
  const progress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file || !downloading) return
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
    let loaded = 0
    let total = 0
    for (const f of files.values()) {
      loaded += f.loaded
      total += f.total
    }
    post({ t: 'progress', loaded, total })
  }
  const t0 = performance.now()
  const [model, tokenizer, ipa, dora] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { dtype, device, revision: MODEL_REVISION, progress_callback: progress }),
    AutoTokenizer.from_pretrained(MODEL_ID, { revision: MODEL_REVISION, progress_callback: progress }),
    loadEspeak(),
    loadVoice('pf_dora'),
  ])
  await model({
    input_ids: tokenizer('a', { truncation: true }).input_ids,
    style: new Tensor('float32', dora.slice(0, 256), [1, 256]),
    speed: new Tensor('float32', [1], [1]),
  })
  post({ t: 'state', phase: 'ready', device, dtype, ms: Math.round(performance.now() - t0) })
  return { model, tokenizer, ipa, voices: new Map([['pf_dora', dora]]) }
}

async function synth(id: string, speech: string, voice: string): Promise<void> {
  const hit = await audioGet(id).catch(() => null)
  if (hit) {
    post({ t: 'audio', id, pcm: hit, sr: SR, cached: true, ms: 0 }, [hit.buffer])
    return
  }
  const e = await init()
  const t0 = performance.now()
  const ph = phonemize(speech, e.ipa)
  const { input_ids } = e.tokenizer(ph, { truncation: true })
  const style = e.voices.get(voice) ?? e.voices.get('pf_dora')!
  const n = (input_ids as Tensor).dims.at(-1) ?? 0
  const off = 256 * Math.min(Math.max(n - 2, 0), 509)
  const out = await e.model({
    input_ids,
    style: new Tensor('float32', style.slice(off, off + 256), [1, 256]),
    speed: new Tensor('float32', [1], [1]),
  })
  const wave = (out.waveform as Tensor).data as Float32Array
  const pcm = trimSilence(wave, SR)
  const ms = Math.round(performance.now() - t0)
  void audioPut(id, pcm.slice()).catch(() => {})
  post({ t: 'audio', id, pcm, sr: SR, cached: false, ms, phonemes: ph }, [pcm.buffer])
}

let chain: Promise<void> = Promise.resolve()

scope.onmessage = (ev) => {
  const m = ev.data
  if (m.t === 'init') {
    void init(m.device, m.dtype).catch(() => {})
    return
  }
  if (m.t === 'synth') {
    chain = chain.then(() =>
      synth(m.id, m.speech, m.voice).catch((e: unknown) => post({ t: 'fail', id: m.id, error: e instanceof Error ? e.message : String(e) })),
    )
  }
}
