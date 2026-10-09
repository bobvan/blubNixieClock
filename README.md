# blubNixieClock

A web GUI for the **[Blub Nixie Clock](https://www.daliborfarny.com/project/blub-nixie-clock/)**
by Dalibor Farný.

The clock contains an Arduino behind a USB-serial bridge, speaking a small line-oriented
protocol. This project talks to it from a browser using the Web Serial API: set the time from
your computer's clock, read and change every setting, and show a digit on the tubes.

## Run it

No build step, no dependencies.

1. Plug the clock into USB.
2. Open `web/index.html` in **Chrome, Chromium, or Edge** (Firefox and Safari have no Web
   Serial). If the Connect button complains about a secure context, serve the folder instead:
   `python3 -m http.server` in the repo root, then open <http://localhost:8000/web/>.
3. Click **Connect** and pick the clock (it is filtered to the clock's USB bridge; tick *show
   all serial ports* if it does not appear).

The vendor's **clear EEPROM** command is deliberately not in the GUI.

## Protocol

Mapped against real hardware (firmware 1.9) in
[`docs/reference/serial-protocol.md`](docs/reference/serial-protocol.md), including the parts
the vendor page does not document: how to read settings back, what the replies mean, how `t`
treats time zones and DST, and the USB identity.

## Repository layout

- **[`web/`](web/)** — the app. `blub.js` is the protocol layer (no DOM, also loads under
  Node); `app.js` is the Web Serial transport and UI; `index.html` + `style.css` the page.
- **[`test/`](test/)** — `node --test test/blub.test.js` exercises the protocol layer against
  a fake clock that replies with strings captured from the real one.
- **[`docs/`](docs/)** — the durable record: design decisions with reasoning
  ([`docs/design/`](docs/design/)) and reference material ([`docs/reference/`](docs/reference/)).
  See [`docs/README.md`](docs/README.md).

## Design

[`docs/design/0001-gui-platform.md`](docs/design/0001-gui-platform.md): web-first with Chrome's
Web Serial; the protocol layer is kept transport-agnostic so a native shell (Tauri) or a CLI
can reuse it later.

## License

BSD 3-Clause — see [`LICENSE`](LICENSE).
