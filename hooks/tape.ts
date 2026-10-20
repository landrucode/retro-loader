// One loop of a ZX Spectrum tape load, built from the ROM's pulse timings
// when the module loads, and where each part of it starts, so the border
// stripes follow the sound.

const RATE = 22050
const CPU_HZ = 3_500_000
const FIRST_PILOT_S = 2.5
const PROGRAM_DATA_LENGTH_S = 15

// ROM loader half-pulse lengths, in T-states.
const PILOT = 2168
const SYNC_1 = 667
const SYNC_2 = 735
const BIT_0 = 855
const BIT_1 = 1710

// A pulse is a half-wave in T-states; a negative one is silence, in T-states.
const pulses: number[] = []
let seconds = 0

const push = (t: number) => {
  pulses.push(t)
  seconds += t / CPU_HZ
}

const pilot = (s: number) => {
  const end = seconds + s
  while (seconds < end) push(PILOT)
}

const gap = (s: number) => {
  pulses.push(-s * CPU_HZ)
  seconds += s
}

function bytes(list: () => Iterable<number>, until = Infinity) {
  push(SYNC_1)
  push(SYNC_2)
  for (const b of list()) {
    for (let bit = 7; bit >= 0; bit--) {
      const t = (b >> bit) & 1 ? BIT_1 : BIT_0
      push(t)
      push(t)
    }
    if (seconds >= until) break
  }
}

function* header() {
  const name = Array.from('claude    ', ch => ch.charCodeAt(0))
  const body = [0x00, 0x00, ...name, 0x00, 0x1b, 0x0a, 0x00, 0x00, 0x1b]
  yield* body
  yield body.reduce((a, b) => a ^ b, 0)
}

function* program() {
  yield 0xff
  let seed = 0x5eed
  for (;;) {
    seed = (seed * 1103515245 + 12345) >>> 0
    yield seed >>> 24
  }
}

pilot(FIRST_PILOT_S)
export const HEADER_DATA_S = seconds
bytes(header)
export const PAUSE_S = seconds
gap(1)
export const PROGRAM_PILOT_S = seconds
pilot(2)
export const PROGRAM_DATA_S = seconds
export const CYCLE_S = PROGRAM_DATA_S + PROGRAM_DATA_LENGTH_S
bytes(program, CYCLE_S)

function wav(): Uint8Array {
  const total = Math.round(RATE * CYCLE_S)
  const file = new Uint8Array(44 + total)
  const samples = file.subarray(44)
  let level = 1
  let smooth = 0
  let i = 0
  let at = 0
  for (const p of pulses) {
    at += Math.abs(p) / CPU_HZ
    const target = p < 0 ? 0 : level
    while (i < total && i < at * RATE) {
      smooth += (target - smooth) * 0.45
      samples[i++] = 128 + Math.round(smooth * 0.4 * 127)
    }
    if (p > 0) level = -level
  }
  while (i < total) {
    smooth *= 0.55
    samples[i++] = 128 + Math.round(smooth * 0.4 * 127)
  }

  // An 8-bit mono PCM header.
  const view = new DataView(file.buffer)
  const tag = (offset: number, text: string) => {
    for (let k = 0; k < text.length; k++) file[offset + k] = text.charCodeAt(k)
  }
  tag(0, 'RIFF')
  view.setUint32(4, 36 + total, true)
  tag(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  tag(36, 'data')
  view.setUint32(40, total, true)
  return file
}

export const TAPE_WAV_BASE64 = wav().toBase64()
