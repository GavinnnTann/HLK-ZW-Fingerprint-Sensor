// Web Serial transport + high-level driver for HLK-ZW fingerprint modules.
//
// Web Serial allows only one active reader on port.readable, so a single
// persistent read loop feeds a byte buffer that command calls consume from.
// That also means stale bytes from a previous timed-out command survive; every
// command flushes the buffer before transmitting, mirroring the Python tester's
// reset_input_buffer().

import { CMD, PID_DATA, PID_END, LED_FUNC, ccText } from './constants.js';
import { buildPacket, buildDataPacket, parseResponse, hex, isSearchReply } from './packet.js';

export class SerialTransport {
  constructor() {
    this.port = null;
    this.buf = new Uint8Array(0);
    this.keepReading = false;
    this.reader = null;
    this._waiters = [];
  }

  get isOpen() {
    return !!this.port;
  }

  async open(port, { baudRate, stopBits = 1 }) {
    await port.open({ baudRate, dataBits: 8, stopBits, parity: 'none', flowControl: 'none' });
    this.port = port;
    this.buf = new Uint8Array(0);
    this.keepReading = true;
    this._readLoop();
  }

  async close() {
    this.keepReading = false;
    try {
      if (this.reader) await this.reader.cancel();
    } catch { /* reader already torn down */ }
    try {
      if (this.port) await this.port.close();
    } catch { /* port already gone (unplugged) */ }
    this.port = null;
    this.buf = new Uint8Array(0);
    this._wake();
  }

  async _readLoop() {
    while (this.port?.readable && this.keepReading) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value?.length) this._append(value);
        }
      } catch {
        // Device unplugged or framing error — loop exits, isOpen stays true
        // until close() is called so the UI can report it.
        break;
      } finally {
        try { this.reader.releaseLock(); } catch { /* already released */ }
        this.reader = null;
      }
    }
  }

  _append(chunk) {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    this._wake();
  }

  _wake() {
    const waiters = this._waiters;
    this._waiters = [];
    for (const w of waiters) w();
  }

  flushInput() {
    this.buf = new Uint8Array(0);
  }

  async write(bytes) {
    if (!this.port?.writable) throw new Error('port not writable');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  // Resolve with exactly n bytes, or null if the deadline passes first.
  async readExactly(n, deadline) {
    while (this.buf.length < n) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, Math.min(remaining, 50));
        this._waiters.push(() => { clearTimeout(timer); resolve(); });
      });
      if (!this.keepReading) return null;
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }
}

export class FingerprintDriver {
  /** @param {(msg: string) => void} log */
  constructor(log) {
    this.t = new SerialTransport();
    this.log = log ?? (() => {});
    this.capacity = 50;
    this.hiSpeedSearch = true; // cleared if the module rejects 0x1B
    this._chain = Promise.resolve();
  }

  // Serialise every exchange. Web Serial has no request/response framing of its
  // own, so two overlapping commands would interleave on the wire and each
  // would parse the other's reply.
  _locked(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.then(() => {}, () => {});
    return run;
  }

  get isOpen() {
    return this.t.isOpen;
  }

  async connect(port, opts) {
    await this.t.open(port, opts);
    this.hiSpeedSearch = true; // re-probe on each new module
  }

  async disconnect() {
    await this.t.close();
  }

  // ── Core request/response ────────────────────────────────────────────────

  sendRecv(ins, params = [], timeoutMs = 3000) {
    return this._locked(() => this._sendRecv(ins, params, timeoutMs));
  }

  async _sendRecv(ins, params = [], timeoutMs = 3000) {
    if (!this.t.isOpen) {
      this.log('ERROR: Not connected');
      return { cc: null, data: null };
    }
    const pkt = buildPacket(ins, params);
    this.log(`TX [0x${ins.toString(16).padStart(2, '0').toUpperCase()}]: ${hex(pkt)}`);

    this.t.flushInput();
    await this.t.write(pkt);

    const deadline = Date.now() + timeoutMs;
    const head = await this.t.readExactly(9, deadline);
    if (!head) {
      this.log('TIMEOUT: no response header');
      return { cc: null, data: null };
    }
    const length = (head[7] << 8) | head[8];
    if (length > 512) {
      this.log(`SUSPICIOUS: packet claims ${length} bytes — dropped`);
      return { cc: null, data: null };
    }
    const rest = await this.t.readExactly(length, deadline);
    if (!rest) {
      this.log(`TIMEOUT: got ${head.length}/${9 + length} bytes`);
      return { cc: null, data: null };
    }
    const frame = new Uint8Array(9 + length);
    frame.set(head);
    frame.set(rest, 9);
    this.log(`RX (${frame.length}B): ${hex(frame)}`);

    try {
      const { cc, data } = parseResponse(frame);
      this.log(`  → 0x${cc.toString(16).padStart(2, '0').toUpperCase()} ${ccText(cc)}`);
      return { cc, data };
    } catch (e) {
      this.log(`Parse error: ${e.message}`);
      return { cc: null, data: null };
    }
  }

