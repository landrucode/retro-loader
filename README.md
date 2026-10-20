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

- Reads the current conversation as it streams (your prompt, Claude's thinking and text, and tool names) to draw the latest lines on the loading screen. It draws them on your screen only.
- Plays the tape sound. On macOS it uses Claude Code's audio playback. On Windows and Linux, where Claude Code has no player, it starts one child process per 20-second loop and passes the clip to it on standard input as base64:
  - Windows: `powershell -NoProfile -NonInteractive -Command` with a fixed script that decodes the clip and plays it with `System.Media.SoundPlayer`.
  - Linux: `sh -c` with a fixed script that decodes the clip with `base64 -d` and pipes it to `paplay`, `pw-play` or `aplay`.
  The process is stopped when Claude's turn ends. The full commands are in `hooks/register.tsx`.
- Reads one environment variable, `OS`, to tell Windows from Linux.
- Makes no network requests, reads or writes no files, and stores no data.

## Licence

MIT.
