# Contributing to agentshot

`agentshot` turns a capture of an app into styled screenshots and demo videos. An agent (or a
person) runs the CLI, writes a JSON recipe, and gets a PNG or MP4 in a versioned library.
This guide explains how the pieces fit and walks through the most common extensions.

Thanks for helping. This project follows a [Code of Conduct](CODE_OF_CONDUCT.md); by
taking part you agree to it.

## Ways to contribute

- **Report a bug** with the bug-report issue template. Include `node bin/agentshot.mjs doctor`
  output, your OS, the command, the full JSON it printed and, if you can, the recipe or
  scenario. Strip anything private from captures before attaching them (captures are
  screenshots of real apps).
- **Ask for a feature** with the feature-request template: describe the screenshot or video
  you are trying to make, not only the mechanism, and include the recipe you wish you could
  write. That lets us find the smallest addition that fits the format.
- **Improve the docs**, especially [skill/agentshot/SKILL.md](skill/agentshot/SKILL.md): agents only
  know what it says, so unclear wording there produces bad screenshots.
- **Send a pull request**. For anything bigger than a small fix (a new recipe field, a new
  platform, a dependency, a change to a file format) open an issue first so we can agree on
  the interface before you write code.
- **Security issues** go through private reporting, not public issues: see [SECURITY.md](SECURITY.md).

## Contributing with an AI agent

Agent-written contributions are welcome. Point your agent at [AGENTS.md](AGENTS.md): it has
the setup, the map of the code, the workflow for adding a missing feature, how to verify a
change and the rules it must not break. You are responsible for what you submit: read the
diff, run the checks, look at the rendered output yourself, and say in the PR that an agent
helped. PRs that clearly were not reviewed by a person are closed.

## Setup

Requirements: Windows 10/11 or macOS 14+, Node 20.11+, Google Chrome, ffmpeg/ffprobe in
`PATH` (Windows: PowerShell 7 for recording and desktop scenarios; macOS: Xcode command line
tools).

```bash
git clone <your fork> agentshot
cd agentshot
npm install
node bin/agentshot.mjs doctor
npm run check      # typecheck + syntax check
npm test           # smoke test: captures the demo app, renders a still and a video
```

## Architecture

```
scenario.json ──► lib/capture.mjs ─┐   (web app, Playwright)
              ──► lib/desktop.mjs ─┤   (native window: record + platform driver)
              ──► lib/sim.mjs     ─┤   (iOS Simulator, macOS)
agentshot record   ──► lib/record.mjs  ─┼──► public/captures/<name>/capture.json + frames / shots / video
agentshot import   ──► lib/import.mjs  ─┘                     │
                                                         ▼
recipe.json (agent) + library/<product>/style.json ──► lib/render.mjs
                                                         │  bundles src/ (lib/bundle.mjs, esbuild)
                                                         │  serves bundle + public/ (lib/serve.mjs)
                                                         ▼
                                   headless Chrome: src/index.tsx renders src/Scene.tsx at frame n
                                                         │  screenshot per frame (PNG)
                                                         ▼
                                   PNG still, or ffmpeg (libx264, yuv420p, BT.709 limited) ──► MP4
                                                         ▼
                                   library/<product>/<asset>/v001.png|mp4 + v001.json, latest.*
```

1. **Capture** writes `public/captures/<name>/capture.json` (type `Capture` in
   [`src/lib/types.ts`](src/lib/types.ts)): viewport and scale, frames with timestamps
   (`f00000.jpg`…) or a `video`, still `shots` with element boxes, the pointer path and clicks.
   - `lib/capture.mjs` drives a web app with Playwright. In the default `"timing": "frame"`
     the page clock is paused and advanced 1/60 s per screenshot, so app animations are exact.
   - `lib/record.mjs` records a window with ffmpeg and logs the mouse; the OS-specific parts
     live in `lib/platform/` (`recorder/win.ps1` on Windows, `recorder/mac.swift` on macOS).
   - `lib/desktop.mjs` runs the same scenario steps against a native window, and
     `lib/sim.mjs` against the iOS Simulator.
   - `lib/import.mjs` brings in an existing PNG/JPEG or video.
   - `lib/frames.mjs` (`agentshot frames`, `agentshot inspect`) makes contact sheets and activity
     summaries of captures and renders, for planning cuts and checking results.
