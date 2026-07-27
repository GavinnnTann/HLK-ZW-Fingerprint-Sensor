// Protocol conformance tests — run with: node --test test/
//
// The reference vectors are the real packets from GitHub issue #1 (ZW3020
// failing to match), so a regression here is a regression against hardware
// behaviour we have actually observed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPacket, parseResponse, hex, isSearchReply } from '../src/protocol/packet.js';
import { CMD, ccText } from '../src/protocol/constants.js';
import { FingerprintDriver } from '../src/protocol/driver.js';

test('buildPacket reproduces the GetImage frame from issue #1', () => {
  assert.equal(hex(buildPacket(CMD.GETIMAGE)), 'EF 01 FF FF FF FF 01 00 03 01 00 05');
});

test('buildPacket reproduces the Image2Tz frame from issue #1', () => {
  assert.equal(hex(buildPacket(CMD.IMAGE2TZ, [0x01])),
    'EF 01 FF FF FF FF 01 00 04 02 01 00 08');
});

test('buildPacket reproduces the HiSpeedSearch frame from issue #1', () => {
  // buffer 1, page 0, 100 slots — the exact bytes the reporter sent
  const pkt = buildPacket(CMD.HISPEEDSEARCH, [0x01, 0x00, 0x00, 0x00, 0x64]);
  assert.equal(hex(pkt), 'EF 01 FF FF FF FF 01 00 08 1B 01 00 00 00 64 00 89');
});

test('parseResponse decodes the 0x13 rejection from issue #1', () => {
  const rx = new Uint8Array([0xef, 0x01, 0xff, 0xff, 0xff, 0xff, 0x07, 0x00, 0x03, 0x13, 0x00, 0x1d]);
  const { cc, data } = parseResponse(rx);
  assert.equal(cc, 0x13);
  assert.equal(data.length, 0);
  assert.equal(ccText(cc), 'Wrong password');
});

test('parseResponse decodes an OK ack', () => {
  const rx = new Uint8Array([0xef, 0x01, 0xff, 0xff, 0xff, 0xff, 0x07, 0x00, 0x03, 0x00, 0x00, 0x0a]);
  assert.equal(parseResponse(rx).cc, 0x00);
});

test('parseResponse rejects a corrupted checksum', () => {
  const rx = new Uint8Array([0xef, 0x01, 0xff, 0xff, 0xff, 0xff, 0x07, 0x00, 0x03, 0x00, 0xff, 0xff]);
  assert.throws(() => parseResponse(rx), /checksum mismatch/);
});

test('parseResponse rejects a bad header', () => {
  const rx = new Uint8Array([0xaa, 0xbb, 0xff, 0xff, 0xff, 0xff, 0x07, 0x00, 0x03, 0x00, 0x00, 0x0a]);
  assert.throws(() => parseResponse(rx), /bad header/);
});

test('isSearchReply distinguishes real answers from opcode rejection', () => {
  assert.equal(isSearchReply(0x00, new Uint8Array([0, 7, 0, 142])), true, 'match payload');
  assert.equal(isSearchReply(0x09, new Uint8Array()), true, 'not found');
  assert.equal(isSearchReply(0x24, new Uint8Array()), true, 'library empty');
  assert.equal(isSearchReply(0x17, new Uint8Array()), true, 'residual fingerprint');
  assert.equal(isSearchReply(0x00, new Uint8Array()), false, '0x00 with no payload');
  assert.equal(isSearchReply(0x13, new Uint8Array()), false, 'wrong-password rejection');
  assert.equal(isSearchReply(0x31, new Uint8Array()), false, 'encryption-level block');
});

// ── Search fallback, driven through a fake module ──────────────────────────

/** Minimal stand-in for SerialTransport that answers from a scripted table. */
function fakeModule({ supportsHiSpeed }) {
  const calls = { 0x1b: 0, 0x04: 0 };
  // cc OK, then PageID (u16) = 7 and MatchScore (u16) = 142
  const hit = [0x00, 0x00, 0x07, 0x00, 0x8e];

  const transport = {
    isOpen: true,
    flushInput() {},
    _pending: null,
    async write(pkt) {
      const ins = pkt[9];
      if (ins === 0x1b) {
        calls[0x1b]++;
        this._pending = supportsHiSpeed ? hit : [0x13];
      } else if (ins === 0x04) {
        calls[0x04]++;
        this._pending = hit;
      } else {
        this._pending = [0x00];
      }
    },
    async readExactly(n) {
      if (this._frame === undefined || this._frame.length === 0) {
        const body = this._pending;
        const length = body.length + 2;
        let cs = 0x07 + (length >> 8) + (length & 0xff);
        for (const b of body) cs += b;
        cs &= 0xffff;
        this._frame = [
          0xef, 0x01, 0xff, 0xff, 0xff, 0xff, 0x07,
          (length >> 8) & 0xff, length & 0xff,
          ...body, (cs >> 8) & 0xff, cs & 0xff,
        ];
      }
      const out = new Uint8Array(this._frame.slice(0, n));
      this._frame = this._frame.slice(n);
      return out;
    },
  };
  return { transport, calls };
}

function driverWith(transport) {
  const d = new FingerprintDriver(() => {});
  d.t = transport;
  d.capacity = 100;
  return d;
}

test('ZW1xx-class module keeps using HiSpeedSearch', async () => {
  const { transport, calls } = fakeModule({ supportsHiSpeed: true });
  const d = driverWith(transport);

  for (let i = 0; i < 3; i++) {
    const { cc, data } = await d.search();
    assert.equal(cc, 0x00);
    assert.equal((data[0] << 8) | data[1], 7, 'matched slot');
    assert.equal((data[2] << 8) | data[3], 142, 'score');
  }
  assert.equal(calls[0x1b], 3, 'used 0x1B every time');
  assert.equal(calls[0x04], 0, 'never fell back');
  assert.equal(d.hiSpeedSearch, true);
});

test('ZW30xx-class module probes 0x1B once, then uses 0x04', async () => {
  const { transport, calls } = fakeModule({ supportsHiSpeed: false });
  const d = driverWith(transport);

  const first = await d.search();
  assert.equal(first.cc, 0x00, 'fallback produced a match');
  assert.equal((first.data[0] << 8) | first.data[1], 7);
  assert.equal(d.hiSpeedSearch, false, 'latched off');

  await d.search();
  await d.search();

  assert.equal(calls[0x1b], 1, 'probed 0x1B exactly once');
  assert.equal(calls[0x04], 3, 'every search resolved via 0x04');
});

test('a comm error does not latch HiSpeedSearch off', async () => {
  const d = new FingerprintDriver(() => {});
  d.t = { isOpen: true, flushInput() {}, async write() {}, async readExactly() { return null; } };
  await d.search();
  assert.equal(d.hiSpeedSearch, true, 'timeout says nothing about opcode support');
});
