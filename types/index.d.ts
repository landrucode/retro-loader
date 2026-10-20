// Bumped to redraw the SVG screens.
export type SvgFrame = number

declare module 'claude-code' {
  interface PluginState {
    'retro-loader': { svgFrame: SvgFrame }
  }
}
