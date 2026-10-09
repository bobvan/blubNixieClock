# 0001 — GUI platform: Web Serial vs native vs both

**Status: DECIDED 2026-10-08 — option C, web-first.** The first design decision: how to deliver
the cross-platform GUI for the Blub Nixie Clock.

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

**Option C, web-first.** Build the GUI as a plain web page using Chrome's Web Serial API now;
keep the protocol layer and UI free of browser-shell assumptions so a native shell (Tauri) can
wrap the same code later if an installed app is ever wanted.

Reasoning, from the first hardware session (`docs/reference/serial-protocol.md`):

- The clock is a standard USB-UART device (WCH CH9102, `1a86:55d4`) at 9600 8N1 with a
  line-oriented text protocol. Web Serial handles this with no driver work beyond what the OS
  already provides; nothing in the protocol needs OS integration.
- The clock sits on the owner's desk next to the machine that runs the browser. "Open a tab,
  click Connect, pick the port" is an acceptable workflow; there is no need for autostart, tray,
  or file associations.
- Zero install and zero per-platform packaging keeps the project small. The repo will be public;
  a static page can be served from the repo (e.g. GitHub Pages) with no build step.
- Chromium-only is acceptable for the GUI. Non-browser needs (scripted time sync from a Linux
  host, for example) are better served by a small CLI sharing the protocol spec than by a native
  GUI, and are out of this decision's scope.
- Keeping option C open costs little: no framework lock-in, plain HTML/CSS/JS, and a transport
  interface the protocol layer talks to (Web Serial today; a Tauri serial plugin later).

Update 2026-10-09: recent Firefox also supports Web Serial (verified against the clock on
macOS, with its own port-selection prompt), so "Chromium-only" now means "not Safari".

Consequences: source lives in `web/`; no bundler or package manager unless a real need appears;
the protocol module must be usable outside the browser (testable under Node) so the CLI and any
future shell reuse it.
