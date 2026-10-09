# Blub Nixie Clock — serial protocol

The clock's Arduino exposes a USB serial port. Source: Dalibor Farný's
[USB Interface](https://docs.daliborfarny.com/blub-nixie-clock/1/en/topic/usb-interface) page
(cached in doclib, group `blubnixie`), plus observations against real hardware (FW1.9,
2026-10-08) marked **[observed]** below. The vendor page documents the write side only; most of
the read side below is observed, not documented.

## USB identity [observed]

WCH **CH9102** USB-UART bridge: VID `0x1a86`, PID `0x55d4`, full speed (12 Mb/s), USB serial
number `5C85475655` on Bob's unit. The Arduino is behind the bridge, so this is the identity a
GUI should filter on (Web Serial: `{usbVendorId: 0x1a86, usbProductId: 0x55d4}`). The bridge's
DTR line is wired to the Arduino reset (see *Reset on open*).

## Line settings

9600 bps, 8 data bits, no parity, 1 stop bit.

## Framing [observed]

- Commands are **terminated by LF** (`\n`). CRLF also works. CR alone does **not** terminate.
- Commands are **case-sensitive** single letters, optionally followed by a decimal argument.
- Every reply line ends in **CRLF**.
- An unrecognised command (including an empty line) replies
  `Command: <c>, Value: <n>` — e.g. `?` → `Command: ?, Value: 0`; an empty line shows the
  command as a NUL byte. This is the only error form seen.
- **A command with no argument reads the current value** (undocumented). This is how a GUI
  can populate its controls from the clock's state.
- A setting command replies with the value **now in effect**, so the reply doubles as an ack:
  `f2` → `2`; an invalid `f3` → `1` (unchanged). Compare before/after to detect rejection.

## Commands

| Cmd | Set (vendor doc) | Read-back [observed] | Notes |
|---|---|---|---|
| `v` | Print firmware version and build date | same | Argument ignored. Reply e.g. `Blub FW1.9 (b015ea6/b015ea6), Jul  8 2026 12:19:02` |
| `e` | **Clear EEPROM and all settings** | — | Destructive. Never probed. |
| `d<n>` | `d0`–`d9` show that digit; `d10` back to time | `d` → current mode | Reply is the display **mode**, not the digit: `2` = custom-number mode, `0` = time mode. Any value outside 0–9 (e.g. `d11`, `d99`) returns to time mode. |
| `t<epoch>` | Set the time from a UNIX timestamp | `t` → internal epoch | **Epoch of local wall-clock time**, DST included; the firmware subtracts the DST hour per `z` and stores standard time. See *Time*. |
| `f<1|2>` | Format: 1 = 12 h, 2 = 24 h | `f` → `1`/`2` | `f3` rejected. |
| `s<1–9>` | Display speed, 1 fastest | `s` → value | `s0` was **accepted in RAM but not saved**: read back `0` until reboot, then the old value. |
| `m<1–3>` | Transition speed | `m` → value | 1 slowest … 3 fastest (observed on the tubes). |
| `n<1–9>` | Night-mode brightness | `n` → value | |
| `o<1–9>` | Day-mode brightness | `o` → value | |
| `r<HHhh>` | Night range, 24 h, e.g. `r2107` | `r` → `21-7` | Read-back format differs from the set format (`H-H`, unpadded). |
| `z<0–5>` | DST rule | `z` → value | **Vendor table is off by one:** `z0` is accepted, and `z`=1 applies the US DST hour. So 0 none, 1 US, 2 EU, 3 Mexico, 4 Australia, 5 NZ (the last four inferred from the vendor order). |

## Persistence [observed]

Valid setting writes take effect immediately and **survive a reboot** (`s4` read back `4`
after a reset) — no separate save command. Out-of-range values may be applied live but are not
persisted.

## Reset on open [observed]

Opening the port asserts DTR and **resets the Arduino**: the tubes run the startup sequence,
and about 1.6 s later the firmware prints a three-line boot banner:

```
Blub FW1.9 (b015ea6/b015ea6), Jul  8 2026 12:19:02
intern: 2026/10/8 21:31:03
   rtc: 2026/10/8 21:31:03
```

— version, the firmware's internal clock, and the RTC, unpadded `Y/M/D H:M:S`. Nothing else is
ever printed unsolicited. Commands sent during the reboot are lost. A GUI should keep the port
open for its whole session, and on open should wait for the banner and then for quiet before
sending anything. Stale banner text can also be buffered by the host driver and delivered on the
next open. Through a gateway that reopens the device per TCP connection, two banners were often
seen per connection (close and open each seem to toggle DTR).

## Shared ports on macOS [observed]

macOS does not give a serial device to one process exclusively. With another program holding
the port, Chrome's Web Serial opened it without error, sent `v`, and the reply was delivered to
the *other* reader — so from the GUI's side a busy port looks exactly like a port with no clock
on it (no reply). The GUI's "no clock found" dialog therefore mentions both causes.

## Time [observed]

The clock has no time-zone setting. Internally it keeps **local standard time** as a UNIX-style
epoch (wall time treated as if it were UTC), and applies the DST hour from the `z` rule at
display. Observed with `z`=1 (US rule) in October: internal 21:47, tubes 10:47 PM.

- `t` with no argument returns that internal epoch, e.g. `1791496071` = 2026-10-08 21:47:51.
- `t<epoch>` expects the **local wall-clock time** (what the tubes should show) as an epoch.
  The firmware subtracts the DST offset itself: sending the standard-time epoch during DST
  set the clock an hour slow; sending `calendar.timegm(time.localtime())` set it correctly.
  The reply is the new internal (standard-time) epoch.
- Resolution is whole seconds; the set landed within about a second of the host clock.
- Before syncing, the unit was ~28 s slow after being set by the push buttons.
- The boot banner's `intern`/`rtc` are the same internal standard time.

Sync recipe: wait for boot banner + quiet, then `t` + `calendar.timegm(time.localtime())`
on the whole second, then read back with `t` and expect wall − DST offset.

## Still unknown

- Reply to `e` (never to be probed casually).
- Whether `r` validates its argument.
- Whether `z` values 2–5 are really EU/Mexico/Australia/NZ in that order.
