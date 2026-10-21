import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { CLAWD_HEIGHT, CLAWD_ORANGE, CLAWD_WIDTH, QUADRANTS, loadOrder, pixelAt } from './clawd'
import { CYCLE_S, HEADER_DATA_S, PAUSE_S, PROGRAM_DATA_S, PROGRAM_PILOT_S, TAPE_WAV_BASE64 } from './tape'

const RASTER = 'screen'
const FRAME_MS = 40
const BAND_ROWS = 9

// Bumped to redraw the SVG screens; the terminal's Raster is repainted by blit instead.
const svgFrame = atom({ plugin: 'retro-loader', key: 'svgFrame' } as const, 0)

// The Spectrum's non-bright palette.
const BLACK = 0x000000
const BLUE = 0x0000d7
const RED = 0xd70000
const MAGENTA = 0xd700d7
const CYAN = 0x00d7d7
const YELLOW = 0xd7d700
const WHITE = 0xd7d7d7

// Border thickness in cells, roughly the Spectrum's border-to-paper proportion.
const EDGE_ROWS = 2
const EDGE_COLUMNS = 4

const UPPER_HALF = 0x2580
// The picture shrinks or goes rather than squeeze the text narrower than this.
const MIN_TEXT_COLUMNS = 20

// The pilot stripes' drift, in half-rows a second, on both surfaces.
const PILOT_DRIFT = 14

// An SVG screen is laid out in the same cells as the terminal's, each this many units.
const CELL_WIDTH = 8
const CELL_HEIGHT = 16
// Wider than any slot, so the surface always scales the drawing down to fit.
const SVG_DRAWN_WIDTH = 4000
// SVG screens redraw on a phase change at once, and for new text or picture lines at most this often.
const SVG_REDRAW_MS = 250
// The data flicker is precomputed: this many stripe frames, cycled by SMIL.
const DATA_FRAMES = 4
const DATA_FRAME_S = 0.04

type Ink = 'prompt' | 'thinking' | 'text' | 'tool'
type Paragraph = { ink: Ink; id: string; text: string }
type Line = { ink: Ink; text: string }
type Phase = 'pilot' | 'data' | 'pause'

type Picture = { scale: number; columns: number; rows: number; top: number; shownLines: Set<number> }
type ScreenPlan = {
  columns: number
  rows: number
  edgeRows: number
  paper: { columns: number; rows: number } | null
  picture: Picture | null
  textLeft: number
  lines: Line[]
}

const INK: Record<Ink, number> = { prompt: MAGENTA, thinking: BLUE, text: BLACK, tool: RED }
const MAX_PARAGRAPHS = 200
const MAX_PARAGRAPH_CHARS = 4000

const phaseAt = (t: number | null): Phase =>
  t === null
    ? 'pause'
    : t < HEADER_DATA_S
      ? 'pilot'
      : t < PAUSE_S
        ? 'data'
        : t < PROGRAM_PILOT_S
          ? 'pause'
          : t < PROGRAM_DATA_S
            ? 'pilot'
            : 'data'

const pilotBand = (halfRows: number) => Math.max(2, Math.round(halfRows / 12))

function dataStripes(halfRows: number): number[] {
  const colours: number[] = []
  while (colours.length < halfRows) {
    const run = 1 + Math.floor(Math.random() * 3)
    const colour = Math.random() < 0.5 ? BLUE : YELLOW
    for (let i = 0; i < run; i++) colours.push(colour)
  }
  return colours.slice(0, halfRows)
}

// One colour per half-row, so a row's stripe is the same colour on both sides.
function stripes(halfRows: number, t: number | null): number[] {
  const phase = phaseAt(t)
  if (phase === 'pause' || t === null) return Array(halfRows).fill(WHITE)
  if (phase === 'data') return dataStripes(halfRows)

  const band = pilotBand(halfRows)
  const drift = Math.floor(t * PILOT_DRIFT)
  const colours: number[] = []
  for (let y = 0; y < halfRows; y++) {
    colours.push(Math.floor((y + drift) / band) % 2 === 0 ? RED : CYAN)
  }
  return colours
}

