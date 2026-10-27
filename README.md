# agentshot

Product screenshots and demo videos made by your coding agent. An agent (Claude Code or any
other) captures your app, describes the look in a small JSON recipe, and `agentshot` renders a
polished PNG or MP4 into a versioned library: device frames, soft backgrounds, callouts,
zooms, a smooth cursor, cuts.

```
scenario (what to click)  →  capture (browser / desktop window / iOS Simulator / imported file)
recipe   (how it looks)   →  render (headless Chrome + ffmpeg)  →  library/<product>/<asset>/v001.png|mp4
```

Everything runs locally. Captures and renders never leave your machine. The only network
access is `backgrounds search` and the one-time download of a photo or painting background.

## Requirements

- Windows 10/11 or macOS 14+ (macOS support is newer and less tested)
- Node.js 20.11+
- Google Chrome
- ffmpeg and ffprobe in `PATH`
- Windows: PowerShell 7 (`pwsh`) for screen recording and desktop scenarios
- macOS: Xcode Command Line Tools; Screen Recording and Accessibility permissions for the app
  the agent runs in (`node bin/agentshot.mjs doctor --request`)

## Install

```bash
git clone https://github.com/thread-of-ariadne/agentshot.git
cd agentshot
npm install
node bin/agentshot.mjs doctor
```

## Quick start

Capture the bundled demo app and render a still and a video:

```bash
node bin/agentshot.mjs capture examples/scenarios/phone-still.json
node bin/agentshot.mjs capture examples/scenarios/phone-drag.json
node bin/agentshot.mjs render examples/recipes/help-step1.json examples/recipes/drag-video.json
node bin/agentshot.mjs gallery --open
```

Every command prints one JSON line (`{"ok": true, ...}`), so agents can read the result. Open a
recipe in a live preview with a scrubber while you tweak it:

```bash
node bin/agentshot.mjs preview examples/recipes/drag-video.json
```

## Use it from your agent

`agentshot` is built to be driven by an agent. The full guide for agents (workflow, scenario and
recipe formats, tips) is [skill/agentshot/SKILL.md](skill/agentshot/SKILL.md).

- **Claude Code:** `npm run install-skill` installs it as a global skill, so you can ask
  "make a help-center screenshot of the settings page" in any project.
- **Other agents:** point the agent at `skill/agentshot/SKILL.md` (for example from your project's
  `AGENTS.md`) and let it run `node /path/to/agentshot/bin/agentshot.mjs`.

## Commands

`node bin/agentshot.mjs help` prints the full list.

| Command | What it does |
|---|---|
| `capture <scenario.json>` | Runs a scenario: `"url"` drives a web app (or Expo web) in Chrome, `"window"` drives a desktop app with the real mouse and keyboard while recording, `"simulator"` drives the iOS Simulator (macOS) |
| `snap --window "Title" --name x` | A still of a desktop window right now; `snap <capture> --at 12.4` cuts one from a recording |
| `sim snap` / `sim record` | iOS Simulator (macOS): lossless stills and video of the native app |
| `record --name x --window "Title" --duration 10` | Records a window without the cursor and logs the mouse separately |
| `import <file> --name x` | Brings in an existing screenshot or screen recording (e.g. from an iPhone) |
| `inspect <capture>` | Shots, element boxes, clicks, the step timeline and, for videos, pointer moves, screen changes and quiet stretches |
| `frames <capture or product/asset>` | Contact sheet with timestamps, so an agent can look at a video |
| `render <recipe.json> --note "..."` | Renders a recipe into the library as a new version |
| `preview <recipe.json>` | Live preview with a scrubber; reloads when the recipe or `src/` changes |
| `history` / `restore` | Version history; restoring re-renders an old version as a new one |
| `style <product> --init` | Creates a product's default look (`style.json`) and rules (`guidelines.md`) |
| `gallery --open` | Builds and opens `library/index.html` |
| `backgrounds search "black sand dune"` | Finds photo (Unsplash) and painting (museum) backgrounds and prints a numbered contact sheet; a recipe uses one as `"background": "unsplash:<id>"` |

## Features

- **Devices:** iPhone (black, natural, white) with a clean 9:41 status bar, browser window,
  app window, no frame, 3D tilt.
- **Backgrounds:** soft gradient presets with grain, any CSS background, your own photos with blur,
  any Unsplash photo (with your free access key) and public-domain paintings from The Met, the Art
  Institute of Chicago and the Cleveland Museum of Art, found by describing the place.
- **Callouts:** lift (an element floats above the screen), glass loupe, numbered steps, arrows,
  outlines, blur and redaction for private data, titles in a dozen bundled fonts.
- **Smooth capture:** web apps are captured frame by frame (the page clock is paused and
  advanced exactly 1/60 s per frame), so app animations are perfectly smooth at 60 fps.
- **Video:** smooth cursor or iOS touch indicator, click ripples, automatic or manual zooms,
  named cuts with speed-up, a held last frame.
- **Sizes:** 16:9, 16:10, 4:3, 3:2, 1:1, 4:5, 9:16 or any size.
- **Library:** versions with notes, restore, a searchable gallery, a style and guidelines per product.

## Expo and React Native

Capture the web build (`npx expo start --web`) with `"device": "iphone", "safeArea": true` in
the scenario. Add `testID`s to the elements you want to point at: on the web they become
`data-testid`, and scenarios and recipes can refer to them by name. Screens that do not work on
the web can be captured in the iOS Simulator (macOS) or imported from an iPhone recording.

## How rendering works

The scene is a React component ([`src/Scene.tsx`](src/Scene.tsx)) bundled with esbuild. The
renderer opens it in headless Chrome, sets each frame, waits until images and fonts are ready,
takes a screenshot and pipes lossless frames to ffmpeg (libx264, yuv420p, BT.709 limited range,
tagged). Videos render in several tabs in parallel (`AGENTSHOT_CONCURRENCY`). Frames of screen
recordings are extracted exactly with ffmpeg. Fonts are bundled from Fontsource, so rendering
needs no network.

## Project layout

```
bin/agentshot.mjs        CLI
lib/                capture, desktop and simulator scenarios, import, recording, bundling,
                    rendering, preview, gallery
lib/platform/       OS-specific parts (Windows, macOS)
recorder/           win.ps1 and mac.swift: windows, screens, mouse log, input driving
src/                the React scene: devices, backgrounds, overlays, timeline, fonts
skill/agentshot/         the agent guide (installed as a Claude Code skill)
examples/           sample scenarios and recipes
demo-app/           a small demo app the examples capture
library/            output: products → assets → versions (only the demo style is committed)
public/captures/    raw captures (not committed)
```

## Contributing

Contributions are welcome, from people and from agents. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) (architecture, development setup, step-by-step guides for
common extensions). Coding agents working on `agentshot` itself should read [AGENTS.md](AGENTS.md).
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) and report security issues as described
in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Bundled fonts come from [Fontsource](https://fontsource.org) packages under
their own open licences (mostly SIL OFL 1.1). Built on [Playwright](https://playwright.dev),
[React](https://react.dev), [esbuild](https://esbuild.github.io) and [FFmpeg](https://ffmpeg.org)
(installed separately).
