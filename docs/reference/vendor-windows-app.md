# The vendor's Windows app — what it does, compared with ours

Audit of Dalibor Farný's Windows controller for the Blub clock, done 2026-10-09 to find anything
it can do that this project's app cannot.

Sources: the vendor's [Windows application](https://docs.daliborfarny.com/v2/en/blub-nixie-clock/windows-application)
and [Download](https://docs.daliborfarny.com/v2/en/blub-nixie-clock/download) pages (cached in
doclib, group `blubnixie`), and the download itself, `blub-v1-8.zip`, which holds `blub.exe`
(a .NET/WPF app, file version 1.0.1.0, written by Lukáš Jezný in 2020) and `blub1-8.hex`
(firmware). The app was not run; its option lists and command names were read from the strings
embedded in the executable, and the firmware version from the strings in the HEX image.

## Feature comparison

| Feature | Vendor app | This app |
|---|---|---|
| Runs on | Windows only; download and unzip an `.exe` | Windows, Mac, Linux; in the browser |
| Find the port | Pick a COM port, Refresh | Browser's port picker, filtered to the clock |
| Show firmware version | Yes | Yes |
| Read current settings from the clock | Not evident (its screenshot shows empty drop-downs) | Yes, on connect |
| Sync time from the computer | Yes | Yes, and shows the clock's offset afterwards |
| DST rule | 6 named rules | Same 6 rules |
| 12/24 h | Yes | Yes |
| Transition speed | 9 steps, named `9x` … `2x`, `Slow` | Yes (labelled *Display speed*, 1–9 unnamed) |
| Transition effect | `Normal`, `Smooth`, `Slotmachine` | Yes, but mislabelled *Transition speed*, values unnamed |
| Day / night brightness | 10 steps: `Off`, `3%`, `6%`, `9%`, `12%`, `24%`, `36%`, `48%`, `72%`, `Full` | 9 steps (1–9); no *Off* |
| Night time range | Start and end hour, 00–23 | Same |
| Test digits / back to time | Yes | Yes |
| **Firmware update** | **Yes** — flashes a `.hex` over USB (Arduino STK500 bootloader, ATmega328P) | **No** |
| Clear EEPROM | No | No (deliberately) |

## Findings

**1. Our labels for `s` and `m` are wrong.** The vendor app names its commands
`COMMAND_TRANSITION_SPEED` and `COMMAND_TRANSITION_EFFECT`, with the option lists above. So `s`
(the vendor's USB page calls it "display speed") is the **transition speed**, and `m` is the
**transition effect** — Normal, Smooth, or Slot machine — not a speed. The effects do look
faster or slower than one another, which is how it came to be labelled a speed here.

**2. Brightness has a tenth step: Off.** The app offers ten brightness levels where the vendor's
USB page documents 1–9. The likely mapping is `0` = Off through `9` = Full, which would let night
mode switch the tube off entirely. Unverified on hardware.

**3. Named steps.** The app's names (`9x` … `Slow`, `3%` … `Full`, the effect names) are more
meaningful than our bare numbers. The value each name sends is inferred from list order and not
yet verified: speed `1` = `9x` (fastest) … `9` = `Slow`, matching the USB page's "s1 fastest, s9
slowest"; effect `1` = Normal, `2` = Smooth, `3` = Slot machine.

**4. Firmware update is the only real capability gap.** The app resets the clock into its Arduino
bootloader and writes a HEX file with the STK500v1 protocol (it checks for the ATmega328P's
signature `1E 95 0F`). This is doable from a browser too: Web Serial can toggle DTR to enter the
bootloader, and STK500v1 is a small protocol. The bootloader itself is never overwritten, so an
interrupted update can be retried.

**5. But the published firmware is older than what clocks may already run.** The HEX in the
current download (`Blub v1-8`) identifies itself as build `6297e24`, compiled Mar 25 2022. The
clock this project was developed against reports `Blub FW1.9 (b015ea6/b015ea6), Jul 8 2026`.
Flashing the download onto that clock would be a **downgrade**. There is, today, nothing newer to
flash.

**6. Firmware internals visible in the HEX:** the boot-banner strings (`Blub FW`, `intern:`,
`rtc:`), the unknown-command reply (`Command: `, `, Value: `), button names `ADJ_BUTTON` and
`SET_BUTTON`, and time-zone abbreviations for exactly five DST regions (`us`, `eu`, `mx`, `au`,
`nz` — `ST`/`DT`), consistent with the 0-based DST table in
[`serial-protocol.md`](serial-protocol.md) (0 = none, then five rules).

**7. The vendor publishes sample code**, not the shipping firmware:
<https://github.com/DaliborFarny/Blub-Nixie-Clock---sandbox> ("a minimal code showing the
hardware layout").

## Not adopted

Firmware update is left out for now: with no firmware newer than what ships, it would only offer
a downgrade, and a firmware-flashing button is a poor fit for an app aimed at people who just
want to set their clock. Revisit if the vendor publishes newer firmware.
