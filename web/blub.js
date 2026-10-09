// Blub Nixie Clock serial protocol — see docs/reference/serial-protocol.md.
//
// Browser-and-Node: loads as a classic <script> (defines global `Blub`) and as a
// CommonJS module (`require('./blub.js')`). No DOM, no Web Serial in here: the
// Clock class talks to a *transport* object the caller supplies:
//
//   transport.write(Uint8Array) -> Promise      send bytes
//   transport.read()            -> Promise<Uint8Array | null>   next chunk, null = closed
//
// so the same code runs over Web Serial, a Node serial port, or a TCP gateway.

const Blub = (() => {
  'use strict';

  // ---- constants ----------------------------------------------------------

  // WCH CH9102 USB-UART bridge inside the clock.
  const USB_FILTER = { usbVendorId: 0x1a86, usbProductId: 0x55d4 };
  const BAUD = 9600;

  // Firmware's `z` values are 0-based (the vendor page's 1–6 table is off by one).
  const DST_RULES = ['None', 'US', 'EU', 'Mexico', 'Australia', 'New Zealand'];

  // Readable/writable settings. `read` = bare letter; `set` = letter + value.
  const SETTINGS = {
    f: { label: 'Time format', min: 1, max: 2, names: { 1: '12 h', 2: '24 h' } },
    s: { label: 'Display speed', min: 1, max: 9, hint: '1 fastest … 9 slowest' },
    m: { label: 'Transition', min: 1, max: 3 },
    n: { label: 'Night brightness', min: 1, max: 9 },
    o: { label: 'Day brightness', min: 1, max: 9 },
    r: { label: 'Night mode hours' },
    z: { label: 'DST rule', min: 0, max: 5, names: Object.fromEntries(DST_RULES.map((n, i) => [i, n])) },
  };

  const REPLY_TIMEOUT_MS = 2500;
  const DISPLAY_MODE = { TIME: 0, CUSTOM: 2 };

  // ---- pure helpers -------------------------------------------------------

  // Reply line -> { kind: 'error', command, value } for the firmware's unknown-command
  // form, otherwise { kind: 'value', text }.
  function parseReply(line) {
    const m = /^Command: ([\s\S]?), Value: (-?\d+)$/.exec(line);
    if (m) return { kind: 'error', command: m[1], value: Number(m[2]) };
    return { kind: 'value', text: line };
  }

  // Boot banner line -> { version, built } or { intern | rtc : 'Y/M/D H:M:S' } or null.
  function parseBannerLine(line) {
    let m = /^Blub (FW\S+) \(([^)]*)\), (.+)$/.exec(line);
    if (m) return { version: m[1], hashes: m[2], built: m[3] };
    m = /^\s*(intern|rtc): (.+)$/.exec(line);
    if (m) return { [m[1]]: m[2] };
    return null;
  }

  // `r` reads back "21-7"; sets as "2107" (HHhh).
  function parseNightRange(text) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(text.trim());
    if (!m) return null;
    return { start: Number(m[1]), end: Number(m[2]) };
  }
  function formatNightRange(start, end) {
    const two = (h) => String(h).padStart(2, '0');
    return two(start) + two(end);
  }

  // The clock has no time zone. `t` *reads* local standard time as an epoch
  // (wall clock treated as if UTC) and *sets* from the local wall-clock epoch,
  // subtracting the DST hour itself per the `z` rule.
  function wallEpoch(date = new Date()) {
    return Math.floor(date.getTime() / 1000) - date.getTimezoneOffset() * 60;
  }
  function isDstActive(date = new Date()) {
    const y = date.getFullYear();
    const jan = new Date(y, 0, 1).getTimezoneOffset();
    const jul = new Date(y, 6, 1).getTimezoneOffset();
    return date.getTimezoneOffset() < Math.max(jan, jul);
  }
  // What `t` should read back right after a correct sync.
  function expectedInternalEpoch(date = new Date()) {
    return wallEpoch(date) - (isDstActive(date) ? 3600 : 0);
  }
  // What the tubes should be showing for a given internal epoch.
  function displayEpoch(internalEpoch, date = new Date()) {
    return internalEpoch + (isDstActive(date) ? 3600 : 0);
  }
  function formatEpoch(epoch) {
    return new Date(epoch * 1000).toISOString().replace('T', ' ').slice(0, 19);
  }

  // ---- line framing -------------------------------------------------------

  // Feed byte chunks, get complete lines (CR stripped). Keeps the partial tail.
  class LineSplitter {
    constructor() { this.tail = ''; this.decoder = new TextDecoder(); }
    push(chunk) {
      const text = this.tail + this.decoder.decode(chunk, { stream: true });
      const parts = text.split('\n');
      this.tail = parts.pop();
      return parts.map((l) => l.replace(/\r$/, ''));
    }
  }

  // ---- the clock ----------------------------------------------------------

  class Clock {
    // opts.log(direction, text): 'tx' | 'rx' | 'info'
    constructor(transport, opts = {}) {
      this.transport = transport;
      this.log = opts.log || (() => {});
      this.replyTimeoutMs = opts.replyTimeoutMs || REPLY_TIMEOUT_MS;
      this.pending = null;        // { resolve, reject, timer }
      this.unsolicited = [];      // lines received with no command outstanding
      this.banner = {};
      this.queue = Promise.resolve();
      this.closed = false;
      this.onUnsolicited = opts.onUnsolicited || (() => {});
      this._pump();
    }

    async _pump() {
      const splitter = new LineSplitter();
      try {
        for (;;) {
          const chunk = await this.transport.read();
          if (chunk === null) break;
          for (const line of splitter.push(chunk)) this._onLine(line);
        }
      } catch (e) {
        this.log('info', `read error: ${e.message || e}`);
      }
      this.closed = true;
      if (this.pending) this.pending.reject(new Error('port closed'));
    }

    _onLine(line) {
      this.log('rx', line);
      if (this.pending) {
        const p = this.pending; this.pending = null;
        clearTimeout(p.timer);
        p.resolve(line);
      } else {
        this.unsolicited.push(line);
        const b = parseBannerLine(line);
        if (b) Object.assign(this.banner, b);
        this.onUnsolicited(line);
      }
    }

    // Opening the port resets the Arduino. Wait for the boot banner (ends with the
    // "rtc:" line) and then for quiet; give up waiting after `maxMs` if no banner
    // appears (port opened without a reset).
    async waitForBoot({ maxMs = 5000, quietMs = 750 } = {}) {
      const start = Date.now();
      let seenRtc = this.unsolicited.some((l) => /^\s*rtc:/.test(l));
      let lastCount = this.unsolicited.length;
      let quietSince = Date.now();
      while (Date.now() - start < maxMs) {
        await sleep(50);
        if (this.unsolicited.length !== lastCount) {
          lastCount = this.unsolicited.length;
          quietSince = Date.now();
          seenRtc = seenRtc || this.unsolicited.some((l) => /^\s*rtc:/.test(l));
        } else if (seenRtc && Date.now() - quietSince >= quietMs) {
          break;
        }
      }
      this.log('info', seenRtc ? `boot banner seen (${this.banner.version || '?'})` : 'no boot banner');
      return seenRtc;
    }

    // Send one command line and resolve with the single reply line. Serialized.
    cmd(text) {
      const run = async () => {
        if (this.closed) throw new Error('port closed');
        const reply = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending = null;
            reject(new Error(`no reply to "${text}" within ${this.replyTimeoutMs} ms`));
          }, this.replyTimeoutMs);
          this.pending = { resolve, reject, timer };
        });
        this.log('tx', text);
        await this.transport.write(new TextEncoder().encode(text + '\n'));
        const line = await reply;
        const parsed = parseReply(line);
        if (parsed.kind === 'error') throw new Error(`clock rejected "${text}": ${line}`);
        return parsed.text;
      };
      const p = this.queue.then(run, run);
      this.queue = p.catch(() => {});
      return p;
    }

    async version() { return this.cmd('v'); }

    // Settings: bare letter reads; letter+value sets and returns the value now in effect.
    async get(letter) { return this.cmd(letter); }
    async set(letter, value) { return this.cmd(`${letter}${value}`); }
    async getAll() {
      const out = {};
      for (const k of Object.keys(SETTINGS)) out[k] = await this.get(k);
      return out;
    }

    // Display: d0–d9 show that digit (mode 2); anything else returns to time (mode 0).
    async showDigit(n) { return Number(await this.cmd(`d${n}`)); }
    async showTime() { return Number(await this.cmd('d10')); }

    // Time.
    async readInternalEpoch() { return Number(await this.cmd('t')); }

    // Sync from the host clock: send the wall-clock epoch on the whole second, then
    // read back and report how far the clock is from where it should be.
    async syncTime(now = () => new Date()) {
      // wait for the top of a second so the clock's seconds align with the host's
      for (;;) {
        const ms = now().getTime() % 1000;
        if (ms < 25) break;
        await sleep(Math.min(1000 - ms, 50));
      }
      const sent = wallEpoch(now());
      const internal = Number(await this.cmd(`t${sent}`));
      const expected = expectedInternalEpoch(now());
      return { sent, internal, expected, offset: internal - expected };
    }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  return {
    USB_FILTER, BAUD, DST_RULES, SETTINGS, DISPLAY_MODE,
    parseReply, parseBannerLine, parseNightRange, formatNightRange,
    wallEpoch, isDstActive, expectedInternalEpoch, displayEpoch, formatEpoch,
    LineSplitter, Clock,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Blub;
