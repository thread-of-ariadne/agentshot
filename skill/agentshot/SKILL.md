---
name: agentshot
description: Make product screenshots and demo videos on Windows and macOS - capture a web app / Expo web app / desktop window / iOS Simulator / iPhone file, then style it (background, iPhone/browser/window frame, lift, loupe, arrows, steps, blur, zoom, cursor, cuts) and render PNG or MP4 into a versioned library. Use when the user asks for screenshots, mockups, help-center images, changelog pictures, social posts (X/Instagram), demo/B-roll videos or screen recordings of their app.
---

# agentshot: screenshots and demo videos

<!-- `npm run install-skill` replaces the placeholder path below with the checkout's real path. -->
The tool lives in `/path/to/agentshot`. Run it as:

```bash
node /path/to/agentshot/bin/agentshot.mjs <command> ...
```

Below, `agentshot` means that command. Every command prints one JSON line (`"ok": true|false`). Long renders also print progress on stderr.
Run `agentshot help` for the command list.

## Workflow

1. **Read the product's rules first**: `agentshot style <product>` prints `style.json` (default look) and
   `guidelines.md` (what the user likes). Follow them. If the product is new, run `agentshot style <product> --init`.
2. **Capture** (pick one):
   - Web app or Expo app → write a scenario JSON with `"url"`, run `agentshot capture scenario.json`.
   - iOS app on a Mac → a scenario with `"simulator"` (the real native app in the iOS Simulator, see
     "iOS Simulator"); a quick still → `agentshot sim snap --name <capture> --clean-status-bar`.
   - Desktop program → a scenario with `"window"`: you drive the real mouse/keyboard while it records
     (see "Desktop app"). Just a still → `agentshot snap --window "<title>" --name <capture>`.
     The user performs the actions → `agentshot record start/stop`.
   - The user already has a file (iPhone screenshot / screen recording) → `agentshot import <file> --name <capture>`.
3. **Inspect**: `agentshot inspect <capture>` lists shots, element boxes (screen points), clicks, duration and,
   for videos, `moves` (pointer travel), `changes` (page switches: big visual jumps), `quiet` (nothing moves:
   cut or speed up) and the scenario `timeline`. Plan cuts and zooms from these numbers, then confirm with
   `agentshot frames <capture> --from a --to b` (a contact sheet with timestamps; Read the PNG it prints).
   Look at the shot PNG with the Read tool before styling.
