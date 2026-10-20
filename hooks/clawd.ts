// Clawd, read off the Claude Code start-up logo's quadrant characters
// (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝): each character is 2×2 pixels. 1 is body,
// 2 an eye, which the logo leaves to the terminal's dark background.
const CLAWD = [
  '000111111111111000',
  '000112111111211000',
  '011111111111111110',
  '000111111111111000',
  '000010100001010000',
]

export const CLAWD_WIDTH = 18
export const CLAWD_HEIGHT = 5
export const CLAWD_ORANGE = 0xd77757

// Indexed by a 2×2 mask: upper-left 8, upper-right 4, lower-left 2, lower-right 1.
export const QUADRANTS = [
  0x20, 0x2597, 0x2596, 0x2584, 0x259d, 0x2590, 0x259e, 0x259f, 0x2598, 0x259a, 0x258c, 0x2599,
  0x2580, 0x259c, 0x259b, 0x2588,
]

export type Pixel = 'paper' | 'body' | 'eye'

export function pixelAt(x: number, y: number, scale: number): Pixel {
  const value = CLAWD[Math.floor(y / scale)]?.[Math.floor(x / scale)]
  return value === '1' ? 'body' : value === '2' ? 'eye' : 'paper'
}

// The order a Spectrum fills its screen's pixel lines: within each third,
// line 0 of every character row, then line 1, and so on. Character rows are
// 8 lines on the real screen; a short picture uses 4 so the blinds still show.
export function loadOrder(height: number): number[] {
  const block = height >= 24 ? 8 : 4
  const thirds = height >= 48 ? 3 : 1
  const third = Math.ceil(height / thirds)
  const order: number[] = []
  for (let k = 0; k < thirds; k++) {
    const end = Math.min(height, (k + 1) * third)
    for (let line = 0; line < block; line++) {
      for (let row = k * third + line; row < end; row += block) order.push(row)
    }
  }
  return order
}