// A Raster cell takes one printable width-1 BMP character; the SVG text uses the same.
function cellChar(codePoint: number): number | null {
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return null
  if (codePoint >= 0x300 && codePoint < 0x370) return null
  const isWide =
    codePoint > 0xffff ||
    (codePoint >= 0x1100 && codePoint < 0x1160) ||
    (codePoint >= 0x2e80 && codePoint < 0xa4d0) ||
    (codePoint >= 0xac00 && codePoint < 0xd7a4) ||
    (codePoint >= 0xd800 && codePoint < 0xe000) ||
    (codePoint >= 0xf900 && codePoint < 0xfb00) ||
    (codePoint >= 0xfe30 && codePoint < 0xfe50) ||
    (codePoint >= 0xff00 && codePoint < 0xff61) ||
    (codePoint >= 0xffe0 && codePoint < 0xffe7)
  return isWide ? 0x3f : codePoint
}

function wrapParagraph(paragraph: Paragraph, width: number): Line[] {
  const lines: Line[] = []
  for (const raw of paragraph.text.split('\n')) {
    const chars: number[] = []
    for (const ch of raw.replace(/\t/g, '  ')) {
      const code = cellChar(ch.codePointAt(0) ?? 0x3f)
      if (code !== null) chars.push(code)
    }
    let text = String.fromCodePoint(...chars)
    if (text.length === 0) {
      lines.push({ ink: paragraph.ink, text: '' })
      continue
    }
    while (text.length > 0) {
      let cut = width
      if (text.length > width) {
        const space = text.lastIndexOf(' ', width)
        if (space > width / 2) cut = space + 1
      }
      lines.push({ ink: paragraph.ink, text: text.slice(0, cut).trimEnd() })
      text = text.slice(cut)
    }
  }
  return lines
}

const rasterSites = new Map<string, { columns: number; rows: number; edgeRows: number }>()
const svgSites = new Set<string>()
let paragraphs: Paragraph[] = []
let textVersion = 0
let lastSvgKey = ''
let lastSvgRedrawAt = 0
// `cycleStartedAt` moves to each replay of the clip, so the stripes restart
// with the sound; without sound it stays put and the timeline wraps by itself.
let loading: { cycleStartedAt: number; hasSound: boolean; stop: AbortController; tick: Timer } | null =
  null

function append(ink: Ink, id: string, text: string) {
  textVersion += 1
  const last = paragraphs.at(-1)
  if (last !== undefined && last.id === id) {
    last.text = (last.text + text).slice(-MAX_PARAGRAPH_CHARS)
    return
  }
  paragraphs.push({ ink, id, text: text.slice(-MAX_PARAGRAPH_CHARS) })
  if (paragraphs.length > MAX_PARAGRAPHS) paragraphs = paragraphs.slice(-MAX_PARAGRAPHS)
}

function lastLines(width: number, count: number): Line[] {
  const lines: Line[] = []
  for (let i = paragraphs.length - 1; i >= 0 && lines.length < count; i--) {
    const paragraph = paragraphs[i]
    if (paragraph !== undefined) lines.unshift(...wrapParagraph(paragraph, width))
  }
  return lines.slice(-count)
}

// How much of the picture has loaded: its pixel lines arrive across the
// program data, as the Spectrum loads SCREEN$.
function pictureLoaded(t: number | null): number {
  if (t === null) return 1
  if (t < PROGRAM_DATA_S) return 0
  return Math.min(1, (t - PROGRAM_DATA_S) / (CYCLE_S - PROGRAM_DATA_S))
}

function plan(columns: number, rows: number, edgeRows: number, t: number | null): ScreenPlan {
  const hasPaper = columns >= EDGE_COLUMNS * 2 + 8 && rows >= edgeRows * 2 + 1
  if (!hasPaper) return { columns, rows, edgeRows, paper: null, picture: null, textLeft: 0, lines: [] }

  const paper = { columns: columns - EDGE_COLUMNS * 2, rows: rows - edgeRows * 2 }
  const scale = Math.min(
    Math.floor((paper.rows * 2) / CLAWD_HEIGHT),
    Math.floor((paper.columns - MIN_TEXT_COLUMNS - 3) / (CLAWD_WIDTH / 2)),
  )
  let picture: Picture | null = null
  if (scale >= 1) {
    const pictureRows = Math.ceil((CLAWD_HEIGHT * scale) / 2)
    const pixelLines = CLAWD_HEIGHT * scale
    picture = {
      scale,
      columns: (CLAWD_WIDTH / 2) * scale,
      rows: pictureRows,
      top: Math.floor((paper.rows - pictureRows) / 2),
      shownLines: new Set(loadOrder(pixelLines).slice(0, Math.round(pictureLoaded(t) * pixelLines))),
    }
  }

  const textLeft = 1 + (picture === null ? 0 : picture.columns + 2)
  const textColumns = paper.columns - textLeft - 1
  const program: Line = { ink: 'text', text: 'Program: claude' }
  const latest =
    paper.rows < 3
      ? lastLines(textColumns, 50).filter(line => line.text !== '').slice(-paper.rows)
      : lastLines(textColumns, paper.rows - 2)
  const lines = paper.rows < 3 ? (latest.length > 0 ? latest : [program]) : [program, ...latest]

  return { columns, rows, edgeRows, paper, picture, textLeft, lines }
}

