import { briefingPlayer } from './player.ts'
import { NEURAL_VOICES } from './profile.ts'

export const narrator = {
  get speaking() {
    return briefingPlayer.speaking || previewing
  },
  get isPaused() {
    return briefingPlayer.getState().status === 'paused'
  },
  level: () => briefingPlayer.level(),
  bands: (out: Float32Array) => briefingPlayer.bands(out),
  async sample(text: string, speed = 1): Promise<boolean> {
    previewing = true
    try {
      return await briefingPlayer.preview(text, speed)
    } finally {
      previewing = false
    }
  },
  stopSample() {
    briefingPlayer.stopPreview()
  },
}

let previewing = false

export async function listVoices(): Promise<{ id: string; name: string }[]> {
  return NEURAL_VOICES.map((v) => ({ id: v.id, name: v.name }))
}
