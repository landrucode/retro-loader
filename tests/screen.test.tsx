import { expect, mock, test } from 'claude-code/testing'
import type { Engine, On } from 'claude-code'

import { loadOrder } from '../hooks/clawd'
import { CYCLE_S, TAPE_WAV_BASE64 } from '../hooks/tape'

function decode(cells: string, columns: number) {
  const bytes = Uint8Array.fromBase64(cells)
  const words = new Uint32Array(bytes.buffer)
  const rows: string[] = []
  for (let at = 0; at < words.length; at += columns * 3) {
    let row = ''
    for (let x = 0; x < columns; x++) row += String.fromCodePoint(words[at + x * 3] ?? 0x3f)
    rows.push(row)
  }
  return { words, rows }
}

// The engine beneath the plugin: a clock the test moves, an engine player that
// plays the whole clip, and a surface that takes repaints and draws an empty line itself.
function engine(on: On) {
  const clock = mock.clock(on)
  mock.env(on, {})
  on('audio.play', async () => {
    await clock.sleep(CYCLE_S * 1000)
    return { value: undefined }
  })
  on('ui.blit', () => ({ value: {} }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{''}</Text>
  })
  return clock
}

// A band that stops working ends the loading the band started.
const endTurn = ($: Engine, band: { readonly props: typeof terminalBand.props }) =>
  $.ui.mount({ ...band, props: { ...band.props, isWorking: false } })

const terminalBand = {
  plugin: 'retro-loader',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

test('a band drawn mid-turn starts loading rather than showing a loaded screen', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(terminalBand)
  const { rows, words } = decode(String((await ui.find({ type: 'Raster' }))?.props.cells), 60)
  expect([0xd70000, 0x00d7d7]).toContain(words[1])
  expect(rows[2]?.slice(5, 23)).toBe(' '.repeat(18))
  await ui.unmount()
  await endTurn($, terminalBand)
})

test('the band shows Clawd beside the program name once loaded', async ($, on) => {
  const clock = engine(on)
  const first = await $.ui.mount(terminalBand)
  await clock.advance(CYCLE_S * 1000 - 50)
  await first.unmount()
  const ui = await $.ui.mount(terminalBand)
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props.rows).toBe(9)

  const { rows } = decode(String(raster?.props.cells), 60)
  expect(rows[1]).toBe('\u2580'.repeat(60))
  expect(rows[2]?.slice(5, 23)).toBe('   ' + '\u2588'.repeat(12) + '   ')
  expect(rows[2]?.slice(25, 56).trim()).toBe('Program: claude')

  // Row 1 of the sprite at scale 2: the eyes are black cells, columns 5 and 12 of Clawd.
  const { words } = decode(String(raster?.props.cells), 60)
  const background = (x: number, y: number) => words[(y * 60 + x) * 3 + 2]
  expect(background(5 + 5, 3)).toBe(0x000000)
  expect(background(5 + 12, 3)).toBe(0x000000)
  expect(background(5 + 6, 3)).toBe(0xd7d7d7)
  expect(rows[7]).toBe('\u2580'.repeat(60))
  await ui.unmount()
  await endTurn($, terminalBand)
})

test('pixel lines load in Spectrum order', () => {
  expect(loadOrder(10)).toEqual([0, 4, 8, 1, 5, 9, 2, 6, 3, 7])
  // The real 192-line screen: line 0 of the top third's eight character rows, then line 1.
  expect(loadOrder(192).slice(0, 9)).toEqual([0, 8, 16, 24, 32, 40, 48, 56, 1])
  expect(loadOrder(192)[64]).toBe(64)
})

const svgBand = (surface: 'desktop' | 'vscode') => ({ ...terminalBand, surface }) as const

test('the desktop band draws the screen as an SVG with Clawd and the program name', async ($, on) => {
  const clock = engine(on)
  const band = svgBand('desktop')
  await (await $.ui.mount(band)).unmount()
  await clock.advance(CYCLE_S * 1000 - 50)
  const ui = await $.ui.mount(band)
  const svg = await ui.find({ type: 'Svg' })
  const source = String(svg?.props.source)
  expect(svg?.props.isInteractive).toBeUndefined()
  expect(source).toContain('width="4000" height="1200"')
  expect(source).toContain('viewBox="0 0 480 144"')
  expect(source).toContain('>Program: claude</text>')
  expect(source).toContain('fill="#d77757"')
  expect(source).toContain('fill="#000000"')
  await ui.unmount()
  await endTurn($, band)
})

test('the VS Code band draws the screen as an SVG', async ($, on) => {
  engine(on)
  const band = svgBand('vscode')
  const ui = await $.ui.mount(band)
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('>Program: claude</text>')
  await ui.unmount()
  await endTurn($, band)
})

test('the tape is one 8-bit mono WAV loop as long as the cycle', () => {
  const bytes = Uint8Array.fromBase64(TAPE_WAV_BASE64)
  const view = new DataView(bytes.buffer)
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')
  expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE')
  expect(view.getUint16(22, true)).toBe(1)
  expect(view.getUint16(34, true)).toBe(8)
  expect(view.getUint32(40, true)).toBe(Math.round(22050 * CYCLE_S))
})