function rasterCells(screen: ScreenPlan, t: number | null): string {
  const { columns, rows, edgeRows, paper, picture, textLeft, lines } = screen
  const words = new Uint32Array(columns * rows * 3)
  const colours = stripes(rows * 2, t)

  for (let y = 0; y < rows; y++) {
    const line = lines[y - edgeRows]
    for (let x = 0; x < columns; x++) {
      const at = (y * columns + x) * 3
      const px = x - EDGE_COLUMNS
      const py = y - edgeRows
      const isPaper = paper !== null && py >= 0 && py < paper.rows && px >= 0 && px < paper.columns
      const cy = picture === null ? -1 : py - picture.top

      if (isPaper && picture !== null && px >= 1 && px < 1 + picture.columns && cy >= 0 && cy < picture.rows) {
        const cx = px - 1
        // A cell has two colours: body orange over paper white, or over black
        // where an eye has loaded (the logo's eyes share cells only with body).
        let mask = 0
        let hasEye = false
        for (const [bit, dx, dy] of [[8, 0, 0], [4, 1, 0], [2, 0, 1], [1, 1, 1]] as const) {
          const row = cy * 2 + dy
          const pixel = picture.shownLines.has(row) ? pixelAt(cx * 2 + dx, row, picture.scale) : 'paper'
          if (pixel === 'body') mask |= bit
          if (pixel === 'eye') hasEye = true
        }
        words[at] = QUADRANTS[mask] ?? 0x20
        words[at + 1] = CLAWD_ORANGE
        words[at + 2] = hasEye ? BLACK : WHITE
      } else if (isPaper) {
        const ch = px < textLeft ? undefined : line?.text.codePointAt(px - textLeft)
        words[at] = ch ?? 0x20
        words[at + 1] = line === undefined ? BLACK : INK[line.ink]
        words[at + 2] = WHITE
      } else {
        words[at] = UPPER_HALF
        words[at + 1] = colours[y * 2] ?? WHITE
        words[at + 2] = colours[y * 2 + 1] ?? WHITE
      }
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}

const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`
const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function svgStripeRects(colours: number[], width: number): string {
  const half = CELL_HEIGHT / 2
  let rects = ''
  for (let y = 0; y < colours.length; ) {
    let run = 1
    while (colours[y + run] === colours[y]) run++
    rects += `<rect x="0" y="${y * half}" width="${width}" height="${run * half}" fill="${hex(colours[y] ?? WHITE)}"/>`
    y += run
  }
  return rects
}

// The border animates inside the drawing (SMIL), so the app moves the
// stripes itself; the mod redraws only when the phase, text or picture changes.
function svgBorder(width: number, height: number, t: number | null): string {
  const phase = phaseAt(t)
  if (phase === 'pause' || t === null) {
    return `<rect width="${width}" height="${height}" fill="${hex(WHITE)}"/>`
  }

  const halfRows = height / (CELL_HEIGHT / 2)
  if (phase === 'pilot') {
    const band = (pilotBand(halfRows) * CELL_HEIGHT) / 2
    const seconds = (2 * band) / ((PILOT_DRIFT * CELL_HEIGHT) / 2)
    return (
      `<defs><pattern id="pilot" patternUnits="userSpaceOnUse" width="${width}" height="${2 * band}">` +
      `<rect width="${width}" height="${band}" fill="${hex(RED)}"/>` +
      `<rect y="${band}" width="${width}" height="${band}" fill="${hex(CYAN)}"/>` +
      `<animateTransform attributeName="patternTransform" type="translate" from="0 0" to="0 ${-2 * band}" ` +
      `dur="${seconds.toFixed(3)}s" begin="${(-(t % seconds)).toFixed(3)}s" repeatCount="indefinite"/>` +
      `</pattern></defs><rect width="${width}" height="${height}" fill="url(#pilot)"/>`
    )
  }

  let frames = ''
  for (let i = 0; i < DATA_FRAMES; i++) {
    const values = Array.from({ length: DATA_FRAMES }, (_, k) => (k === i ? 1 : 0)).join(';')
    frames +=
      `<g opacity="${i === 0 ? 1 : 0}">${svgStripeRects(dataStripes(halfRows), width)}` +
      `<animate attributeName="opacity" values="${values}" calcMode="discrete" ` +
      `dur="${(DATA_FRAMES * DATA_FRAME_S).toFixed(2)}s" repeatCount="indefinite"/></g>`
  }
  return frames
}

function svgSource(screen: ScreenPlan, t: number | null): string {
  const { columns, rows, edgeRows, paper, picture, textLeft, lines } = screen
  const width = columns * CELL_WIDTH
  const height = rows * CELL_HEIGHT
  let body = svgBorder(width, height, t)

  if (paper !== null) {
    const left = EDGE_COLUMNS * CELL_WIDTH
    const top = edgeRows * CELL_HEIGHT
    body += `<rect x="${left}" y="${top}" width="${paper.columns * CELL_WIDTH}" height="${paper.rows * CELL_HEIGHT}" fill="${hex(WHITE)}"/>`

    if (picture !== null) {
      const pixelWidth = CELL_WIDTH / 2
      const pixelHeight = CELL_HEIGHT / 2
      const originX = left + CELL_WIDTH
      const originY = top + picture.top * CELL_HEIGHT
      for (const row of picture.shownLines) {
        for (let x = 0; x < CLAWD_WIDTH * picture.scale; ) {
          const pixel = pixelAt(x, row, picture.scale)
          let run = 1
          while (x + run < CLAWD_WIDTH * picture.scale && pixelAt(x + run, row, picture.scale) === pixel) run++
          if (pixel !== 'paper') {
            body += `<rect x="${originX + x * pixelWidth}" y="${originY + row * pixelHeight}" width="${run * pixelWidth}" height="${pixelHeight}" fill="${hex(pixel === 'eye' ? BLACK : CLAWD_ORANGE)}"/>`
          }
          x += run
        }
      }
    }

    lines.forEach((line, i) => {
      if (line.text === '') return
      body += `<text x="${left + textLeft * CELL_WIDTH}" y="${top + (i + 1) * CELL_HEIGHT - 4}" fill="${hex(INK[line.ink])}">${escapeXml(line.text)}</text>`
    })
  }

  return (
    // Drawn as an image, the box takes the markup's width up to the slot, so an
    // oversized width makes the surface shrink the grid to the slot's full width.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${SVG_DRAWN_WIDTH}" height="${Math.round((SVG_DRAWN_WIDTH * height) / width)}" ` +
    `font-family="ui-monospace, Menlo, monospace" font-size="13.3" xml:space="preserve">${body}</svg>`
  )
}

