# Security policy

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting:
[https://github.com/thread-of-ariadne/agentshot/security/advisories/new](https://github.com/thread-of-ariadne/agentshot/security/advisories/new)
(**Security → Report a vulnerability** on the repository page). Include what you found, how to
reproduce it and its impact. You should get a reply within a week; a fix and an advisory
follow once the issue is confirmed.

Only the latest commit on the default branch is supported.

## What agentshot does on your machine

Knowing this helps judge what counts as a vulnerability:

- **Captures are screenshots and recordings of real apps** and can contain private data. They
  stay in `public/captures/` and `library/` on your machine; `agentshot` never uploads anything and
  has no telemetry. Use `blur` / `redact` annotations before sharing output.
- **Scenarios run what they describe**: a `"url"` scenario opens that page in Chrome; a
  `"window"` scenario moves your real mouse and types into the named window; recording
  captures the named window or screen. Only run scenarios you trust, like any script.
- **Local servers** (`render`, `preview`) bind to `127.0.0.1` on a random or given port and
  serve only the render bundle, `public/` and the frame cache. The renderer itself makes no network
  requests (fonts are bundled); a recipe can still point a CSS background at a remote image.
- **External tools** are called with argument arrays, not shell strings: Chrome (through
  Playwright), ffmpeg/ffprobe, PowerShell (`recorder/win.ps1`) and, on macOS, a Swift helper
  compiled from `recorder/mac.swift`. The one exception is `cmd /c start` on Windows, used only
  to open a file or URL that `agentshot` generated itself (`gallery --open`, `preview`).

Path traversal out of the served folders, command injection through recipe or scenario
values, and anything that sends data off the machine are in scope.