  // Receive a PID 0x02/0x08 data stream (follows an UpChar/ReadINFpage ACK).
  async recvStream(timeoutMs = 5000, maxBytes = 2048) {
    const deadline = Date.now() + timeoutMs;
    let payload = [];
    for (;;) {
      const head = await this.t.readExactly(9, deadline);
      if (!head) { this.log('TIMEOUT reading data-stream header'); break; }
      if (head[0] !== 0xef || head[1] !== 0x01) {
        this.log(`Bad header in data stream: ${hex(head.slice(0, 2))}`); break;
      }
      const pid = head[6];
      const length = (head[7] << 8) | head[8];
      if (length < 2) { this.log(`Invalid packet length: ${length}`); break; }

      const rest = await this.t.readExactly(length, deadline);
      if (!rest) { this.log('TIMEOUT reading data-stream body'); break; }

      const chunk = rest.slice(0, length - 2);
      const csRecv = (rest[length - 2] << 8) | rest[length - 1];
      let csCalc = pid + head[7] + head[8];
      for (const b of chunk) csCalc += b;
      csCalc &= 0xffff;
      if (csRecv !== csCalc) { this.log('Checksum mismatch in data stream'); break; }

      payload = payload.concat(Array.from(chunk));
      if (payload.length > maxBytes) {
        this.log(`Data stream exceeded ${maxBytes} byte limit`); break;
      }
      if (pid === PID_END) break;
    }
    return new Uint8Array(payload);
  }

  async sendStream(data, pktSize = 128) {
    for (let off = 0; off < data.length; off += pktSize) {
      const chunk = data.slice(off, Math.min(off + pktSize, data.length));
      const isLast = off + chunk.length >= data.length;
      await this.t.write(buildDataPacket(isLast ? PID_END : PID_DATA, chunk));
    }
  }

  // ── Device info ──────────────────────────────────────────────────────────

  async verifyPassword(pwBytes = [0, 0, 0, 0]) {
    const { cc } = await this.sendRecv(CMD.VERIFYPASSWORD, pwBytes);
    return cc;
  }

  async readSysParam() {
    const { cc, data } = await this.sendRecv(CMD.READSYSPARAM);
    if (cc !== 0x00 || !data || data.length < 16) return null;
    const u16 = (i) => (data[i] << 8) | data[i + 1];
    return {
      capacity: u16(4),
      secLevel: u16(6),
      pktIdx: u16(12),
      baudN: u16(14),
    };
  }

  async templateCount() {
    const { cc, data } = await this.sendRecv(CMD.TEMPLATECOUNT);
    if (cc !== 0x00 || !data || data.length < 2) return null;
    return (data[0] << 8) | data[1];
  }

  async fingerPresent() {
    const { cc } = await this.sendRecv(CMD.GETIMAGE);
    return cc;
  }

  // ACK and data stream are one exchange — hold the lock across both.
  readInfoPage() {
    return this._locked(async () => {
      const { cc } = await this._sendRecv(CMD.READINFPAGE);
      if (cc !== 0x00) return null;
      return await this.recvStream(5000, 512);
    });
  }

  async storageMap(capacity = this.capacity) {
    const need = Math.ceil(capacity / 8);
    const { cc, data } = await this.sendRecv(CMD.READ_INDEX, [0x00]);
    if (cc !== 0x00 || !data || data.length < need) return null;
    const states = [];
    for (let i = 0; i < capacity; i++) {
      states.push(!!(data[i >> 3] & (1 << (i % 8))));
    }
    return states;
  }

  // ── Enrollment / matching ────────────────────────────────────────────────

  async getImage() {
    const { cc } = await this.sendRecv(CMD.GETIMAGE, [], 800);
    return cc;
  }

  async image2Tz(buf) {
    const { cc } = await this.sendRecv(CMD.IMAGE2TZ, [buf]);
    return cc;
  }

  async regModel() {
    const { cc } = await this.sendRecv(CMD.REGMODEL);
    return cc;
  }

  async store(id, buf = 1) {
    const { cc } = await this.sendRecv(CMD.STORE, [buf, (id >> 8) & 0xff, id & 0xff]);
    return cc;
  }

  async load(id, buf = 1) {
    const { cc } = await this.sendRecv(CMD.LOAD, [buf, (id >> 8) & 0xff, id & 0xff]);
    return cc;
  }

  // 1:N search over the whole library.
  //
  // HiSpeedSearch (0x1B) is a Synochip/AS608-era extension, not part of the
  // Hi-Link EF-01 instruction set (protocol manual V1.1). ZW1xx firmware
  // accepts it, ZW30xx rejects it with 0x13 "wrong password". Probe once, then
  // stay on the documented Search (0x04) for the rest of the session.
  search(capacity = this.capacity) {
    return this._locked(async () => {
      const params = [0x01, 0x00, 0x00, (capacity >> 8) & 0xff, capacity & 0xff];

      if (this.hiSpeedSearch) {
        const r = await this._sendRecv(CMD.HISPEEDSEARCH, params);
        // cc null is a comm error, which says nothing about opcode support —
        // only latch off when the module actually replied.
        if (r.cc !== null && !isSearchReply(r.cc, r.data)) {
          this.hiSpeedSearch = false;
          this.log(
            `HISPEEDSEARCH (0x1B) rejected with ${ccText(r.cc)} — this firmware ` +
            `does not implement it; using SEARCH (0x04) from now on`
          );
        } else {
          return r;
        }
      }
      return await this._sendRecv(CMD.SEARCH, params);
    });
  }