async function elapsed($: EngineInterface): Promise<number | null> {
  if (loading === null) return null
  const t = ((await $.clock.now()) - loading.cycleStartedAt) / 1000
  return loading.hasSound ? Math.min(t, CYCLE_S) : t % CYCLE_S
}

// The engine plays clips on macOS. Where it has no player (a Linux or Windows
// terminal) the call returns at once, and the clip goes to the host's own player:
// Windows PowerShell's SoundPlayer, or on Linux paplay, pw-play or aplay. A child's
// stdin takes text, so the clip crosses as base64 and the child decodes it.
type Player = 'engine' | 'host' | 'none'
let player: Player = 'engine'

// Each player's whole command is fixed text in its own spawn call, so the
// directory's checks can read exactly what runs.
async function spawnPlayer($: EngineInterface) {
  if ((await $.env.get('OS')) === 'Windows_NT') {
    return $.process.spawn({
      argv: [
        'powershell',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$b = [Convert]::FromBase64String([Console]::In.ReadToEnd()); (New-Object System.Media.SoundPlayer (New-Object System.IO.MemoryStream (,$b))).PlaySync()',
      ],
      input: TAPE_WAV_BASE64,
    })
  }
  return $.process.spawn({
    argv: [
      'sh',
      '-c',
      'if command -v paplay >/dev/null 2>&1; then base64 -d | paplay; elif command -v pw-play >/dev/null 2>&1; then base64 -d | pw-play -; elif command -v aplay >/dev/null 2>&1; then base64 -d | aplay -q; else echo "no paplay, pw-play or aplay found" >&2; exit 127; fi',
    ],
    input: TAPE_WAV_BASE64,
  })
}

