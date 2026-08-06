// Raw PS_UpImage (0x0A) payload decoding.
//
// Two different "sources of truth" disagree about what this stream actually
// contains: the general Hi-Link protocol doc says "one byte packs two 4-bit
// pixels" and their Finger_Demo software offers a fixed 88×112 / 96×122 /
// 160×160 / 256×288 size picker, while the HLK-ZW101 datasheet
// (extras/HLK-ZW101 Datasheet.pdf §2.1) states the sensor array is 80×64.
// Neither is right on its own. CONFIRMED on real HLK-ZW101 hardware (via
// examples/random_and_image): PS_UpImage returns exactly 3200 bytes, which
// is the Hi-Link demo's "160 × 160" size at 1 bit/pixel — i.e. the module
// is sending its *preprocessed/binarized* image (ImageFormat register
// default), not the "original" grayscale image the demo software's 2 px/byte
// math assumes. The datasheet's 80×64 doesn't correspond to the wire format
// at any bit depth — it's presumably describing the raw sensor die, not what
// PS_UpImage streams.
//
// Other HLK-ZW variants (ZW111, ZW06xx, ZW302x, …) are unconfirmed and may
// well differ, so this still exposes an interactive reshape rather than
// hardcoding a single answer — the fastest reliable way to confirm an
// unfamiliar module's layout is to watch for a recognizable fingerprint
// pattern versus noise.

// Candidate frame sizes to offer as quick picks. The first is a confirmed
// default for the HLK-ZW101; the rest are starting points to try, not
// guaranteed correct for other module/firmware revisions.
export const IMAGE_PRESETS = [
  { label: 'HLK-ZW101 (confirmed): 160 × 160 @ 1-bit', width: 160, height: 160, bitsPerPixel: 1 },
  { label: '88 × 112 (Hi-Link demo, unconfirmed)', width: 88, height: 112, bitsPerPixel: 4 },
  { label: '96 × 122 (Hi-Link demo, unconfirmed)', width: 96, height: 122, bitsPerPixel: 4 },
  { label: '160 × 160 (Hi-Link demo @ 4-bit, unconfirmed)', width: 160, height: 160, bitsPerPixel: 4 },
  { label: '256 × 288 (Hi-Link demo, unconfirmed)', width: 256, height: 288, bitsPerPixel: 4 },
  { label: 'ZW101 datasheet pixels (80 × 64, does not match wire format)', width: 80, height: 64, bitsPerPixel: 8 },
];

// Bit depths worth trying: 8 = plain grayscale byte/pixel, 4 = two nibbles
// packed per byte (what the protocol doc claims), 2 = four 2-bit samples
// per byte, 1 = eight binary samples per byte (a "preprocessed" bitmap —
// ImageFormat register defaults to this mode per the parameter table).
export const BIT_DEPTHS = [8, 4, 2, 1];

// Bytes needed for width×height at a given bit depth.
export function expectedBytes(width, height, bitsPerPixel) {
  return Math.ceil((width * height * bitsPerPixel) / 8);
}

// Unpack `data` into an 8-bit grayscale pixel array for width×height at the
// given bit depth. Samples are read most-significant-first within each byte.
// Missing bytes are treated as 0 (black) so a too-small buffer still renders
// instead of throwing — useful while hunting for the right dimensions.
export function unpackImage(data, width, height, bitsPerPixel) {
  const count = width * height;
  const pixels = new Uint8ClampedArray(count);
  const perByte = 8 / bitsPerPixel;
  const maxVal = (1 << bitsPerPixel) - 1;

  for (let i = 0; i < count; i++) {
    const byteIdx = Math.floor(i / perByte);
    const byte = data[byteIdx] ?? 0;
    const slot = i % perByte;
    const shift = bitsPerPixel * (perByte - 1 - slot);
    const sample = (byte >> shift) & maxVal;
    pixels[i] = Math.round((sample / maxVal) * 255);
  }
  return pixels;
}

// Find every (preset, bit depth) combination whose expected byte count
// matches the received length exactly. A real signal, but more than one can
// match the same length by coincidence — the caller should still let the
// user eyeball the result rather than trust the first hit blindly.
export function suggestLayouts(byteLength, presets = IMAGE_PRESETS) {
  const hits = [];
  for (const p of presets) {
    for (const bpp of BIT_DEPTHS) {
      if (expectedBytes(p.width, p.height, bpp) === byteLength) {
        hits.push({
          width: p.width, height: p.height, bitsPerPixel: bpp,
          label: `${p.label} @ ${bpp}-bit`,
        });
      }
    }
  }
  return hits;
}
