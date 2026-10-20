# retro-loader

A ZX Spectrum tape-loading screen that runs while Claude works.

When a turn starts, a band appears above the prompt with the Spectrum's loading border: red and cyan pilot stripes, then flickering blue and yellow data stripes. The tape sound plays alongside, built from the Spectrum ROM's pulse timings. Inside the border, white paper shows `Program: claude` followed by the latest prompt, thinking, text and tool calls, each in a Spectrum ink colour. Clawd loads beside the text, pixel line by pixel line, in the order a real Spectrum fills its screen.

The band hides when the turn ends.

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install retro-loader --marketplace landrucode/retro-loader
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```bash
claude plugin install retro-loader --marketplace landrucode/retro-loader
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `landrucode/retro-loader`, then Add plugin.

## Where it shows

| Surface | View |
| --- | --- |
| Terminal | Band above the prompt, drawn in character cells |
| Desktop app | Band above the prompt, drawn as SVG |
| VS Code extension | Band above the prompt, drawn as SVG |

## Sound

The clip is `sounds/load.wav`, about 20 seconds long, played once per loading cycle so the stripes stay in step with it. On a surface with no audio player the stripes run silently.

## Regenerating the sound

`tools/make-wav.mjs` writes `sounds/load.wav` and `hooks/timeline.ts`, the start time of each part of the clip. Run it from the plugin folder:

```bash
node tools/make-wav.mjs
```

## Licence

MIT.
