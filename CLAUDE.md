# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HiveCode is a Windows-native split-pane PowerShell terminal multiplexer with Claude Code integration, built on Electron + xterm.js + node-pty.

## Commands

```bash
npm start              # Launch app with Electron
npm run rebuild        # Rebuild native modules (node-pty)
npm run dist           # Interactive: bump version, build, git tag/push, publish GitHub Release
npm run dist:nobump    # Build NSIS installer without version bump
npm run dist:portable  # Build portable executable
```

The `dist` script (`scripts/build.js`) is interactive — it prompts for changelog entries, bumps the patch version, updates CHANGELOG.md, commits, tags, pushes, builds with electron-builder, and publishes the GitHub Release. Requires `GH_TOKEN` in `.env.json` or environment.

## Architecture

### Process Model (Electron)

```
main.js (Main Process)
  ├── Spawns PowerShell PTY instances via node-pty
  ├── Tracks CWD via OSC 7 prompt injection
  ├── Command timing & Windows native notifications
  ├── File I/O, dialogs, auto-update (electron-updater)
  └── IPC handlers (~25 channels)

preload.js (IPC Bridge)
  └── Exposes window.terminalAPI with context isolation

renderer/ (Renderer Process)
  ├── app.js          → Init, state restore, global shortcuts
  ├── pane-manager.js → Terminal lifecycle, xterm setup, drag-and-drop, export
  ├── toolbar.js      → Toolbar UI, modals (projects, accounts, patch notes, help, notifications)
  ├── split-tree.js   → Binary tree data structure for pane layout
  └── splitter.js     → Drag-to-resize with direction toggle
```

### Key Design Decisions

- **Binary split tree** for pane layout — SplitNode has direction (horizontal/vertical), ratio, and two children. Leaves hold terminal IDs. All pane operations (split, move, swap, remove) are tree mutations followed by a full re-render.
- **Custom PowerShell prompt injection** — On terminal create, injects a `prompt` function that emits `ESC]7;{cwd}BEL` (OSC 7). This enables CWD tracking and command completion detection.
- **Dual notification detection** — OSC 7 prompt appearance = command completed (for PowerShell). For TUI apps (claude CLI) that don't emit OSC 7, a 2-second idle timer on PTY output triggers notification instead.
- **Frameless window** with custom title bar controls via IPC (`win:minimize`, `win:maximize`, `win:close`).
- **WebGL rendering** with automatic fallback — xterm WebGL addon loads with a context-loss handler that disposes and falls back to canvas.
- **Renderer modules export classes to `window`** (e.g., `window.PaneManager`, `window.Toolbar`) — no bundler, plain script tags in index.html.

### Data Persistence

All state files live in Electron's `userData` directory:
- `layout-state.json` — Serialized split tree with pane names, CWDs, ratios
- `recent-projects.json` — Last 10 opened project folders
- `accounts.json` — API key accounts with active selection
- `notify-settings.json` — Notification enabled flag + threshold seconds
- `patchnotes-seen.json` — Last seen app version

### Terminal Lifecycle

1. `PaneManager.createTerminal()` creates xterm instance with FitAddon + custom key handler
2. IPC `terminal:create` spawns PowerShell PTY in main process
3. Bidirectional data: xterm.onData → `terminal:write` IPC → PTY, and PTY.onData → IPC → xterm.write
4. Custom key handler intercepts Ctrl+C (copy selection) and Ctrl+V (paste with bracketed paste mode support)
5. Uses `e.code` (not `e.key`) for keyboard shortcuts to support Korean IME

## Conventions

- UI text is in **Korean** (도움말, 패치노트, 알림, etc.)
- Dark theme: `#1e1e1e` background, `#007acc` accents
- Silent error handling on file I/O and terminal operations to prevent crashes
- State saves are debounced (500ms) to avoid UI stalls
- Splitter drag uses requestAnimationFrame throttling with 10%-90% ratio clamping

## Publishing

GitHub repo: `kccitsales/hivecode`. Auto-update configured via `electron-updater` with GitHub Releases as provider.
