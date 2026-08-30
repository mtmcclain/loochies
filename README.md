# Loochies

Tiny Lemmings-style puzzle prototype — mobile‑first PWA.

What’s here in this first playable slice:
- Loochies spawn and walk with cute brunette‑girl pixel sprites
- One assignable job: Blocker
- One tiny tutorial level (entrance + exit)
- PWA manifest and icons (Add to Home Screen on iPhone)

## Run locally

1. Use any static file server from the repo root:
   - Node: `npx serve .`
   - Python: `python3 -m http.server 8000`
2. Open `http://localhost:5000` or `http://localhost:8000` in a browser.
3. iPhone: in Safari, open the local URL on your network, tap Share → Add to Home Screen.

## Play online

A live preview link is included in the pull request description. It uses:
- GitHub Pages preview (Actions will post a “View deployment” link on the PR), and
- a direct branch preview via raw.githack:
  `https://raw.githack.com/mtmcclain/loochies/cursor/loochies-pwa-game-d067/index.html`

## Controls
- Tap “Blocker”, then tap a Loochie to make her hold others back.
- “Restart” restarts the level.

## Tech
- Static HTML5 Canvas, integer scaling, no build step
- PWA: `manifest.webmanifest` + service worker (`sw.js`)
