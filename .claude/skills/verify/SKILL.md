---
name: verify
description: Verification policy for this project — the user tests in the browser; Claude does static checks only.
---

# Verifying changes in the video editor

**The user verifies runtime/visual behavior themselves in the browser.** They always have the dev server running.

Do NOT:
- run browser automation (Playwright, puppeteer/puppeteer-core, headless Chrome) — the user vetoed this
- start the dev server (`npm run dev`, `vite`) — the user already has it running

Instead, when a change is made:
1. Run **static checks** — `npx tsc -b` (typecheck) and lint if relevant.
2. Hand off runtime/visual verification to the user: tell them concisely **what to click and what to look for** to confirm the change.

If asked to "verify" a UI/render change, report the static-check results and give the user a short manual test checklist — don't try to observe it yourself.

(This overrides the default `/verify` skill's "drive it under Playwright" flow for this repo.)