2. **Recipe** (type `Recipe`) says how to style one asset. `resolveRecipe()` in
   [`lib/render.mjs`](lib/render.mjs) merges the product's `style.json` defaults under it
   and expands `size` to `width`/`height`.
3. **Scene** ([`src/Scene.tsx`](src/Scene.tsx)) is a React component that draws the recipe
   at one frame: background, device frame, the captured screen, annotations, lift, loupe,
   pointer and canvas text. It is a pure function of `(recipe, capture, frame)`: no timers,
   no effects, no randomness. Everything time-based goes through
   [`src/lib/timeline.ts`](src/lib/timeline.ts) (output time → capture time through cuts,
   camera zoom, pointer position) and everything positional through
   [`src/lib/geometry.ts`](src/lib/geometry.ts) (screen points → canvas pixels).
4. **Runtime** ([`src/runtime.tsx`](src/runtime.tsx)) is the small layer the scene renders
   on: `FrameProvider`, `useCurrentFrame()`, `useVideoConfig()`, `AbsoluteFill`, and
   `waitFor()` / `frameReady()`, which hold a frame until its images are decoded and fonts
   are loaded. [`src/composition.ts`](src/composition.ts) computes canvas size, fps and
   length from a recipe.
5. **Renderer** ([`lib/render.mjs`](lib/render.mjs)) bundles `src/` into `.cache/bundle`
   (rebuilt only when `src/` or dependencies change), serves it with `public/` on a local
   port and opens headless Chrome. The page exposes `window.shot` (see
   [`src/index.tsx`](src/index.tsx)): `load(recipe)` and `frame(n)`.
   - **Stills** render frame 0 at 2× device scale (canvases under 2000 px wide) and save a PNG.
   - **Videos** open several pages (half the CPU threads, max 8; `AGENTSHOT_CONCURRENCY`
     overrides). Each takes the next frame number, renders it, screenshots it as PNG;
     frames are piped to ffmpeg in order.
   - **Video sources** (screen recordings, imported clips) are not played in the page. The
     page tells Node which source frames the recipe shows (`shot.videoFrames()`), ffmpeg
     extracts exactly those into `.cache/frames/<capture>-<hash>/<n>.png`
     ([`lib/video-frames.mjs`](lib/video-frames.mjs)), and the scene shows frame *n* as an image.
6. **Library**: each render adds `vNNN.png|mp4` and `vNNN.json` (the original recipe, note,
   author) and copies `latest.*`. `history`, `restore`, `list` and `gallery`
   ([`lib/gallery.mjs`](lib/gallery.mjs)) only read these files.

`bin/agentshot.mjs` is the CLI. Every command prints exactly one JSON line on stdout
(`{"ok": true, ...}` or `{"ok": false, "error": ...}`) so agents can parse it; progress goes
to stderr. The agent-facing documentation is [`skill/agentshot/SKILL.md`](skill/agentshot/SKILL.md).

### Rules the scene follows

- **Deterministic.** The same recipe and frame must produce the same pixels. Derive
  everything from `useCurrentFrame()`; never use `Date`, `Math.random()`, CSS
  animations/transitions or `useEffect` to change what is drawn.
- **Scale with the canvas.** Sizes in canvas pixels derive from `S = min(W, H)` (labels,
  shadows, steps) or from `L.k` (canvas px per screen point, for anything attached to the
  screen), so 4:5, 9:16 and 16:9 look alike.
- **Everything visible must be awaited.** Plain `<img>` elements are awaited automatically.
  If you add anything else that loads (a font, an SVG image, a fetch), wrap its promise in
  `waitFor()` or the frame may be captured before it arrives.
- **Fail loudly.** Throw an `Error` with a message that tells the agent what to fix (the
  unknown target and the known names, the allowed values). The renderer reports it as
  `{"ok": false, "error": ...}`.

## Developing

```bash
node bin/agentshot.mjs capture examples/scenarios/phone-still.json     # demo captures
node bin/agentshot.mjs capture examples/scenarios/phone-drag.json
node bin/agentshot.mjs capture examples/scenarios/desktop-filter.json
node bin/agentshot.mjs preview examples/recipes/help-step1.json         # live preview with scrubber
node bin/agentshot.mjs render examples/recipes/help-step1.json --note "testing"
npm run check                                                      # typecheck + syntax check
npm test                                                           # end-to-end smoke test
```

