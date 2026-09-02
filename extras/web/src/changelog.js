// Release notes shown in the "What's new" tab.
//
// Kept as data rather than fetched from the GitHub releases API so the tab
// works offline — this tester is often run on a bench machine with no network,
// and a rate-limited or failed fetch would be worse than a stale list. Add an
// entry here in the same commit that bumps package.json; test/changelog.test.mjs
// checks the shape and ordering.
//
// kind: 'added' | 'changed' | 'fixed' | 'note'
// date: ISO day, or null for a version that has not been tagged yet.

export const CHANGELOG = [
  {
    version: '1.4.0',
    date: '2026-09-02',
    title: 'Firefox support',
    changes: [
      ['added', 'Firefox 151+ works. Mozilla shipped the Web Serial API in May 2026, and the tester runs on it unmodified — same features as Chrome and Edge.'],
      ['added', 'This tab, plus the version and commit in the header. Both are attached to problem reports automatically.'],
      ['changed', 'On Firefox, the connect hint now warns that the first connection installs a small site-permission add-on before the port picker opens. Cancelling that prompt used to look like a dead sensor.'],
      ['changed', 'The unsupported-browser notice names every browser that works instead of claiming Web Serial is Chromium-only.'],
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-06',
    title: 'On-chip RNG and raw image capture',
    changes: [
      ['added', 'Random number card — samples the module\u2019s on-chip hardware RNG (0x14). Independent of the fingerprint sensor, so no finger scan is needed.'],
      ['added', 'Raw image capture (0x01 + 0x0A) with a live width / height / bit-depth explorer and PNG export.'],
      ['note', 'Confirmed on real HLK-ZW101 hardware: the module returns exactly 3200 bytes \u2014 160\u00d7160 at 1 bit per pixel, its default binarized image. Not the 4-bit grayscale Hi-Link\u2019s demo software assumes, and not the datasheet\u2019s 80\u00d764 either.'],
    ],
  },
  {
    version: '1.2.0',
    date: '2026-07-28',
    title: 'First release of the web tester',
    changes: [
      ['added', 'The web tester itself \u2014 full feature parity with the Python desktop tester, with nothing to install.'],
      ['added', 'Capability probe — asks your module which optional opcodes it actually implements, so an unusual variant explains itself instead of surfacing as a confusing confirm code.'],
      ['added', 'Problem reporting that attaches the device snapshot and the session log.'],
      ['fixed', 'ZW30xx modules could never match a fingerprint. The tester probes HiSpeedSearch (0x1B) once and falls back to the documented Search (0x04) on any reply that is not a genuine search result.'],
    ],
  },
];

/** The newest entry — what a fresh build is running. */
export const LATEST = CHANGELOG[0];
