// EF-01 packet framing.
//
// Layout: EF 01 | FF FF FF FF | PID | LenH LenL | body… | CS_H CS_L
// Length field counts the body plus the two checksum bytes.
// Checksum is PID + LenH + LenL + every body byte, masked to 16 bits.

import { HEADER, ADDR, PID_CMD } from './constants.js';

export function checksum(pid, lenH, lenL, body) {
  let s = pid + lenH + lenL;
  for (const b of body) s += b;
  return s & 0xffff;
}

export function buildPacket(ins, params = [], pid = PID_CMD) {
  const body = [ins, ...params];
  const length = body.length + 2;
  const lenH = (length >> 8) & 0xff;
  const lenL = length & 0xff;
  const cs = checksum(pid, lenH, lenL, body);
  return new Uint8Array([
    ...HEADER, ...ADDR, pid, lenH, lenL, ...body,
    (cs >> 8) & 0xff, cs & 0xff,
  ]);
}

// Build a raw data-stream packet (PID 0x02 chunk / 0x08 end).
export function buildDataPacket(pid, chunk) {
  const length = chunk.length + 2;
  const lenH = (length >> 8) & 0xff;
  const lenL = length & 0xff;
  const cs = checksum(pid, lenH, lenL, chunk);
  return new Uint8Array([
    ...HEADER, ...ADDR, pid, lenH, lenL, ...chunk,
    (cs >> 8) & 0xff, cs & 0xff,
  ]);
}

// Parse a complete response frame. Throws on any framing/checksum problem so
// callers can surface the reason rather than silently treating it as no-reply.
export function parseResponse(buf) {
  if (buf.length < 12) throw new Error(`too short (${buf.length} bytes)`);
  if (buf[0] !== HEADER[0] || buf[1] !== HEADER[1]) {
    throw new Error(`bad header: ${hex(buf.slice(0, 2))}`);
  }
  const pid = buf[6];
  const length = (buf[7] << 8) | buf[8];
  if (length < 2) throw new Error(`invalid length field: ${length}`);
  if (buf.length < 9 + length) throw new Error('truncated body');

  const body = buf.slice(9, 9 + length - 2);
  const csRecv = (buf[9 + length - 2] << 8) | buf[9 + length - 1];
  const csCalc = checksum(pid, buf[7], buf[8], body);
  if (csRecv !== csCalc) {
    throw new Error(
      `checksum mismatch (got ${csRecv.toString(16)}, expected ${csCalc.toString(16)})`
    );
  }
  if (body.length === 0) throw new Error('empty body');
  return { pid, cc: body[0], data: body.slice(1) };
}

export function hex(bytes, sep = ' ') {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(sep);
}

// A search command answers with a match payload (ID + score), "not found",
// "library empty", or "residual fingerprint". Anything else — including 0x00
// with no payload — means the firmware did not run the search.
//
// This mirrors _isSearchReply() in src/HLK_fingerprint.cpp and
// is_search_reply() in extras/HLK_ZW_Tester_Program.py.
export function isSearchReply(cc, data) {
  if (cc === 0x00) return !!data && data.length >= 4;
  return cc === 0x09 || cc === 0x17 || cc === 0x24;
}