`agentshot preview <recipe.json>` opens a local page with the scene, a scrubber (←/→ step a
frame, Shift+←/→ a second, Space plays) and cut markers. It re-reads the recipe and the
product's `style.json` when they change and rebuilds and reloads when `src/` changes, so keep
it open while you work. It shows the same frames a render produces, scaled to the window.

To check a change to the scene or renderer did not shift existing output, render the
examples into a scratch library before and after and compare:

```bash
$env:AGENTSHOT_LIBRARY = "work/before"; node bin/agentshot.mjs render examples/recipes/*.json
# ... make your change ...
$env:AGENTSHOT_LIBRARY = "work/after";  node bin/agentshot.mjs render examples/recipes/*.json
node scripts/compare.mjs work/before work/after --frames 0,120,240
```

`compare.mjs` prints SSIM/PSNR per still and mean/worst-frame SSIM, frame counts, fps,
duration and colour tags per video. Unchanged output scores SSIM 1.0. Copy the product's
`style.json` into the scratch library too (`work/before/daybook/style.json`), otherwise
style defaults are not applied. `public/captures/`, `library/` (except the demo product's
style) and `work/` are gitignored; never commit captures or renders.

## Recipes for common extensions

Each recipe lists the files to touch, a minimal example and how to test it. After any
change to recipe fields, update the `Recipe` type in `src/lib/types.ts` and the recipe
section of `skill/agentshot/SKILL.md`: that file is all the agent knows about the format.

### Add a background preset

Files: [`src/components/Background.tsx`](src/components/Background.tsx) (`PRESETS`),
`skill/agentshot/SKILL.md` (the `"background"` line in the recipe example).

A preset is any CSS `background` value, usually a few soft radial gradients over a base
colour. The grain overlay is added on top by `Background`.

```tsx
export const PRESETS: Record<string, string> = {
  // ...
  sand:
    'radial-gradient(60% 70% at 20% 25%, #fbf3e4 0%, transparent 70%), radial-gradient(60% 65% at 85% 80%, #ecd9bd 0%, transparent 70%), #f3e6d2',
};
```

Test: set `"background": "sand"` in a copy of `examples/recipes/help-step1.json` and open
it with `agentshot preview`. Check a dark preset with white text and a light one with dark text.

### Add a device frame

Files: [`src/lib/geometry.ts`](src/lib/geometry.ts) (`layout()`: chrome size around the
screen), [`src/components/Device.tsx`](src/components/Device.tsx) (`DeviceBack`, drawn
behind the screen; add an overlay component if the frame covers the screen like the
Dynamic Island), [`src/Scene.tsx`](src/Scene.tsx) (screen corner radius / overlay),
`Recipe['device']` in `src/lib/types.ts`, `skill/agentshot/SKILL.md`.

`layout()` expresses the device's outer size as `a·k × b·k`, where `k` is canvas pixels
per screen point, and the screen's offset inside it as `left·k, top·k`; it then picks the
largest `k` that fits the padded canvas. A tablet with a uniform 18-point bezel:

```ts
// geometry.ts
export const TABLET = { bezel: 18, screenRadius: 18 };
// in layout(), next to the iPhone branch
} else if (device === 'ipad') {
  a = vw + 2 * TABLET.bezel;
  b = vh + 2 * TABLET.bezel;
  left = top = TABLET.bezel;
}
// and the radius line
const radius = device.startsWith('iphone') ? IPHONE.screenRadius * k : device === 'ipad' ? TABLET.screenRadius * k : ...;
```

```tsx
// Device.tsx, in DeviceBack
if (device === 'ipad') {
  const R = (TABLET.screenRadius + TABLET.bezel) * k;
  return (
    <div
      style={{
        position: 'absolute', left: outer.x, top: outer.y, width: outer.w, height: outer.h,
        borderRadius: R, background: '#1b1b1e',
        boxShadow: `0 ${30 * k}px ${80 * k}px rgba(30,20,60,.25)`,
      }}
    />
  );
}
```

