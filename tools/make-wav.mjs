// Writes sounds/load.wav, one loop of a ZX Spectrum tape load built from
// the ROM's pulse timings, and hooks/timeline.ts, where each part of it starts,
// so the border stripes follow the sound.
// Run from the mod folder: node tools/make-wav.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

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

const pulses = []
let seconds = 0
const push = t => {
  pulses.push(t)
  seconds += t / CPU_HZ
}
const pilot = s => {
  const end = seconds + s
  while (seconds < end) push(PILOT)
}
const gap = s => {
  pulses.push(-s * CPU_HZ)
  seconds += s
}
const bytes = (list, until = Infinity) => {
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
  const body = [0x00, 0x00, ...Buffer.from('claude    '), 0x00, 0x1b, 0x0a, 0x00, 0x00, 0x1b]
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
const headerData = seconds
bytes(header)
const pause = seconds
gap(1)
const programPilot = seconds
pilot(2)
const programData = seconds
const CYCLE_S = programData + PROGRAM_DATA_LENGTH_S
bytes(program, CYCLE_S)

const total = Math.round(RATE * CYCLE_S)
const samples = Buffer.alloc(total)
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

const head = Buffer.alloc(44)
head.write('RIFF', 0)
head.writeUInt32LE(36 + total, 4)
head.write('WAVEfmt ', 8)
head.writeUInt32LE(16, 16)
head.writeUInt16LE(1, 20)
head.writeUInt16LE(1, 22)
head.writeUInt32LE(RATE, 24)
head.writeUInt32LE(RATE, 28)
head.writeUInt16LE(1, 32)
head.writeUInt16LE(8, 34)
head.write('data', 36)
head.writeUInt32LE(total, 40)

mkdirSync('sounds', { recursive: true })
writeFileSync('sounds/load.wav', Buffer.concat([head, samples]))

const s = n => n.toFixed(3)
writeFileSync(
  'hooks/timeline.ts',
  `// Written by tools/make-wav.mjs: where each part of sounds/load.wav starts, in seconds.
export const CYCLE_S = ${s(CYCLE_S)}
export const HEADER_DATA_S = ${s(headerData)}
export const PAUSE_S = ${s(pause)}
export const PROGRAM_PILOT_S = ${s(programPilot)}
export const PROGRAM_DATA_S = ${s(programData)}
`,
)
console.log({ headerData, pause, programPilot, programData, bytes: 44 + total })
