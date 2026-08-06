// protocol/image.js conformance tests — run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { expectedBytes, unpackImage, suggestLayouts, IMAGE_PRESETS } from '../src/protocol/image.js';

test('expectedBytes computes width*height*bpp/8, rounded up', () => {
  assert.equal(expectedBytes(80, 64, 8), 5120);
  assert.equal(expectedBytes(160, 160, 4), 12800);
  assert.equal(expectedBytes(160, 160, 1), 3200);
  assert.equal(expectedBytes(3, 1, 1), 1); // 3 bits → 1 byte, rounded up
});

test('unpackImage at 8-bit is a straight passthrough', () => {
  const data = new Uint8Array([0x00, 0x7f, 0xff, 0x10]);
  const pixels = unpackImage(data, 4, 1, 8);
  assert.deepEqual(Array.from(pixels), [0x00, 0x7f, 0xff, 0x10]);
});

test('unpackImage at 4-bit splits high nibble first', () => {
  const data = new Uint8Array([0xf0, 0x0f]); // pixel0=0xF, pixel1=0x0, pixel2=0x0, pixel3=0xF
  const pixels = unpackImage(data, 4, 1, 4);
  // 0xF/0xF*255=255, 0x0/0xF*255=0
  assert.deepEqual(Array.from(pixels), [255, 0, 0, 255]);
});

test('unpackImage at 1-bit reads MSB first and scales to 0/255', () => {
  const data = new Uint8Array([0b10110000]);
  const pixels = unpackImage(data, 8, 1, 1);
  assert.deepEqual(Array.from(pixels), [255, 0, 255, 255, 0, 0, 0, 0]);
});

test('unpackImage pads missing bytes with 0 instead of throwing', () => {
  const data = new Uint8Array([0xff]);
  const pixels = unpackImage(data, 4, 1, 8); // needs 4 bytes, only 1 given
  assert.deepEqual(Array.from(pixels), [0xff, 0, 0, 0]);
});

test('suggestLayouts finds every exact (preset, bit-depth) match', () => {
  // Confirmed on a physical HLK-ZW101 via examples/random_and_image:
  // PS_UpImage reliably returns exactly 3200 bytes, which is not what 2
  // px/byte (4-bit) predicts for "160 × 160" (12800) but is an exact match
  // for 8 px/byte (1-bit) — the module sends its default "preprocessed"
  // (binarized) image, not the "original" grayscale format Hi-Link's demo
  // software's size picker assumes.
  const hits = suggestLayouts(3200);
  assert.ok(hits.some((h) => h.width === 160 && h.height === 160 && h.bitsPerPixel === 1),
    'expected a 160×160 @ 1-bit match among suggestions');
});

test('suggestLayouts matches the ZW101 datasheet preset at 8-bit', () => {
  const hits = suggestLayouts(80 * 64);
  assert.ok(hits.some((h) => h.width === 80 && h.height === 64 && h.bitsPerPixel === 8));
});

test('suggestLayouts returns nothing for a length matching no preset/depth combo', () => {
  assert.deepEqual(suggestLayouts(1337), []);
});

test('IMAGE_PRESETS leads with the confirmed HLK-ZW101 default', () => {
  assert.equal(IMAGE_PRESETS.length, 6);
  assert.deepEqual(
    { width: IMAGE_PRESETS[0].width, height: IMAGE_PRESETS[0].height, bitsPerPixel: IMAGE_PRESETS[0].bitsPerPixel },
    { width: 160, height: 160, bitsPerPixel: 1 },
  );
  assert.ok(IMAGE_PRESETS.some((p) => p.width === 80 && p.height === 64), 'still ships the datasheet size for reference');
});