Test: capture with `"device": "ipad"` in a scenario (see `DEVICES` in `lib/capture.mjs`),
render a still with `"device": "ipad"` at 16:10 and 4:5, and a video with `"zoom": "auto"`
to see the frame under the camera. Check that lift, loupe and annotations still land on
the right elements (they use `L.screen`, so they do if `layout()` is right).

### Add an annotation type

Files: `Annotation` union in [`src/lib/types.ts`](src/lib/types.ts),
[`src/components/Overlays.tsx`](src/components/Overlays.tsx) (`ScreenAnnotations` for things
on the screen that move with the camera, `CanvasText` for things fixed to the canvas),
`skill/agentshot/SKILL.md` (the `annotations` list).

Annotations get `start`/`end` (capture seconds) for free through `presence()`, which also
fades them; stills always show them fully. A "badge" pill pinned to an element:

```ts
// types.ts, inside the Annotation union
| { type: 'badge'; text: string; target: Target; anchor?: [number, number]; color?: string }
```

```tsx
// Overlays.tsx, inside ScreenAnnotations' map, before `return null`
if (a.type === 'badge') {
  const pt = toCanvas(L, resolvePoint(a.target, elements, ctx.cap, a.anchor ?? [1, 0]));
  return (
    <div
      key={i}
      style={{
        position: 'absolute', left: pt.x, top: pt.y, transform: 'translate(-50%, -50%)',
        background: a.color ?? accent, color: '#fff', fontFamily: 'Inter', fontWeight: 700,
        fontSize: S * 0.018, padding: `${S * 0.004}px ${S * 0.01}px`, borderRadius: S, opacity: o,
      }}
    >
      {a.text}
    </div>
  );
}
```

Test: add `{ "type": "badge", "text": "New", "target": "birthday" }` to a copy of
`examples/recipes/help-step1.json`; render it as a still, and in a video recipe with
`start`/`end` scrub through the fade in `agentshot preview`. Run `npx tsc -p .`: the union makes
TypeScript check every field you read.

### Add a font

Files: `package.json` (an `@fontsource` package), [`src/fonts.ts`](src/fonts.ts),
`skill/agentshot/SKILL.md` (the `"font"` line).

