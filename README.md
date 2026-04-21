# Playable Runner

An infinite side-scrolling runner built as a self-contained playable ad — everything (code, assets, Phaser engine) ships inside a single HTML file, no server required.

## Gameplay

Tap / click or press **Space** to jump. Double-tap for a double jump. Dodge balls and enemy runners while collecting coins. Reach the finish line to win.

- 3 lives with invincibility frames after each hit
- ×2 combo multiplier when collecting coins consecutively
- Speed ramps from 300 → 600 px/s over the course of the run
- Finish line appears at 45 m with a physics rope-break animation

## Run locally

```bash
npm install
npm run dev       # hot-reload dev server at http://localhost:5173
npm run build     # production single-file build → dist/index.html
npm run build:analyze  # same build + opens bundle composition chart
```

## Tech stack

| Layer | Library |
|---|---|
| Game engine | [Phaser 3.90](https://phaser.io) |
| Language | TypeScript |
| Bundler | [Vite 8](https://vitejs.dev) |
| Single-file output | [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) |
| Bundle analysis | rollup-plugin-visualizer |

## Build output

`dist/index.html` — one fully self-contained HTML file (~3.9 MB, ~2.4 MB gzipped). No external HTTP requests at runtime; works completely offline.

## Deploy

Pushing to `main` triggers the GitHub Actions workflow at `.github/workflows/deploy.yml`, which builds and deploys to **GitHub Pages** automatically.

Enable Pages in your repo settings → **Source: GitHub Actions** before the first push.

## Mobile testing

Open Chrome DevTools → **Pixel 7** device preset → **CPU: 4× slowdown** → **Network: Offline**. The game targets 60 fps; the FPS monitor reduces particle counts automatically if the device drops below 30 fps.
