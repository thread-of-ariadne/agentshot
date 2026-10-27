# Changelog

Notable changes to `agentshot`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/). Recipes, scenarios, `capture.json`
and the library layout are the public interface: a change that breaks an existing file is a
major version.

## [Unreleased]

### Added
- Photo and painting backgrounds: `agentshot backgrounds search "<place>"` finds candidates on
  Unsplash (needs a free access key in `AGENTSHOT_UNSPLASH_KEY`) and among public-domain works of
  The Met, the Art Institute of Chicago and the Cleveland Museum of Art (no key), with a numbered
  contact sheet. A recipe uses one as `"background": "unsplash:<id>"` (or `met:`, `artic:`,
  `cleveland:`); the first render downloads it into `public/backgrounds/<source>/`, later renders
  are offline. The credit is stored in the library version, returned by `render` and shown in the
  gallery. `doctor` reports `unsplashKey`.

## [0.1.0] - 2026-10-27

First public release.

### Added
- Capture: browser scenarios with a frame-exact page clock (60 fps), desktop-window scenarios
  that drive the real mouse and keyboard while recording, iOS Simulator scenarios (macOS),
  screen recording with a separate mouse log, import of existing screenshots and videos.
- Recipes: device frames (iPhone, browser, window, none, 3D tilt), backgrounds, lift, loupe,
  steps, arrows, outlines, blur and redaction, titles in bundled fonts, cursor or touch
  indicator, automatic and manual zooms, named cuts with speed, held last frame, screen grade.
- Renderer: the React scene runs in headless Chrome and frames go losslessly to ffmpeg
  (H.264, yuv420p, BT.709 limited range, tagged); videos render in parallel pages
  (`AGENTSHOT_CONCURRENCY`); frames of recordings are extracted by timestamp; fonts are
  bundled, so rendering needs no network.
- `agentshot preview`: live preview with a scrubber that reloads on recipe and `src/` changes.
- Versioned library with notes, restore and a searchable gallery; per-product style and
  guidelines.
- `inspect` and `frames` to look at captures and renders without guessing.
- Agent guide (`skill/agentshot/SKILL.md`, installable as a Claude Code skill), `AGENTS.md` for
  agents changing the tool, `scripts/compare.mjs`, `npm run check`, `npm test` and CI.
