# bulbNixieClock

A cross-platform GUI for the **[Blub Nixie Clock](https://www.daliborfarny.com/project/blub-nixie-clock/)**
by Dalibor Farný.

The clock contains an Arduino that exposes a serial port speaking a documented protocol. This
project is the desktop/web application that drives it — reading and setting the clock over that
serial link.

## Design direction

The first open decision is how to deliver the GUI (see [`docs/design/`](docs/design/)):

- **Web + Chrome Web Serial API** — a web page that talks to the clock through Chrome's Web Serial;
  zero-install and one codebase, Chromium-only.
- **Native app (Win/Lin/Mac)** — a desktop application (e.g. Tauri, Electron, Flutter, Qt) using a
  native serial library.

One or both.

## Repository layout

- **[`docs/`](docs/)** — the durable record: design decisions and reasoning, and reference material
  including the serial protocol. See [`docs/README.md`](docs/README.md).
- Application source lives alongside once the platform decision is made.

## Status

Early stage — scaffolding in place; the GUI-platform decision is the first task.

## License

BSD 3-Clause — see [`LICENSE`](LICENSE).
