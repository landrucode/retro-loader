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

The tape sound is synthesised when the plugin loads, from the Spectrum ROM's loader pulse timings: a pilot tone, a header block naming the program `claude`, a pause, a second pilot tone, then 15 seconds of data. One loop lasts about 20 seconds and plays once per loading cycle, so the stripes stay in step with it.

| Platform | Player |
| --- | --- |
| macOS | Claude Code's own audio playback |
| Windows | Windows PowerShell's built-in `System.Media.SoundPlayer` |
| Linux | `paplay`, `pw-play` or `aplay`, whichever is installed first in that order |

Where Claude Code can play the clip itself, it does. Otherwise the plugin hands the clip to the platform's player. If Linux has none of the three installed, a toast says so and the stripes run silently. Installing `pulseaudio-utils`, `pipewire` or `alsa-utils` adds one.

## What it does on your machine

- **Reads the conversation, for display only.** It reads your prompt, Claude's thinking and text, and tool names as they stream, and draws the latest lines on the loading screen. That text stays inside the plugin and on your screen. It is never passed to a program, written to a file, stored or sent anywhere.
- **Plays a sound it generates itself.** The tape sound is built from fixed timing values when the plugin loads. On macOS it plays through Claude Code's audio playback.
- **Starts a local audio player on Windows and Linux, and why.** Claude Code has no audio player on those platforms, so the plugin starts the platform's own one, once per 20-second loop. The only data it passes out is the generated sound clip, as base64 on the player's standard input. The player is stopped when Claude's turn ends.
  - Windows: `powershell -NoProfile -NonInteractive -Command` with a fixed script that decodes the clip and plays it with `System.Media.SoundPlayer`.
  - Linux: `sh -c` with a fixed script that decodes the clip with `base64 -d` and pipes it to `paplay`, `pw-play` or `aplay`, whichever is installed.
  The full commands are fixed text in `hooks/register.tsx`.
- **Reads one environment variable,** `OS`, to tell Windows from Linux.
- **Makes no network requests,** reads or writes no files, and stores no data.

## Licence

MIT.
