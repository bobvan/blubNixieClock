// Run: node --test test/
// Exercises web/blub.js under Node with a scripted fake transport, using the
// exact reply strings captured from FW1.9 (docs/reference/serial-protocol.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const Blub = require('../web/blub.js');

const BANNER =
  'Blub FW1.9 (b015ea6/b015ea6), Jul  8 2026 12:19:02\r\n' +
  'intern: 2026/10/8 21:47:21\r\n' +
  '   rtc: 2026/10/8 21:47:21\r\n';

// A fake clock: emits `boot` on open, then answers each command line from `replies`.
function fakeTransport({ boot = BANNER, replies = {} } = {}) {
  const enc = new TextEncoder();
  const outbox = [];               // chunks waiting for read()
  let waiter = null;               // pending read() resolver
  let closed = false;
  const sent = [];
  const push = (text) => {
    outbox.push(enc.encode(text));
    if (waiter) { const w = waiter; waiter = null; w(outbox.shift()); }
  };
  if (boot) setTimeout(() => push(boot), 20);
  return {
    sent,
    async write(bytes) {
      const line = new TextDecoder().decode(bytes).replace(/\n$/, '');
      sent.push(line);
      const r = replies[line];
      if (r === undefined) push(`Command: ${line[0] || '\0'}, Value: 0\r\n`);
      else if (r !== null) setTimeout(() => push(r + '\r\n'), 5);
    },
    read() {
      if (closed) return Promise.resolve(null);
      if (outbox.length) return Promise.resolve(outbox.shift());
      return new Promise((resolve) => { waiter = resolve; });
    },
    close() { closed = true; if (waiter) waiter(null); },
  };
}

test('parseReply recognises the unknown-command form', () => {
  assert.deepEqual(Blub.parseReply('Command: ?, Value: 0'), { kind: 'error', command: '?', value: 0 });
  assert.deepEqual(Blub.parseReply('Command: \0, Value: 0'), { kind: 'error', command: '\0', value: 0 });
  assert.deepEqual(Blub.parseReply('3'), { kind: 'value', text: '3' });
});

test('parseBannerLine', () => {
  assert.deepEqual(Blub.parseBannerLine('Blub FW1.9 (b015ea6/b015ea6), Jul  8 2026 12:19:02'),
    { version: 'FW1.9', hashes: 'b015ea6/b015ea6', built: 'Jul  8 2026 12:19:02' });
  assert.deepEqual(Blub.parseBannerLine('   rtc: 2026/10/8 21:47:21'), { rtc: '2026/10/8 21:47:21' });
  assert.equal(Blub.parseBannerLine('3'), null);
});

test('night range read/set formats differ', () => {
  assert.deepEqual(Blub.parseNightRange('21-7'), { start: 21, end: 7 });
  assert.equal(Blub.formatNightRange(21, 7), '2107');
  assert.equal(Blub.formatNightRange(9, 18), '0918');
  assert.equal(Blub.parseNightRange('garbage'), null);
});

test('LineSplitter handles CRLF and split chunks', () => {
  const s = new Blub.LineSplitter();
  const enc = new TextEncoder();
  assert.deepEqual(s.push(enc.encode('a\r\nb')), ['a']);
  assert.deepEqual(s.push(enc.encode('c\r\n\r\n')), ['bc', '']);
});

test('time arithmetic matches the hardware session (CDT, 2026-10-08)', () => {
  // 22:47:49 CDT == 03:47:49Z; getTimezoneOffset would be 300 in that zone.
  const date = new Date('2026-10-09T03:47:49Z');
  const offsetMin = date.getTimezoneOffset();
  const wall = Blub.wallEpoch(date);
  assert.equal(wall, Math.floor(date.getTime() / 1000) - offsetMin * 60);
  if (process.env.TZ === 'America/Chicago') {
    assert.equal(wall, 1791499669);                    // what we actually sent
    assert.equal(Blub.isDstActive(date), true);
    assert.equal(Blub.expectedInternalEpoch(date), 1791496069); // what the clock replied
    assert.equal(Blub.formatEpoch(1791496069), '2026-10-08 21:47:49');
  }
});

test('Clock: waits for boot banner, reads version and settings', async () => {
  const t = fakeTransport({ replies: {
    v: 'Blub FW1.9 (b015ea6/b015ea6), Jul  8 2026 12:19:02',
    f: '1', s: '3', m: '2', n: '9', o: '9', r: '21-7', z: '1',
  } });
  const clock = new Blub.Clock(t, { replyTimeoutMs: 500 });
  assert.equal(await clock.waitForBoot({ maxMs: 1000, quietMs: 50 }), true);
  assert.equal(clock.banner.version, 'FW1.9');
  assert.equal(clock.banner.rtc, '2026/10/8 21:47:21');
  assert.equal(await clock.version(), 'Blub FW1.9 (b015ea6/b015ea6), Jul  8 2026 12:19:02');
  assert.deepEqual(await clock.getAll(), { f: '1', s: '3', m: '2', n: '9', o: '9', r: '21-7', z: '1' });
  t.close();
});

test('Clock: no banner -> waitForBoot gives up and returns false', async () => {
  const t = fakeTransport({ boot: null });
  const clock = new Blub.Clock(t, { replyTimeoutMs: 500 });
  assert.equal(await clock.waitForBoot({ maxMs: 150, quietMs: 50 }), false);
  t.close();
});

test('Clock: set returns value in effect; rejected values show as unchanged', async () => {
  const t = fakeTransport({ boot: null, replies: { f2: '2', f3: '1', d6: '2', d10: '0' } });
  const clock = new Blub.Clock(t, { replyTimeoutMs: 500 });
  assert.equal(await clock.set('f', 2), '2');
  assert.equal(await clock.set('f', 3), '1');
  assert.equal(await clock.showDigit(6), Blub.DISPLAY_MODE.CUSTOM);
  assert.equal(await clock.showTime(), Blub.DISPLAY_MODE.TIME);
  t.close();
});

test('Clock: unknown command rejects, timeout rejects, queue keeps going', async () => {
  const t = fakeTransport({ boot: null, replies: { v: 'Blub FW1.9 (x/x), d', q: null } });
  const clock = new Blub.Clock(t, { replyTimeoutMs: 100 });
  await assert.rejects(clock.cmd('?'), /rejected "\?"/);
  await assert.rejects(clock.cmd('q'), /no reply/);
  assert.equal(await clock.version(), 'Blub FW1.9 (x/x), d');
  t.close();
});

test('Clock: syncTime sends wall epoch on the second and reports offset', async () => {
  const enc = new TextEncoder();
  let waiter = null; const outbox = [];
  const push = (s) => { outbox.push(enc.encode(s)); if (waiter) { const w = waiter; waiter = null; w(outbox.shift()); } };
  const t = {
    async write(bytes) {
      const m = /^t(\d+)$/.exec(new TextDecoder().decode(bytes).trim());
      assert.ok(m, 'sync must send t<epoch>');
      const internal = Number(m[1]) - (Blub.isDstActive() ? 3600 : 0) + 1; // clock 1 s fast
      setTimeout(() => push(`${internal}\r\n`), 5);
    },
    read() {
      if (outbox.length) return Promise.resolve(outbox.shift());
      return new Promise((r) => { waiter = r; });
    },
  };
  const clock = new Blub.Clock(t, { replyTimeoutMs: 500 });
  const r = await clock.syncTime();
  assert.equal(r.offset, 1);
  assert.equal(r.internal, r.expected + 1);
  assert.ok(Math.abs(r.sent - Blub.wallEpoch()) <= 1);
});