Fonts are bundled from [Fontsource](https://fontsource.org) (open licences, mostly OFL), so
renders never need the network. Use `@fontsource-variable/<name>` when the family is
variable on Google Fonts and `@fontsource/<name>` with one CSS file per weight when it is not.
The bundler renames `"X Variable"` to `"X"`, so recipes use the plain family name. This is how
Gilda Display (one static weight) and Caveat (variable) were added:

```bash
npm install @fontsource/gilda-display @fontsource-variable/caveat
```

```ts
// fonts.ts
import '@fontsource/gilda-display/400.css';
import '@fontsource-variable/caveat/wght.css';

const FONTS: Record<string, string[]> = {
  // family -> weights to load before the first frame
  Caveat: ['400', '500', '600', '700'],
  'Gilda Display': ['400'],
  // ...
};
```

List only weights the family has: a missing weight is synthesised by the browser (faux
bold). Each import brings every subset the package ships (Latin, Cyrillic, ...); the
browser downloads a subset only when text uses it.

Test: render a still with a `text` annotation in the new font (`"font": "Gilda Display"`)
at weights 400 and 700, and with Latin and Cyrillic text. Open the PNG and check it is the
right face, not a fallback.

### Add a recipe field (e.g. a screen grade)

Files: `Recipe` in [`src/lib/types.ts`](src/lib/types.ts), the component that uses it
(usually [`src/Scene.tsx`](src/Scene.tsx)), `skill/agentshot/SKILL.md`. Product defaults in
`style.json` apply to new fields automatically (`resolveRecipe` deep-merges them).

`screenGrade` is the model: a few named looks plus raw CSS for anything else.

```ts
// types.ts, in Recipe
// colour grade for the captured screen: 'vivid', 'rich' or a CSS filter, e.g. 'contrast(1.06) saturate(1.1)'
screenGrade?: string;
```

```tsx
// Scene.tsx
const GRADES: Record<string, string> = {
  vivid: 'contrast(1.06) saturate(1.12)',
  rich: 'contrast(1.1) saturate(1.18) brightness(0.98)',
};
// ...
const grade = GRADES[recipe.screenGrade ?? ''] ?? recipe.screenGrade ?? '';
// and on <Screen style={{ filter: grade || undefined }} />
```

Keep the default (field absent) identical to the old output, so existing recipes and
library versions re-render the same. Validate values that can only be one of a few and
throw a helpful error otherwise.

Test: render an existing example with and without the field and compare with
`scripts/compare.mjs` (without it, SSIM must be 1.0); look at the version with it.

### Add a capture scenario step

Files: [`lib/capture.mjs`](lib/capture.mjs) (the `for (const s of sc.steps)` loop in
`runScenario`), `skill/agentshot/SKILL.md` (the scenario example).

A step is an object whose key names it. Time must pass through `advance(seconds)` (or
`tick()` / `stepFrame()`), never `page.waitForTimeout`, so frame mode stays exact; move the
pointer through `moveTo()` so the rendered cursor follows; push to `clicks` for anything the
auto-zoom and click ripples should see. A `hover` step that moves to a target and rests:

```js
} else if (s.hover != null && s.hover !== true) {
  await moveTo(s.hover, s.duration ?? 0.6);
  await advance(s.rest ?? 0.8);
  log();
}
```

(Place it before the final `else`, which rejects unknown steps; note `move` already uses
`s.hover` as a flag, hence the `!== true`.)

Test: add the step to a copy of `examples/scenarios/desktop-filter.json`, run
`agentshot capture`, check `agentshot inspect` (duration, clicks) and render a video of it; run the
scenario with `"timing": "real"` and `"timing": "step"` too.

### Add a CLI command

Files: [`bin/agentshot.mjs`](bin/agentshot.mjs) (`HELP` text and the `switch`), the module that does
the work in `lib/`, `README.md` (command table), `skill/agentshot/SKILL.md` if agents should use it.

Commands parse with `parseArgs` (`pos` positional, `opt` for `--flags`), import their module
lazily so `agentshot help` stays fast, and end with `done({...})`. Throwing is fine: the outer
`try` turns it into `{"ok": false, "error": ...}`. A command that deletes old versions:

```js
// HELP
  prune <product> <asset> --keep <n>     delete all but the newest n versions

// switch
case 'prune': {
  const { history, assetDir } = await import('../lib/render.mjs');
  const keep = Number(opt.keep ?? 5);
  const old = history(pos[0], pos[1]).slice(0, -keep);
  for (const v of old) {
    for (const f of [v.output, `v${String(v.version).padStart(3, '0')}.json`]) fs.rmSync(path.join(assetDir(pos[0], pos[1]), f), { force: true });
  }
  done({ removed: old.map((v) => v.version) });
  break;
}
```

Test: run it against a scratch library (`$env:AGENTSHOT_LIBRARY = "work/scratch"`), check the
single JSON line, the error case (`agentshot prune nope nope`) and `agentshot gallery` afterwards.

## Pull requests

1. Fork, then branch from `main` with a short descriptive name (`add-badge-annotation`,
   `fix-vfr-recordings`).
2. Keep the PR to one feature or fix. Commits: an imperative summary line of at most 72
   characters (`Add badge annotation`), a body that explains why.
3. Before opening it:
   - `npm run check` and `npm test` pass.
   - You rendered the examples you touched and looked at them. If output pixels change on
     purpose, attach before/after images; if they should not change, attach the
     `scripts/compare.mjs` result (stills SSIM 1.0).
   - New recipe fields, scenario steps and commands are documented in
     `skill/agentshot/SKILL.md` and, if user-visible, `README.md`; the `CHANGELOG.md`
     *Unreleased* section has a line for the change.
   - Existing recipes, captures and library versions still work unchanged (formats only grow
     optional fields).
4. Fill in the PR template. A maintainer reviews, may ask for changes, and squash-merges.

The scene must stay deterministic and the default output unchanged unless the change is the
point. Nothing in a PR may contain captures or renders of private apps.

## Licensing

By contributing you agree that your contribution is licensed under the project's
[MIT License](LICENSE). Only add dependencies and assets (fonts, images) under licences that
are compatible with it, and name the licence in the PR.