// Plays one clip through the host's player; resolves with why it failed, or null.
async function playOnHost($: EngineInterface, stop: AbortController): Promise<string | null> {
  const child = await spawnPlayer($)
  const kill = () => void child.return(undefined as never)
  stop.signal.addEventListener('abort', kill, { once: true })
  let stderr = ''
  try {
    for (;;) {
      const piece = await child.next()
      if (piece.done === true) {
        if (stop.signal.aborted || piece.value.code === 0) return null
        return stderr.trim() || `the player exited with ${piece.value.code ?? piece.value.signal}`
      }
      if (piece.value.stream === 'stderr') stderr += piece.value.text
    }
  } catch (error: unknown) {
    return stop.signal.aborted ? null : `the player did not start: ${String(error)}`
  } finally {
    stop.signal.removeEventListener('abort', kill)
  }
}

// Plays the clip once per cycle rather than looping it in the player, whose
// restart gap would otherwise build up against the stripes.
async function playTape($: EngineInterface, stop: AbortController) {
  while (loading !== null && loading.stop === stop && !stop.signal.aborted) {
    const startedAt = await $.clock.now()
    loading.cycleStartedAt = startedAt

    if (player === 'engine') {
      try {
        await $.audio.play({ base64: TAPE_WAV_BASE64, mime: 'audio/wav' }, { signal: stop.signal })
      } catch {
        player = 'host'
        continue
      }
      if (!stop.signal.aborted && (await $.clock.now()) - startedAt < (CYCLE_S * 1000) / 2) player = 'host'
      continue
    }

    if (player === 'host') {
      const failure = await playOnHost($, stop)
      if (failure === null) continue
      player = 'none'
      $.ui.toast(`retro-loader: no sound (${failure})`)
    }

    loading.hasSound = false
    return
  }
}

async function paint($: EngineInterface) {
  const t = await elapsed($)
  for (const [requestId, { columns, rows, edgeRows }] of rasterSites) {
    const cells = rasterCells(plan(columns, rows, edgeRows, t), t)
    const result = await $.ui.blit({ requestId, key: RASTER, cells })
    if (result.deny !== undefined) rasterSites.delete(requestId)
  }

  if (svgSites.size > 0) {
    const phase = phaseAt(t)
    const key = `${phase}|${Math.floor(pictureLoaded(t) * 40)}|${textVersion}`
    const now = await $.clock.now()
    const isDue = !lastSvgKey.startsWith(`${phase}|`) || now - lastSvgRedrawAt >= SVG_REDRAW_MS
    if (key !== lastSvgKey && isDue) {
      lastSvgKey = key
      lastSvgRedrawAt = now
      await update($, svgFrame, n => n + 1)
    }
  }
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && loading === null) {
      if (e.text !== '') {
        append('text', `gap:${e.turnId}`, '')
        append('prompt', `prompt:${e.turnId}`, e.text)
      }
      const stop = new AbortController()
      loading = {
        cycleStartedAt: await $.clock.now(),
        hasSound: true,
        stop,
        tick: $.clock.every(FRAME_MS, () => void paint($)),
      }
      void playTape($, stop)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    for await (const chunk of stream) {
      if (e.agentId === undefined) {
        const id = `${e.turnId}:${e.index}:${'index' in chunk ? chunk.index : ''}`
        if (chunk.kind === 'thinking') append('thinking', id, chunk.text)
        if (chunk.kind === 'text') append('text', id, chunk.text)
        if (chunk.kind === 'tool') append('tool', chunk.id, `> ${chunk.name}`)
      }
      yield chunk
    }

    return await stream.result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && loading !== null) {
      loading.stop.abort()
      loading.tick.cancel()
      loading = null
      await paint($)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !e.props.isWorking) {
      rasterSites.delete(e.requestId)
      svgSites.delete(e.requestId)
      return next(e)
    }

    const columns = e.props.bodyColumns
    const rows = Math.min(BAND_ROWS, e.props.scroll.bodyRows)
    const edgeRows = Math.min(EDGE_ROWS, Math.floor((rows - 1) / 2))

    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const t = await elapsed($)
      rasterSites.set(e.requestId, { columns, rows, edgeRows })
      return <Raster key={RASTER} columns={columns} rows={rows} cells={rasterCells(plan(columns, rows, edgeRows, t), t)} />
    }

    const { Svg } = $.ui.resolve(e)
    await read($, svgFrame)
    const t = await elapsed($)
    svgSites.add(e.requestId)
    return <Svg source={svgSource(plan(columns, rows, edgeRows, t), t)} alt="ZX Spectrum loading screen" />
  })
}
