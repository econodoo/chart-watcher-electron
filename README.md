# Chart Watcher ⚡ (Electron)

Desktop wallboard that mirrors live market dashboards (SSI iBoard, Fialda, etc.) into a configurable, themable workspace.

## Quick Start

```bash
npm install
npm run dev      # Build + launch
```

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── main.ts              # Window, tray, global shortcuts
│   ├── database.ts          # sql.js (WASM SQLite) persistence
│   └── ipc-handlers.ts      # IPC bridge (renderer ↔ main)
├── preload/
│   ├── shell-preload.ts     # Exposes window.api to renderer
│   └── webview-preload.ts   # Agent message bridge for <webview>
├── renderer/
│   ├── index.html           # Shell layout (toolbar, panels, grid, status bar)
│   ├── shell.ts             # UI logic, source/component/card management
│   └── styles/
│       ├── shell.css        # Base layout + components
│       ├── colorful.css     # 🎨 Vivid green/red on deep blue
│       ├── stealth.css      # 🌙 Muted amber/teal on charcoal
│       └── colorblind.css   # ♿ IBM accessible: blue=up, orange=down
├── agent/
│   └── chartwatch-agent.ts  # Selector engine, mutation watcher, picker overlay
└── types.d.ts               # Shared type declarations
```

## How It Works

1. **Sources** = web dashboards (SSI iBoard, Fialda, etc.)
   - Each source gets a hidden `<webview>` with isolated cookies (`partition`)
   - The JS agent is injected after page load

2. **Components** = what you see on the dashboard grid
   - **WholeSite** — full page embedded in a card via dedicated `<webview>`
   - **Crop** — CSS surgery hides everything except the picked element
   - **Clone** — MutationObserver sends live HTML updates to the card

3. **Grid** = 12 columns × 8 rows
   - Cards placed with integer Row/Col/RowSpan/ColSpan
   - Inspector panel for precise positioning
   - Design mode shows grid lines; View mode hides chrome

4. **Themes** — 3 CSS custom property files, hot-swappable via `<link>` swap
   - Ctrl+T cycles themes
   - Saved to SQLite

## Shortcuts

| Key | Action |
|-----|--------|
| F11 | Toggle fullscreen |
| Ctrl+T | Cycle theme |
| Ctrl+Shift+R | Reload all sources |

## Stack

- **Electron** (latest) — Chromium-based desktop runtime
- **TypeScript 6** — strict mode, zero errors
- **sql.js** — SQLite compiled to WebAssembly (no native build needed)
- **`<webview>`** — per-source session isolation

## Database

Auto-created at `%APPDATA%/chart-watcher/data/chartwatcher.db` (Windows)
or `~/.config/chart-watcher/data/chartwatcher.db` (Linux/Mac).

Tables: `sources`, `components`, `workspaces`, `tabs`, `placements`, `settings`.