4. **Write a recipe** JSON and `agentshot render recipe.json --note "<what changed>"`.
5. **Check the result yourself**: Read the PNG; for MP4, `agentshot frames <product>/<asset>` (whole video) and
   `agentshot frames <product>/<asset> --from 3 --to 4 --every 0.033 --crop x,y,w,h` (frame by frame around a cut
   or click). Fix and re-render (a new version is added).
   When the user wants to scrub or tweak a recipe themselves, run `agentshot preview recipe.json` in the
   background: it opens a local page with the scene and a scrubber and updates live when the recipe
   (or the product's `style.json`) is edited. It prints one JSON line with the `url` and keeps serving.
6. **Report** the output path (`results[].output`). `--copy-to <dir>` also copies it into the user's project.
7. **Learn**: when the user corrects or praises something, append a dated line to the product's
   `guidelines.md` (and update `style.json` defaults if it is a default look). Read it next time.

Keep scenarios and recipes in the user's project (e.g. `docs/shots/`) so they can be re-run after UI changes.

## Scenario (capture a web app)

Comments in the JSON examples below are explanations only; real files must be plain JSON.

```json
{
  "name": "ellie-today-drag",          // capture name, unique; prefix with the product
  "url": "http://localhost:8081",       // or a file path
  "device": "iphone",                   // iphone | iphone-max | ipad | desktop | laptop
  "safeArea": true,                     // Expo/RN web: Chrome reports iPhone safe-area insets, the app lays out
                                        // like on a device ("pad" = force padding for apps that ignore insets)
  "css": "[class*='navigationMenuRoot'] { display: none }",  // hide web-only chrome (Expo Router tabs render as a top menu on web)
  "waitFor": "today-list",              // wait for this element before starting
  "track": { "row": "text=Plan a birthday" },  // extra named element boxes to record
  "steps": [
    { "shot": "main" },                                  // full-res still (for screenshots)
    { "wait": 0.6 },
    { "tap": "add-button" },                             // click/tap a target (moves there first)
    { "type": "Buy milk", "into": "title-input" },
    { "press": "Enter" },
    { "drag": "task-birthday", "to": "slot-11am", "duration": 1.4 },
    { "scroll": 400, "duration": 0.8 },
    { "move": [200, 300], "duration": 0.6 },
    { "goto": "/settings" },
    { "waitFor": "settings-title" },
    { "shot": "after" }
  ]
}
```

Targets: a bare name matches `data-shot="..."` or `data-testid="..."` (React Native `testID` becomes
`data-testid` on web, so add `testID`s to the elements you want to point at), or any Playwright
selector (`text=Save`, `role=button[name="Save"]`, `#id`, `.class`), or `[x, y]` in CSS px.
All elements with `data-shot`/`data-testid` are recorded with their boxes, plus `track` entries.

Timing: by default (`"timing": "frame"`) the page clock is paused and advanced exactly one frame
at a time (60 fps) with a full-resolution screenshot per frame, so app animations are smooth at
any resolution; capture takes a few times longer than the scenario. Use `"timing": "real"` only if
the app breaks under a controlled clock (a step then times out). `agentshot capture` reports click times
(`clicks`) to plan `cuts`/`zoom`, and console errors/warnings (`console`). Dev overlays (Expo LogBox
toast, Next.js indicator) are hidden; `"devOverlays": true` keeps them.
Prefer one continuous `cuts` segment over several hard cuts: jumps between segments look jerky.

**Finding targets in an app without testIDs**: open the page with Playwright and list buttons/inputs
(`role`, `aria-label`, text), then use `text=...`, `role=button[name=/^My daughter/]` or
`[aria-label='Your prayer']`, and name boxes you want to lift/loupe through `track`.
Typing into a field covered by a sticky footer still works (the field gets focus).

**Expo**: start the web build first (`npx expo start --web`, usually http://localhost:8081). Native-only
modules may not work on web; if a screen breaks, ask the user for an iPhone screenshot/recording and `import` it.

## Desktop app (scenario with "window")

`agentshot windows` lists windows (title, process, size). The window is matched by title, then by process name,
restored if minimized and brought to the front. Coordinates are window pixels: look at a still first
(`agentshot snap --window "X" --name x-probe`, Read the PNG) and name the boxes you use in `track`.

```json
{
  "name": "notes-tour",
  "window": "Notes",                              // title part or process name
  "track": { "nav-recent": [20, 200, 190, 40], "nav-search": [20, 96, 190, 40], "content": [232, 40, 1030, 650], "profile": [16, 718, 150, 62] },
  "cursor": [1000, 330],                          // where the pointer starts
  "steps": [
    { "shot": "home" },                           // still = the recorded frame at this moment
    { "wait": 1 },
    { "click": "nav-recent", "duration": 0.9 },   // glide there (eased, slight arc), click at once
    { "waitStill": 0.6, "region": "content" },    // wait for the screen to change, then to settle
    { "shot": "recent" },
    { "wheel": 4, "at": [760, 460] },             // scroll 4 notches down (negative = up)
    { "click": "nav-search" }, { "press": "ctrl+a" },
    { "type": "Weekly plan", "cps": 12 },         // any text, non-Latin scripts included
    { "press": "Enter" },                         // keys: enter esc tab space backspace delete arrows home end f1..f12, ctrl/alt/shift/win+x
    { "drag": [100, 300], "to": [400, 300], "duration": 1.2 },
    { "click": [640, 400], "button": "right" }, { "click": [640, 400], "double": true },
    { "note": "beat 2" }                          // marker in the timeline
  ]
}
```

- The result has `timeline` (each step's start/end in video seconds, `at` = click moment) and `shots`
  (stills cut from the video). Recipes use `track` names as targets (`"blur"` on `"profile"` etc.).
- `waitStill` first waits (up to `changeTimeout`, 3 s) until the region differs from how it was (`change`, mean
  pixel difference, default 6; `"change": false` to only let it settle), then until nothing changed for the given
  seconds (`threshold` 0.6). Use a `region` without animated parts (players, live backgrounds).
- Click right after arriving: a cursor resting on a control ~0.5 s makes Windows tooltips flash into the video.
- Fields that keep old text: `press ctrl+a` before `type`.
- The driver starts before the recording (it needs a few seconds) and moves the real cursor: do not use the
  machine meanwhile. Desktop captures are 1x, so a loupe looks soft; prefer `lift`.
- Stills at any time of a recording: `agentshot snap <capture> --at 12.4 --shot name`.

- Small changes (a popup closing) may not reach `change` over the whole window: give `region` around them.
- Shortcuts: `mod` is Ctrl on Windows and Cmd on macOS (`"press": "mod+a"`), so one scenario runs on both.

Manual recording (the user does the actions; the cursor is logged and drawn by the renderer):

```bash
agentshot record --name app-filter --window "Figma" --duration 12   # records 12 s, then stops
agentshot record start --name app-filter --window "Figma"           # or start ...
agentshot record stop                                               # ... and stop later
```

## macOS

Same commands and scenarios as on Windows; recorder/mac.swift is compiled on first use (needs the Xcode
Command Line Tools and macOS 14+). Run `agentshot doctor` first: the app that runs the agent (Terminal, iTerm,
Claude, VS Code) needs **Screen Recording** and **Accessibility** in System Settings > Privacy & Security
(`agentshot doctor --request` opens the prompts; restart that app after granting). Without Screen Recording window
titles are just app names and recording fails; without Accessibility the driver cannot click or type.

- Coordinates (`track`, steps, recipe targets) are **points**; stills and video are at the display's pixel
  scale (2 on Retina, `inspect` shows `scale`), so lifts and zooms stay sharp.
- ScreenCaptureKit records the window itself: it may be partly covered, but must not be minimized.
- `node scripts/selftest-mac.mjs` checks everything on TextEdit (and the simulator if one is booted) and
  prints what failed. Sync check: `agentshot record ... --show-cursor` burns the real cursor in; compare it with
  the logged pointer (`agentshot frames` vs `inspect`) like any recording.

## iOS Simulator (macOS)

The native app instead of its web build: real fonts, native modules, iOS animations. Boot a simulator
(`open -a Simulator`), run the app in it (`npx expo run:ios` or a dev build), then:

```bash
agentshot sim devices                                       # booted simulators
agentshot sim snap --name app-home --clean-status-bar       # lossless still, 9:41 / full battery
agentshot sim record start --name app-flow                  # someone else drives ...
agentshot sim record stop
```

A scenario drives it with idb (`brew install facebook/fb/idb-companion`, `pipx install fb-idb`); coordinates
are device points (Read a `sim snap` and divide its pixels by `scale`):

```json
{
  "name": "app-onboarding",
  "simulator": "booted",                        // or a UDID or part of the device name
  "statusBar": "clean",                         // 9:41 during the capture, cleared after
  "appearance": "light",                        // or "dark"
  "openUrl": "exp://127.0.0.1:8081/--/today",   // deep link before recording (or "launch": "<bundle id>")
  "track": { "add": [330, 760, 48, 48], "title": [24, 120, 340, 44] },
  "steps": [
    { "shot": "today" },
    { "tap": "add" },
    { "waitStill": 0.5 },
    { "type": "Buy milk" },                      // into the focused field
    { "press": "enter" },                        // enter esc backspace tab space arrows home lock
    { "swipe": [200, 600], "to": [200, 250], "duration": 0.4 },
    { "openUrl": "exp://127.0.0.1:8081/--/settings" },
    { "waitStill": 0.6 },
    { "shot": "settings" }
  ]
}
```

Stills are lossless simulator screenshots; taps and swipes become the touch pointer and clicks, so recipes
use `"pointer": "touch"` and `"device": "iphone-black"` as for browser captures. Without idb only
`wait`/`waitStill`/`agentshot`/`openUrl`/`launch` steps work.

## Recipe (style and render)

```json
{
  "name": "today-drag",                 // asset name in the library
  "product": "ellie",                   // library folder; style.json defaults apply
  "capture": "ellie-today-drag",
  "shot": "main",                       // set for a PNG still; omit for an MP4 video
  "size": "16:9",                       // 16:9 16:10 4:3 3:2 1:1 4:5 9:16, or width/height
  "background": "lavender",             // lavender peach sage sky rose mint neutral midnight ink white,
                                        // any CSS colour/gradient, or an image under public/ (backgrounds/x.jpg)
  "backgroundBlur": 0.02,               // for photo backgrounds, share of the short side
  "device": "iphone-black",             // iphone-black iphone-natural iphone-white browser window none
  "url": "app.ellie.so/today",          // browser bar text;  "title": window title for "window"
  "padding": 0.08, "tilt": 12,          // device margin; 3D tilt in degrees
  "position": [0.69, 0.5],              // device centre on the canvas, leaves room for a title beside it
  "accent": "#6d5ce8",                  // colour of steps, outlines, labels, click ripples
  "font": "Gilda Display", "labelFont": "Inter",  // titles / lift labels: Inter Manrope Poppins Nunito Fraunces Lora
                                        // "Playfair Display" "DM Serif Display" "Gilda Display" "Cormorant Garamond" Caveat
  "lift":  { "target": "task-row", "label": "Drag it onto your day", "start": 3.9, "pad": 10, "dim": 0.1 },
  "loupe": { "target": "label-chip", "anchor": [0.2, 0.5], "zoom": 2.3, "size": 0.12, "offset": [-0.15, 0.12] },
  "annotations": [
    { "type": "step", "n": 1, "target": "add-button" },
    { "type": "arrow", "to": "add-button", "fromCanvas": [0.75, 0.3], "curve": 0.3, "color": "#ffffff" },
    { "type": "outline", "target": "add-button", "pad": 6 },
    { "type": "blur", "target": "email-row" },
    { "type": "redact", "target": [20, 400, 200, 30] },
    { "type": "text", "text": "Plan your day", "at": [0.5, 0.04], "size": 0.05, "color": "#1c1b1f", "font": "Caveat", "align": "left", "maxWidth": 0.4, "end": 4.0 }
  ],
  // video only:
  "pointer": "touch",                   // touch (iOS disc) | cursor | none
  "zoom": "auto",                       // zoom toward clicks, or [{ "start": 1, "end": 3, "scale": 1.4, "target": "x" }]
  "cuts": [ { "from": 0.5, "to": 3.2, "name": "Open filter" }, { "from": 3.2, "to": 7, "speed": 1.5, "name": "Pick labels" } ],
  "tail": 1.2,                          // hold the last frame
  "fps": 60                             // video frame rate (default 60)
}
```

- `target` is an element name from `agentshot inspect`, `[x, y]` or `[x, y, w, h]` in screen points
  (imported files have no elements: read the image and give boxes in points = pixels / scale).
- Times (`start`, `end`, zoom, lift) are in capture seconds; any annotation/loupe can have `start`/`end`.
- The camera runs on the output timeline: a zoom (auto or manual) keeps easing through a cut, so a click
  right before a cut that skips a page load zooms in, the new page appears under the zoom, then it eases out.
  Cut loads out by keeping the cursor still across the cut (end a part just after the click, start the next
  at the `changes` time when the page has appeared).
- Lift on a phone floats the element wider than the device with even margins and dims the rest.
- Tips: phone stills 16:10 or 4:5, padding 0.07–0.1; for help-center sets keep one background and accent
  across all images; titles via `text` annotations; social: `4:5`, big title, `tilt` 10–15.

## Library

- `library/<product>/<asset>/v001.png|mp4` + `v001.json` (recipe, note, author), `latest.*`.
- `agentshot list [product]`, `agentshot history <product> <asset>`, `agentshot restore <product> <asset> <v>` (adds a new version).
- `agentshot gallery --open` builds and opens `library/index.html` (search, filter, Time Machine per asset).
- Pass `--by <your agent name>` and a meaningful `--note` on every render.

## When agentshot cannot do something

1. Check the recipe options above first: `screenGrade` takes any CSS filter, `background` any CSS
   background, `zoom` takes manual segments, `annotations` can be combined.
2. Do not quietly patch the output afterwards (ffmpeg/ImageMagick edits on the PNG/MP4): the
   library version would no longer match its recipe, and `restore` would lose the edit.
3. Tell the user what is missing and offer two options: add it to agentshot (`/path/to/agentshot/AGENTS.md`
   explains how an agent implements a feature so that it stays reusable), or file a
   feature request at https://github.com/thread-of-ariadne/agentshot/issues with the use case and an example recipe.
