# 0001 — GUI platform: Web Serial vs native vs both

**Status: OPEN** (raised 2026-09-29). The first design decision: how to deliver the cross-platform
GUI for the Blub Nixie Clock. Resolve with Bob before building.

## Context

The clock exposes an Arduino serial port speaking a documented protocol. The GUI must open that
serial port from the user's desktop, on Windows, Linux, and macOS.

## Options

### A. Web app + Chrome Web Serial API
- **For:** zero install; one codebase; instant cross-platform via the browser; easy to share (a URL).
- **Against:** Chrome/Chromium/Edge only (no Firefox/Safari); Web Serial requires HTTPS + a user
  gesture to grant the port; limited to what the API exposes; no OS-level integration (tray,
  autostart, file associations); the "app" is a tab.

### B. Native desktop app (Win/Lin/Mac)
Framework candidates: **Tauri** (Rust + web UI, small binary), **Electron** (Chromium + Node),
**Flutter** (Dart), **Qt** (C++/Python).
- **For:** a real installable app; full serial access via a native library; OS integration;
  any-browser-independent.
- **Against:** per-platform build, signing, and distribution; a framework choice to commit to;
  more moving parts.

### C. Both
- A shared UI/protocol core with two shells (e.g. a web build for quick access + a Tauri wrapper for
  the installed app — Tauri and Electron can both reuse a web UI, which makes "both" cheaper than it
  looks).

## Decision axes
- Who are the users, and is "open a browser tab" acceptable, or is an installed app expected?
- Firefox/Safari support needed, or is Chromium-only fine?
- Appetite for per-platform packaging/signing.
- Reuse: a web-first UI keeps option C open (a native shell can wrap it later).

## Decision
<!-- FILL IN with Bob. Record the choice and the reasoning here when made. -->
