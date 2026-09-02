# Firefox Web Serial — investigation notes

Context: [issue #7, "No response on Firefox"](https://github.com/GavinnnTann/HLK-ZW-Fingerprint-Sensor/issues/7).
The tester used to hard-code "Chromium-only" in its unsupported-browser notice.
That stopped being true in May 2026.

## Finding

**Firefox 151+ (desktop) runs the tester unmodified. No protocol or transport
code had to change.** Only the browser-support copy was wrong.

Firefox 151 shipped 19 May 2026 with Web Serial enabled by default on desktop
([Mozilla Hacks announcement](https://hacks.mozilla.org/2026/05/web-serial-support-in-firefox/)).
It is not behind a pref, but it *is* off by default under Enterprise Policies.

## What was verified

Firefox 154.0 on Windows 11, clean profile, page served from `http://127.0.0.1`
(a secure context, so Web Serial is exposed):

- Every API member the tester touches is present — see the table below.
- The built app renders the normal UI, not the `Unsupported` screen, so the
  existing `'serial' in navigator` feature detection already does the right
  thing on Firefox.
- `npm test` (25 protocol tests) still passes; the protocol layer is transport
  agnostic and was never the issue.

| Member | Used by | Firefox 154 |
|---|---|---|
| `navigator.serial` | `App.jsx` feature detect | present |
| `serial.requestPort()` | `App.jsx` connect | present |
| `serial.getPorts()` | — | present |
| `serial` `connect`/`disconnect` events | `App.jsx` unplug handling | present |
| `SerialPort.open()` / `close()` | `SerialTransport` | present |
| `SerialPort.readable` / `writable` | `SerialTransport` read loop / write | present |
| `SerialPort.getInfo()` | probe page only | present |
| `SerialPort.getSignals()` / `setSignals()` | — | present |
| `SerialPort.forget()`, `SerialPort.connected` | — | present |

This matches [MDN's compat data](https://github.com/mdn/browser-compat-data/blob/main/api/SerialPort.json),
which marks the whole non-Bluetooth surface as `firefox: 151`. The only entries
Firefox lacks are the Bluetooth RFCOMM extensions
(`allowedBluetoothServiceClassIds`, `filters.bluetoothServiceClassId`,
`getInfo().bluetoothServiceClassId`), none of which this tester uses.

Reproduce with:

```bash
cd extras/web/dev && python -m http.server 8391 --bind 127.0.0.1
# then open http://127.0.0.1:8391/serial-probe.html in the browser under test
```

## What still needs a human with hardware

Headless Firefox cannot raise the permission prompts, so these were **not**
exercised in the investigation. Run them on the branch before closing #7:

- [ ] Click **Connect to sensor**. Confirm the add-on install prompt appears
      *first*, then the port picker. Accept both.
- [ ] Confirm the port picker lists the CH340 / CP2102 / FTDI adapter.
- [ ] Confirm auto-query populates variant, capacity and system params at
      57600 8N1 — i.e. bytes actually flow both ways.
- [ ] Enroll, match and delete a template.
- [ ] **Raw image capture.** The biggest read (3200+ bytes over many packets)
      is the most likely place for a chunking difference between engines to
      show up.
- [ ] Unplug the adapter while connected; confirm the `disconnect` event fires
      on `navigator.serial` and the UI reports "Device unplugged". MDN's compat
      data only tracks these events on `SerialPort`, not on `Serial`, so this
      one is worth an explicit check.
- [ ] Cancel the add-on prompt and confirm the failure message is
      understandable rather than looking like a dead sensor.
- [ ] Repeat connect → disconnect → connect; Firefox should reuse the granted
      permission and skip the add-on step the second time.

## Behavioural differences from Chromium

1. **Add-on gating.** Firefox reuses the site-permission add-on flow it built
   for Web MIDI. The install prompt precedes the port picker on a site's first
   `requestPort()`. `ConnectionBar` now says so when the UA is Firefox.
2. **Enterprise policy.** `DefaultSerialGuardSetting` — Web Serial is disabled
   by default in managed installs.
3. **No mobile.** Firefox for Android does not implement it. (Chrome for
   Android 138+ only exposes Bluetooth RFCOMM ports, never USB, so mobile is
   not a target for this tester either way.)

## Changes made on this branch

- `src/App.jsx` — unsupported-browser copy: Firefox 151+ listed as supported,
  Safari and mobile called out, enterprise policy mentioned.
- `src/components/ConnectionBar.jsx` — Firefox-only connect hint about the
  add-on prompt.
- `README.md`, `README.md` (web) — browser support tables and prose.
- `dev/serial-probe.html` — new, dependency-free capability probe.