  // ── Template management ──────────────────────────────────────────────────

  async deleteRange(first, count) {
    const { cc } = await this.sendRecv(CMD.DELETE, [
      (first >> 8) & 0xff, first & 0xff, (count >> 8) & 0xff, count & 0xff,
    ]);
    return cc;
  }

  async emptyLibrary() {
    const { cc } = await this.sendRecv(CMD.EMPTY);
    return cc;
  }

  exportTemplate(id) {
    return this._locked(async () => {
      const load = await this._sendRecv(CMD.LOAD, [0x01, (id >> 8) & 0xff, id & 0xff]);
      if (load.cc !== 0x00) return { error: `Load ID ${id}: ${ccText(load.cc)}` };

      const { cc } = await this._sendRecv(CMD.UPCHAR, [0x01]);
      if (cc !== 0x00) return { error: `UpChar rejected: ${ccText(cc)}` };

      const data = await this.recvStream();
      if (!data.length) return { error: 'No template data received' };
      return { data };
    });
  }

  importTemplate(id, data) {
    return this._locked(async () => {
      const { cc } = await this._sendRecv(CMD.DOWNCHAR, [0x01]);
      if (cc !== 0x00) return { error: `DownChar rejected: ${ccText(cc)}` };

      await this.sendStream(data);
      const store = await this._sendRecv(CMD.STORE, [0x01, (id >> 8) & 0xff, id & 0xff]);
      if (store.cc !== 0x00) return { error: `Store failed: ${ccText(store.cc)}` };
      return {};
    });
  }

  // ── LED ──────────────────────────────────────────────────────────────────

  // Returns 'aura' | 'simple' | 'unsupported' so the UI can tell the user what
  // their module actually did rather than silently degrading.
  async led(func, color, cycles) {
    const { cc } = await this.sendRecv(CMD.AURALEDCONFIG, [func, color, color, cycles]);
    if (cc === 0x00) return 'aura';

    // AURALEDCONFIG is ZW1xx-only; passive variants may still do on/off.
    const fallback = func === 4 ? CMD.LEDOFF : CMD.LEDON;
    const r2 = await this.sendRecv(fallback);
    return r2.cc === 0x00 ? 'simple' : 'unsupported';
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  async writeReg(reg, value) {
    const { cc } = await this.sendRecv(CMD.WRITE_REG, [reg, value]);
    return cc;
  }

  async setPassword(pwBytes) {
    const { cc } = await this.sendRecv(CMD.SETPASSWORD, pwBytes);
    return cc;
  }

  // ── Capability probe ─────────────────────────────────────────────────────

  // Ask the module which optional opcodes it actually implements. This is the
  // thing that turns "wrong password on match" from a forensic exercise into a
  // screenshot — see issue #1.
  probeCapabilities() {
    return this._locked(async () => {
      const results = [];
      const add = (name, code, cc, note = '') => results.push({
        name, code, cc,
        ok: cc === 0x00 || cc === 0x09 || cc === 0x24,
        note,
      });

      let r = await this._sendRecv(CMD.READSYSPARAM);
      add('Read system params', '0x0F', r.cc);

      r = await this._sendRecv(CMD.TEMPLATECOUNT);
      add('Template count', '0x1D', r.cc);

      r = await this._sendRecv(CMD.READ_INDEX, [0x00]);
      add('Storage index map', '0x1F', r.cc);

      // Both search opcodes need a feature in CharBuffer1 to return a real
      // result, but an unimplemented opcode is rejected before that matters —
      // which is exactly what we are testing for. 0x09 "not found" therefore
      // counts as supported.
      const params = [0x01, 0x00, 0x00, (this.capacity >> 8) & 0xff, this.capacity & 0xff];
      r = await this._sendRecv(CMD.SEARCH, params);
      add('Search', '0x04', r.cc,
        r.cc === 0x31 ? 'blocked by the module encryption level' : '');

      r = await this._sendRecv(CMD.HISPEEDSEARCH, params);
      add('HiSpeedSearch', '0x1B', r.cc,
        r.cc === 0x13 ? 'normal on ZW30xx — falls back to 0x04 automatically' : '');

      r = await this._sendRecv(CMD.AURALEDCONFIG, [LED_FUNC.OFF, 0, 0, 0]);
      add('Aura RGB LED', '0x3C', r.cc,
        r.cc !== 0x00 ? 'no RGB LED on this variant' : '');

      r = await this._sendRecv(CMD.READINFPAGE);
      if (r.cc === 0x00) await this.recvStream(3000, 512);
      add('Info page', '0x16', r.cc);

      return results;
    });
  }
}
