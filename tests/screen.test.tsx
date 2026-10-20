import { expect, test } from 'claude-code/testing'

import { loadOrder } from '../hooks/clawd'

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

test('the band shows Clawd beside the program name once loaded', async $ => {
  const ui = await $.ui.mount({
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
  })
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
})

test('pixel lines load in Spectrum order', () => {
  expect(loadOrder(10)).toEqual([0, 4, 8, 1, 5, 9, 2, 6, 3, 7])
  // The real 192-line screen: line 0 of the top third's eight character rows, then line 1.
  expect(loadOrder(192).slice(0, 9)).toEqual([0, 8, 16, 24, 32, 40, 48, 56, 1])
  expect(loadOrder(192)[64]).toBe(64)
})

test('the desktop band draws the screen as an SVG with Clawd and the program name', async $ => {
  const ui = await $.ui.mount({
    plugin: 'retro-loader',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    surface: 'desktop',
    props: {
      hasSurvey: false,
      isWorking: true,
      maxRows: 20,
      bodyColumns: 60,
      scroll: { offset: 0, bodyRows: 19 },
      view: {},
    },
  })
  const svg = await ui.find({ type: 'Svg' })
  const source = String(svg?.props.source)
  expect(svg?.props.isInteractive).toBeUndefined()
  expect(source).toContain('width="4000" height="1200"')
  expect(source).toContain('viewBox="0 0 480 144"')
  expect(source).toContain('>Program: claude</text>')
  expect(source).toContain('fill="#d77757"')
  expect(source).toContain('fill="#000000"')
  await ui.unmount()
})

test('the VS Code band draws the screen as an SVG', async $ => {
  const ui = await $.ui.mount({
    plugin: 'retro-loader',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    surface: 'vscode',
    props: {
      hasSurvey: false,
      isWorking: true,
      maxRows: 20,
      bodyColumns: 60,
      scroll: { offset: 0, bodyRows: 19 },
      view: {},
    },
  })
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('>Program: claude</text>')
  await ui.unmount()
})
