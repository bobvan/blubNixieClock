// UI wiring for the Blub Nixie Clock page. Web Serial transport + DOM; the
// protocol lives in blub.js.

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    connect: $('connect'), disconnect: $('disconnect'), status: $('status'), fw: $('fw'), portId: $('port-id'),
    failDialog: $('fail-dialog'), failTitle: $('fail-title'), failDetail: $('fail-detail'), failRetry: $('fail-retry'),
    hostTime: $('host-time'), tubeTime: $('tube-time'), internalTime: $('internal-time'),
    offset: $('offset'), sync: $('sync'), syncResult: $('sync-result'),
    settings: $('settings'), digits: $('digits'), timeMode: $('time-mode'), displayMode: $('display-mode'),
    log: $('log'), clearLog: $('clear-log'), anyPort: $('any-port'), unsupported: $('unsupported'),
  };

  let port = null, reader = null, writer = null, clock = null, pollTimer = null;
  let lastInternal = null;   // { epoch, at: Date.now() } from the last `t` read

  // ---- log ----------------------------------------------------------------
  function log(dir, text) {
    const line = document.createElement('div');
    line.className = `log-${dir}`;
    const t = new Date().toLocaleTimeString([], { hour12: false });
    line.textContent = `${t} ${dir === 'tx' ? '→' : dir === 'rx' ? '←' : '·'} ${text.replace(/\0/g, '␀')}`;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
  }
  els.clearLog.onclick = () => { els.log.textContent = ''; };

  function setStatus(text, cls = '') { els.status.textContent = text; els.status.className = `status ${cls}`; }
  function setConnected(on) { document.body.classList.toggle('connected', on); }
  function setBusy(busy) { document.body.classList.toggle('busy', busy); }

  // ---- Web Serial transport ---------------------------------------------
  function makeTransport(p) {
    reader = p.readable.getReader();
    writer = p.writable.getWriter();
    return {
      write: (bytes) => writer.write(bytes),
      read: async () => { const { value, done } = await reader.read(); return done ? null : value; },
    };
  }

  async function connect() {
    if (!navigator.serial) return;
    try {
      const filters = els.anyPort.checked ? [] : [Blub.USB_FILTER];
      port = await navigator.serial.requestPort({ filters });
    } catch (e) {
      return; // user cancelled the picker
    }
    setBusy(true);
    try {
      await port.open({ baudRate: Blub.BAUD });
      const info = port.getInfo();
      els.portId.textContent = info.usbVendorId
        ? `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}` : 'serial port';
      setConnected(true);
      setStatus('Connected — waiting for the clock to boot…', 'warn');
      clock = new Blub.Clock(makeTransport(port), { log });
      port.addEventListener('disconnect', () => disconnect('Clock unplugged'));
      await clock.waitForBoot();
      els.fw.textContent = await clock.version();
      setStatus('Connected', 'ok');
      await refreshSettings();
      await readTime();
      pollTimer = setInterval(readTime, 2000);
      enableControls(true);
    } catch (e) {
      const msg = e.message || String(e);
      log('info', `connect failed: ${msg}`);
      await disconnect();
      showFailure(msg);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(reason) {
    clearInterval(pollTimer); pollTimer = null;
    enableControls(false);
    try { if (reader) { await reader.cancel(); reader.releaseLock(); } } catch (e) { /* closing anyway */ }
    try { if (writer) { writer.releaseLock(); } } catch (e) { /* closing anyway */ }
    try { if (port) await port.close(); } catch (e) { /* closing anyway */ }
    port = reader = writer = clock = null; lastInternal = null;
    setConnected(false);
    els.fw.textContent = els.portId.textContent = '—';
    els.tubeTime.textContent = els.internalTime.textContent = els.offset.textContent = '—';
    if (reason) log('info', reason);
  }

  // A port that opened but never answered is almost always the wrong port.
  function showFailure(msg) {
    if (/^no reply/.test(msg)) {
      els.failTitle.textContent = 'No clock found on that port';
      els.failDetail.textContent = 'The serial port opened, but we heard no reply to our request for the firmware version.';
    } else {
      els.failTitle.textContent = 'Could not connect';
      els.failDetail.textContent = msg;
    }
    els.failDialog.showModal();
  }
  els.failRetry.onclick = () => { els.failDialog.close(); connect(); };

  const hex = (n) => n.toString(16).padStart(4, '0');
  els.connect.onclick = () => connect();
  els.disconnect.onclick = () => disconnect();

  // ---- time -----------------------------------------------------------------
  async function readTime() {
    if (!clock) return;
    try {
      const epoch = await clock.readInternalEpoch();
      lastInternal = { epoch, at: Date.now() };
      renderTime();
    } catch (e) {
      log('info', `time read failed: ${e.message || e}`);
    }
  }

  function renderTime() {
    const now = new Date();
    els.hostTime.textContent = now.toLocaleTimeString([], { hour12: false });
    if (!lastInternal) return;
    // advance the last reading by the time elapsed since it was taken
    const internal = lastInternal.epoch + Math.round((Date.now() - lastInternal.at) / 1000);
    els.internalTime.textContent = Blub.formatEpoch(internal);
    els.tubeTime.textContent = Blub.formatEpoch(Blub.displayEpoch(internal, now)).slice(11);
    const off = internal - Blub.expectedInternalEpoch(now);
    els.offset.textContent = `${off > 0 ? '+' : ''}${off} s`;
    els.offset.className = Math.abs(off) <= 1 ? 'ok' : Math.abs(off) <= 60 ? 'warn' : 'err';
  }
  setInterval(renderTime, 250);

  els.sync.onclick = async () => {
    if (!clock) return;
    setBusy(true);
    els.syncResult.textContent = 'Syncing…';
    try {
      const r = await clock.syncTime();
      lastInternal = { epoch: r.internal, at: Date.now() };
      els.syncResult.textContent =
        `Sent ${Blub.formatEpoch(r.sent)} (local wall time); clock now reads ` +
        `${Blub.formatEpoch(r.internal)} internal, ${r.offset === 0 ? 'exactly as expected' : `${r.offset > 0 ? '+' : ''}${r.offset} s from expected`}.`;
      renderTime();
    } catch (e) {
      els.syncResult.textContent = `Sync failed: ${e.message || e}`;
    } finally {
      setBusy(false);
    }
  };

  // ---- settings -------------------------------------------------------------
  const controls = {};   // letter -> { el, render(value), value() }

  function buildSettings() {
    for (const [letter, spec] of Object.entries(Blub.SETTINGS)) {
      const row = document.createElement('div');
      row.className = 'setting';
      const label = document.createElement('label');
      label.textContent = spec.label;
      label.htmlFor = `set-${letter}`;
      row.appendChild(label);

      let el, value, render;
      if (letter === 'r') {
        const start = hourSelect(`set-${letter}`), end = hourSelect(`set-${letter}-end`);
        const wrap = document.createElement('span');
        wrap.className = 'range';
        wrap.append(start, document.createTextNode(' to '), end);
        el = wrap;
        value = () => Blub.formatNightRange(Number(start.value), Number(end.value));
        render = (text) => { const r = Blub.parseNightRange(text); if (r) { start.value = r.start; end.value = r.end; } };
        start.onchange = end.onchange = () => applySetting(letter);
      } else if (spec.names) {
        el = document.createElement('select');
        el.id = `set-${letter}`;
        for (let v = spec.min; v <= spec.max; v++) {
          const o = document.createElement('option');
          o.value = v; o.textContent = `${v} — ${spec.names[v]}`;
          el.appendChild(o);
        }
        value = () => el.value;
        render = (text) => { el.value = text; };
        el.onchange = () => applySetting(letter);
      } else {
        const slider = document.createElement('input');
        slider.type = 'range'; slider.id = `set-${letter}`;
        slider.min = spec.min; slider.max = spec.max; slider.step = 1;
        const out = document.createElement('output');
        out.textContent = '–';
        slider.oninput = () => { out.textContent = slider.value; };
        slider.onchange = () => applySetting(letter);
        el = document.createElement('span');
        el.className = 'slider';
        el.append(slider, out);
        value = () => slider.value;
        render = (text) => { slider.value = text; out.textContent = slider.value; };
      }
      const result = document.createElement('span');
      result.className = 'result';
      row.append(el, result);
      if (spec.hint) { const h = document.createElement('small'); h.textContent = spec.hint; row.appendChild(h); }
      els.settings.appendChild(row);
      controls[letter] = { row, value, render, result };
    }
  }

  function hourSelect(id) {
    const s = document.createElement('select');
    s.id = id;
    for (let h = 0; h < 24; h++) {
      const o = document.createElement('option');
      o.value = h; o.textContent = `${String(h).padStart(2, '0')}:00`;
      s.appendChild(o);
    }
    return s;
  }

  async function refreshSettings() {
    const all = await clock.getAll();
    for (const [letter, text] of Object.entries(all)) {
      controls[letter].render(text);
      controls[letter].result.textContent = '';
    }
  }

  async function applySetting(letter) {
    if (!clock) return;
    const c = controls[letter];
    const want = c.value();
    c.result.textContent = '…';
    try {
      const got = await clock.set(letter, want);
      // The clock answers with the value now in effect; compare in its own read-back form.
      const same = letter === 'r'
        ? JSON.stringify(Blub.parseNightRange(got)) === JSON.stringify(Blub.parseNightRange(fromSet(want)))
        : String(got) === String(want);
      c.result.textContent = same ? '✓' : `clock kept ${got}`;
      c.result.className = `result ${same ? 'ok' : 'err'}`;
      if (!same) c.render(got);
    } catch (e) {
      c.result.textContent = e.message || String(e);
      c.result.className = 'result err';
    }
  }
  // "2107" -> "21-7" so a set value can be compared with a read-back
  const fromSet = (hhhh) => `${Number(hhhh.slice(0, 2))}-${Number(hhhh.slice(2))}`;

  // ---- display ----------------------------------------------------------------
  function buildDigits() {
    for (let d = 0; d <= 9; d++) {
      const b = document.createElement('button');
      b.textContent = d;
      b.onclick = () => showDigit(d);
      els.digits.appendChild(b);
    }
    els.timeMode.onclick = () => showDigit(null);
  }
  async function showDigit(d) {
    if (!clock) return;
    try {
      const mode = d === null ? await clock.showTime() : await clock.showDigit(d);
      els.displayMode.textContent = mode === Blub.DISPLAY_MODE.TIME ? 'showing the time'
        : mode === Blub.DISPLAY_MODE.CUSTOM ? `showing ${d}` : `mode ${mode}`;
    } catch (e) {
      els.displayMode.textContent = e.message || String(e);
    }
  }

  // ---- enable/disable -----------------------------------------------------------
  function enableControls(on) {
    document.querySelectorAll('#settings select, #settings input, #digits button, #time-mode, #sync')
      .forEach((el) => { el.disabled = !on; });
  }

  // ---- init -------------------------------------------------------------------
  buildSettings();
  buildDigits();
  enableControls(false);
  if (!navigator.serial) {
    els.unsupported.hidden = false;
    els.connect.disabled = true;
  }
})();
