# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, …) working on the
`agentshot` codebase itself. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md), which has the same
rules in more depth.

There are two kinds of agent work around this repo:

- **Using `agentshot`** to make screenshots or videos of some app: follow
  [skill/agentshot/SKILL.md](skill/agentshot/SKILL.md). Do not edit this repository for that.
- **Changing `agentshot`** (a fix, a new feature, a new platform): follow this file.

## Setup and commands

```bash
npm install
node bin/agentshot.mjs doctor          # Chrome, ffmpeg, platform tools
npm run check                     # typecheck src/ + syntax check of every .mjs
npm test                          # smoke test: capture the demo app, render a still and a video
node bin/agentshot.mjs preview <recipe.json>   # live preview with a scrubber while you work
node scripts/compare.mjs <libA> <libB>    # SSIM/PSNR between two rendered libraries
```

Rendering needs Google Chrome and ffmpeg/ffprobe in `PATH`. Run renders into a scratch
library so you never touch real output: set `AGENTSHOT_LIBRARY=work/<something>` (`work/` is
gitignored) and copy the product's `style.json` there if the recipe relies on it.

## Map

| Area | Files |
|---|---|
| CLI (every command, help text) | `bin/agentshot.mjs` |
| Web capture (Playwright scenarios) | `lib/capture.mjs` |
| Desktop / iOS Simulator scenarios | `lib/desktop.mjs`, `lib/sim.mjs` |
| Recording, OS specifics | `lib/record.mjs`, `lib/platform/{win,mac}.mjs`, `recorder/win.ps1`, `recorder/mac.swift` |
| Import of files | `lib/import.mjs` |
| Contact sheets, activity | `lib/frames.mjs` |
| Rendering pipeline | `lib/render.mjs`, `lib/bundle.mjs`, `lib/serve.mjs`, `lib/video-frames.mjs` |
| Live preview | `lib/preview.mjs`, `src/preview.tsx` |
| Scene (what a frame looks like) | `src/Scene.tsx`, `src/components/*.tsx` |
| Time and geometry | `src/lib/timeline.ts`, `src/lib/geometry.ts` |
| Recipe and capture formats | `src/lib/types.ts` (`Recipe`, `Capture`, `Annotation`) |
| Render runtime (frame clock, readiness) | `src/runtime.tsx`, `src/index.tsx`, `src/composition.ts` |
| Fonts | `src/fonts.ts` |
| Agent-facing docs (the public contract) | `skill/agentshot/SKILL.md` |

[CONTRIBUTING.md](CONTRIBUTING.md) explains the architecture and has step-by-step guides with
code for the common extensions: background preset, device frame, annotation type, font, recipe
field, scenario step, CLI command. Read the relevant guide before starting.

## Adding a feature that does not exist yet

1. **Check it is really missing.** Search `skill/agentshot/SKILL.md`, `src/lib/types.ts` and
   `bin/agentshot.mjs help`; many looks are reachable with existing fields (`screenGrade` takes any
   CSS filter, `background` any CSS background, `zoom` takes manual segments).
2. **Pick the layer.** Something about *what was captured* (a new step, a new source) belongs in
   capture and changes `capture.json`. Something about *how it looks* belongs in the recipe and
   the scene. Something about *files and versions* belongs in the CLI/library. Do not mix them:
   the scene must not run capture logic, and capture must not know about styling.
3. **Design the interface first**, as the agent who will use it would see it: the recipe field,
   scenario step or command, its default and its error message. Rules:
   - Additive and optional. Absent field = exactly the old output, so every recipe and every
     stored library version (`v001.json` keeps the recipe) re-renders unchanged.
   - Plain JSON, named in the existing style (camelCase, short, like `screenGrade`, `tail`).
   - Positions in screen points or targets (element names), sizes relative to the canvas
     (fractions of `S`, the short side) so every aspect ratio looks right.
   - Times in capture seconds, like `start`/`end` everywhere else.
4. **Implement** in the files the matching CONTRIBUTING guide names. Add the type to
   `src/lib/types.ts` first; TypeScript then shows every place that must handle it.
5. **Document** it in `skill/agentshot/SKILL.md` (that file is all a using agent knows), in
   `README.md` if it is user-visible, and in `CHANGELOG.md` under *Unreleased*. Add or extend an
   example in `examples/` when it is a new capability.
6. **Verify** (next section) and describe the result in the PR with before/after evidence.

If the change needs a decision you cannot make from the code and these docs (a new
dependency, a breaking change to a format, a new platform), stop and ask the maintainer, or
open an issue with the feature-request template (https://github.com/thread-of-ariadne/agentshot/issues/new/choose) instead of guessing.

## Verifying a change

- `npm run check` and `npm test` pass.
- Render the affected examples and **look at the output** (open the PNG; for a video use
  `node bin/agentshot.mjs frames <product>/<asset>` and look at the contact sheet). A passing
  command is not proof that the picture is right.
- Unchanged recipes must stay unchanged: render the examples before and after into two scratch
  libraries and run `node scripts/compare.mjs work/before work/after`. Stills should be
  SSIM 1.0; videos ≥ 0.998 (the encoder can differ slightly between runs). Explain any difference.
- New recipe fields: check 16:9, 4:5 and 9:16, a still and a video, a phone and a desktop capture.
- Renderer changes: also check timing on a 12 s 1080p60 video and keep the output tags
  (`ffprobe`: yuv420p, tv range, bt709).

## Invariants (do not break)

- **One JSON line on stdout per command** (`{"ok": true, ...}` / `{"ok": false, "error": ...}`);
  progress and logs go to stderr. Agents parse stdout.
- **The scene is deterministic**: a pure function of recipe, capture and frame number. No
  `Date`, `Math.random()`, CSS animations or transitions, timers, or effects that change pixels.
  Anything that loads (images, fonts) must be awaited (`<img>` is automatic; otherwise wrap the
  promise in `waitFor()` from `src/runtime.tsx`).
- **Formats are stable**: `capture.json`, recipes and the library layout
  (`library/<product>/<asset>/vNNN.*`) are read by existing users' files. Only add optional fields.
- **Video output**: H.264, yuv420p, limited range, BT.709, tagged. Full-range or untagged video
  looks washed out in players.
- **Screenshots in capture/render go through Playwright's `page.screenshot`** when the page has
  device-scale emulation; a raw CDP capture from a second session drops it.
- **Errors tell the agent what to do**: name the bad value and list the valid ones.
- **Local only**: no telemetry, no network calls at render time, servers bind to 127.0.0.1.

## Boundaries

- Never commit captures, renders or personal libraries (`public/captures/`, `library/*`,
  `work/`, `.cache/`). Use the demo app (`demo-app/`) for examples and tests.
- Never run `npm run install-skill` unless asked: it overwrites the user's global Claude Code skill.
- Do not record or snapshot windows of apps that may show private data (messengers, mail,
  password managers). Use the demo app or the app under test.
- New runtime dependencies must be open source with a licence compatible with MIT and must not
  phone home. Prefer none.
- Keep changes focused: one feature or fix per PR, no drive-by reformatting.

## Code style

- ES modules everywhere. Node code is plain `.mjs` (no build step); the scene is TypeScript/TSX
  (`npx tsc -p .` is strict).
- 2-space indent, single quotes, semicolons, trailing commas; match the surrounding code.
- Comments say why, not what; keep the short file-header comment that explains each module.
- No new abstractions for one use. Small functions near where they are used.
- Commit messages: imperative summary line (≤ 72 chars), body explaining why. One logical
  change per commit.
