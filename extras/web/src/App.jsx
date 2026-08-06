import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FingerprintDriver } from './protocol/driver.js';
import { ccText, VARIANT_MAP } from './protocol/constants.js';
import { IMAGE_PRESETS, suggestLayouts } from './protocol/image.js';
import { hex } from './protocol/packet.js';
import ConnectionBar from './components/ConnectionBar.jsx';
import DeviceTab from './components/DeviceTab.jsx';
import ManageTab from './components/ManageTab.jsx';
import SettingsTab from './components/SettingsTab.jsx';
import LogPanel from './components/LogPanel.jsx';
import { ThemeToggle } from './components/ui.jsx';
import RegistryLinks from './components/RegistryLinks.jsx';
import ReportDialog from './components/ReportDialog.jsx';
import { REPO_URL } from './lib/report.js';

const MAX_LOG_LINES = 4000;
const supported = typeof navigator !== 'undefined' && 'serial' in navigator;

export default function App() {
  const [tab, setTab] = useState('device');
  const [lines, setLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mapStates, setMapStates] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [baudRate, setBaudRate] = useState(57600);
  const [stopBits, setStopBits] = useState(1);
  const [password, setPassword] = useState('00000000');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'system');
  // Resolved appearance — with theme 'system' this follows the OS, so the
  // toggle icon always shows what a click will actually change.
  const [isDark, setIsDark] = useState(false);
  const [device, setDevice] = useState({
    capacity: 50, variant: '', sysParams: null, count: null,
    statusText: 'Disconnected', statusTone: '',
    capabilities: null, enrollStatus: '', enrollProgress: 0,
    matchText: null, matchTone: 'idle', matchDetail: '', ledMode: null,
    randomValue: null, randomHex: null, imageBytes: null, imageStatus: '',
  });
  // Raw-image reshape controls, lifted here (not local to DeviceTab) so the
  // capture op can auto-apply a detected layout after a successful upload.
  const firstPreset = IMAGE_PRESETS[0];
  const [imgWidth, setImgWidth] = useState(firstPreset.width);
  const [imgHeight, setImgHeight] = useState(firstPreset.height);
  const [imgBpp, setImgBpp] = useState(firstPreset.bitsPerPixel);

  const cancelRef = useRef(false);
  const patch = useCallback((p) => setDevice((d) => ({ ...d, ...p })), []);

  const log = useCallback((msg) => {
    const stamp = new Date().toTimeString().slice(0, 8);
    setLines((prev) => {
      const next = prev.length >= MAX_LOG_LINES ? prev.slice(-MAX_LOG_LINES + 1) : prev.slice();
      next.push(`[${stamp}] ${msg}`);
      return next;
    });
  }, []);

  const driver = useMemo(() => new FingerprintDriver(), []);
  useEffect(() => { driver.log = log; }, [driver, log]);

  // Theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      setIsDark(dark);
    };
    apply();
    localStorage.setItem('theme', theme);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // Physical unplug
  useEffect(() => {
    if (!supported) return;
    const onDisconnect = () => {
      if (driver.isOpen) {
        log('Device disconnected from USB');
        driver.disconnect().finally(() => {
          setConnected(false);
          patch({ statusText: 'Device unplugged', statusTone: 'err' });
        });
      }
    };
    navigator.serial.addEventListener('disconnect', onDisconnect);
    return () => navigator.serial.removeEventListener('disconnect', onDisconnect);
  }, [driver, log, patch]);

  const pwBytes = useCallback(() => {
    const s = password.padStart(8, '0').slice(0, 8);
    return [0, 2, 4, 6].map((i) => parseInt(s.slice(i, i + 2), 16) || 0);
  }, [password]);

  /** Run an operation with the busy flag held, so two sequences never interleave. */
  const run = useCallback(async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      log(`ERROR: ${e.message || e}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, [log]);

  // ── Connection ───────────────────────────────────────────────────────────

  async function connect() {
    setConnecting(true);
    try {
      const port = await navigator.serial.requestPort();
      await driver.connect(port, { baudRate, stopBits });
      setConnected(true);
      log(`Connected @ ${baudRate} 8N${stopBits}`);
      await autoQuery();
    } catch (e) {
      if (e?.name !== 'NotFoundError') log(`Connection failed: ${e.message || e}`);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await driver.disconnect();
    setConnected(false);
    setMapStates(null);
    patch({
      statusText: 'Disconnected', statusTone: '', sysParams: null, count: null,
      variant: '', capabilities: null, matchText: null, matchTone: 'idle',
      matchDetail: '', ledMode: null, enrollStatus: '', enrollProgress: 0,
      randomValue: null, randomHex: null, imageBytes: null, imageStatus: '',
    });
    log('Disconnected.');
  }

  async function autoQuery() {
    await run(async () => {
      const cc = await driver.verifyPassword(pwBytes());
      if (cc === 0x00) patch({ statusText: 'Password OK', statusTone: 'ok' });
      else if (cc === null) { patch({ statusText: 'No response', statusTone: 'err' }); return; }
      else patch({ statusText: ccText(cc), statusTone: 'warn' });

      const sp = await driver.readSysParam();
      if (sp) {
        driver.capacity = sp.capacity;
        patch({
          sysParams: sp,
          capacity: sp.capacity,
          variant: `${VARIANT_MAP[sp.capacity] ?? 'EF-01 compatible'} (cap=${sp.capacity})`,
        });
      }
      const states = await driver.storageMap(sp?.capacity ?? driver.capacity);
      if (states) {
        setMapStates(states);
        patch({ count: states.filter(Boolean).length });
      } else {
        const n = await driver.templateCount();
        if (n !== null) patch({ count: n });
      }
    });
  }

  // ── Operations ───────────────────────────────────────────────────────────

  const ops = {
    verifyPassword: () => run(async () => {
      const cc = await driver.verifyPassword(pwBytes());
      patch({
        statusText: cc === 0x00 ? 'Password OK' : ccText(cc),
        statusTone: cc === 0x00 ? 'ok' : 'err',
      });
    }),

    readSysParam: () => run(async () => {
      const sp = await driver.readSysParam();
      if (!sp) { log('ReadSysParam not supported or malformed'); return; }
      driver.capacity = sp.capacity;
      patch({
        sysParams: sp, capacity: sp.capacity,
        variant: `${VARIANT_MAP[sp.capacity] ?? 'EF-01 compatible'} (cap=${sp.capacity})`,
      });
    }),

    templateCount: () => run(async () => {
      const n = await driver.templateCount();
      if (n !== null) patch({ count: n });
    }),

    fingerPresent: () => run(async () => {
      const cc = await driver.fingerPresent();
      log(cc === 0x00 ? 'Finger detected' : `No finger — ${ccText(cc)}`);
    }),

    dumpInfoPage: () => run(async () => {
      const page = await driver.readInfoPage();
      if (!page?.length) { log('[Dump] No data received'); return; }
      log(`[Dump] Info page — ${page.length} bytes:`);
      log('       00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F   ASCII');
      for (let i = 0; i < page.length; i += 16) {
        const chunk = page.slice(i, i + 16);
        const lo = hex(chunk.slice(0, 8)).padEnd(23);
        const hi = hex(chunk.slice(8)).padEnd(23);
        const asc = Array.from(chunk)
          .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
          .join('');
        log(`  ${i.toString(16).padStart(4, '0').toUpperCase()}  ${lo}  ${hi}   ${asc}`);
      }
    }),

    // ── Random number / raw image ─────────────────────────────────────────
    getRandom: () => run(async () => {
      const v = await driver.getRandomNumber();
      if (v === null) {
        log('Random number generation failed');
        patch({ randomValue: null, randomHex: null });
        return;
      }
      const hex = `0x${v.toString(16).padStart(8, '0').toUpperCase()}`;
      patch({ randomValue: v, randomHex: hex });
      log(`Random number (PS_GetRandomCode): ${hex} (${v})`);
    }),

    // Captures raw bytes only — DeviceTab reshapes them live at whatever
    // width/height/bit-depth is currently selected, since the module never
    // reports its own resolution or pixel packing (see protocol/image.js).
    captureImage: (timeoutSec) => run(async () => {
      patch({ imageStatus: 'Waiting for finger…', imageBytes: null });
      const deadline = Date.now() + timeoutSec * 1000;

      for (;;) {
        if (Date.now() > deadline) { patch({ imageStatus: 'Timeout — no finger detected' }); return; }
        const cc = await driver.getImage();
        if (cc === 0x00) break;
        if (cc === 0x02) continue;
        patch({ imageStatus: `Image error: ${ccText(cc)}` }); return;
      }

      patch({ imageStatus: 'Uploading image…' });
      const { data, error } = await driver.uploadImage();
      if (error) { patch({ imageStatus: error }); log(`[Image] ${error}`); return; }

      const matches = suggestLayouts(data.length);
      if (matches.length) {
        const m = matches[0];
        setImgWidth(m.width); setImgHeight(m.height); setImgBpp(m.bitsPerPixel);
        log(`[Image] ${data.length} bytes — exact match: ${matches.map((x) => x.label).join(', ')}`);
      } else {
        log(`[Image] ${data.length} bytes received — no exact preset match; adjust width/height/bit-depth and watch the preview for a fingerprint pattern`);
      }
      patch({ imageBytes: data, imageStatus: `Captured — ${data.length} bytes` });
    }),

    probeCapabilities: () => run(async () => {
      log('Probing module capabilities…');
      const caps = await driver.probeCapabilities();
      patch({ capabilities: caps });
      const missing = caps.filter((c) => !c.ok).map((c) => `${c.name} (${c.code})`);
      log(missing.length
        ? `Unsupported on this module: ${missing.join(', ')}`
        : 'All probed opcodes supported.');
    }),

    refreshMap: () => run(async () => {
      const states = await driver.storageMap();
      if (states) {
        setMapStates(states);
        patch({ count: states.filter(Boolean).length });
        log(`Storage map: ${states.filter(Boolean).length} enrolled`);
      } else {
        log('ReadIndex not supported; showing count only');
        const n = await driver.templateCount();
        if (n !== null) patch({ count: n });
      }
    }),

    // ── Enrollment ─────────────────────────────────────────────────────────
    cancelEnroll: () => { cancelRef.current = true; },

    enroll: (wantedId) => run(async () => {
      cancelRef.current = false;
      const status = (s, p) => {
        log(`[Enroll] ${s}`);
        patch({ enrollStatus: s, ...(p !== undefined ? { enrollProgress: p } : {}) });
      };

      let id = wantedId;
      const states = await driver.storageMap();
      if (states) {
        setMapStates(states);
        const free = states.findIndex((s) => !s);
        if (free === -1) { status('No free slots available', 0); return; }
        if (states[id]) {
          id = free;
          log(`Slot ${wantedId} occupied — using next free slot ${id}`);
        }
      }

      status('Scan 1 of 2 — place finger on sensor…', 0);
      for (;;) {
        if (cancelRef.current) { status('Cancelled', 0); return; }
        const cc = await driver.getImage();
        if (cc === 0x00) break;
        if (cc === 0x02) continue;
        status(`Image error: ${ccText(cc)}`, 0); return;
      }

      let cc = await driver.image2Tz(1);
      if (cc !== 0x00) { status(`Feature extraction failed: ${ccText(cc)}`, 0); return; }
      status('Lift your finger…', 2);

      for (;;) {
        if (cancelRef.current) { status('Cancelled', 0); return; }
        if ((await driver.getImage()) === 0x02) break;
      }
      await new Promise((r) => setTimeout(r, 300));

      status('Scan 2 of 2 — place the same finger again…', 4);
      for (;;) {
        if (cancelRef.current) { status('Cancelled', 0); return; }
        const c = await driver.getImage();
        if (c === 0x00) break;
        if (c === 0x02) continue;
        status(`Image error: ${ccText(c)}`, 0); return;
      }

      cc = await driver.image2Tz(2);
      if (cc !== 0x00) { status(`Feature extraction failed: ${ccText(cc)}`, 0); return; }

      status('Merging the two scans…', 6);
      cc = await driver.regModel();
      if (cc === 0x0a) {
        status('Scans did not match — use the same finger for both', 0); return;
      }
      if (cc !== 0x00) { status(`Merge failed: ${ccText(cc)}`, 0); return; }

      status(`Storing as slot ${id}…`, 8);
      cc = await driver.store(id);
      if (cc !== 0x00) { status(`Store failed: ${ccText(cc)}`, 0); return; }

      status(`Enrolled successfully as slot ${id}`, 10);
      const after = await driver.storageMap();
      if (after) { setMapStates(after); patch({ count: after.filter(Boolean).length }); }
    }),

    // ── Matching ───────────────────────────────────────────────────────────
    match: (timeoutSec) => run(async () => {
      patch({ matchText: 'Waiting…', matchTone: 'idle', matchDetail: 'Place finger on sensor' });
      const deadline = Date.now() + timeoutSec * 1000;

      for (;;) {
        if (Date.now() > deadline) {
          patch({ matchText: 'Timeout', matchTone: 'no', matchDetail: 'No finger detected' });
          return;
        }
        const cc = await driver.getImage();
        if (cc === 0x00) break;
        if (cc === 0x02) continue;
        patch({ matchText: 'Error', matchTone: 'no', matchDetail: ccText(cc) });
        return;
      }

      const tz = await driver.image2Tz(1);
      if (tz !== 0x00) {
        patch({ matchText: 'Error', matchTone: 'no', matchDetail: ccText(tz) });
        return;
      }

      const { cc, data } = await driver.search();
      if (cc === 0x00 && data && data.length >= 4) {
        const id = (data[0] << 8) | data[1];
        const score = (data[2] << 8) | data[3];
        patch({ matchText: `Match — slot ${id}`, matchTone: 'ok', matchDetail: `Confidence ${score}` });
        log(`MATCHED slot=${id} confidence=${score}`);
      } else if (cc === 0x09 || cc === 0x00) {
        patch({ matchText: 'No match', matchTone: 'no', matchDetail: '' });
      } else if (cc === 0x24) {
        patch({ matchText: 'No match', matchTone: 'no', matchDetail: 'Library is empty' });
      } else {
        patch({ matchText: 'Error', matchTone: 'no', matchDetail: ccText(cc) });
      }
    }),

    // ── Template management ────────────────────────────────────────────────
    checkExists: (id) => run(async () => {
      const cc = await driver.load(id);
      log(cc === 0x00 ? `Slot ${id}: EXISTS`
        : cc === 0x0c ? `Slot ${id}: empty`
          : `Slot ${id}: ${ccText(cc)}`);
    }),

    deleteOne: (id) => run(async () => {
      if (!confirm(`Delete the fingerprint in slot ${id}?`)) return;
      const cc = await driver.deleteRange(id, 1);
      log(cc === 0x00 ? `Slot ${id} deleted` : `Delete failed: ${ccText(cc)}`);
      await ops.refreshMap();
    }),

    deleteRange: (first, last) => run(async () => {
      if (!confirm(`Delete slots ${first} through ${last}?`)) return;
      const cc = await driver.deleteRange(first, last - first + 1);
      log(cc === 0x00 ? `Slots ${first}–${last} deleted` : `Delete failed: ${ccText(cc)}`);
      await ops.refreshMap();
    }),

    wipeAll: () => run(async () => {
      if (!confirm('Erase EVERY stored fingerprint? This cannot be undone.')) return;
      const cc = await driver.emptyLibrary();
      log(cc === 0x00 ? 'Library wiped' : `Wipe failed: ${ccText(cc)}`);
      await ops.refreshMap();
    }),

    exportTemplate: (id) => run(async () => {
      const { data, error } = await driver.exportTemplate(id);
      if (error) { log(`[Export] ${error}`); return; }

      // .fp container: "HLK" + version + orig slot (u16) + length (u16) + data.
      // Byte-identical to the Python tester's format.
      const out = new Uint8Array(8 + data.length);
      out.set([0x48, 0x4c, 0x4b, 0x01]);
      out[4] = (id >> 8) & 0xff; out[5] = id & 0xff;
      out[6] = (data.length >> 8) & 0xff; out[7] = data.length & 0xff;
      out.set(data, 8);

      const url = URL.createObjectURL(new Blob([out], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `fingerprint_id${String(id).padStart(2, '0')}.fp`;
      a.click();
      URL.revokeObjectURL(url);
      log(`[Export] Slot ${id} — ${data.length} bytes saved`);
    }),

    importTemplate: (id, file) => run(async () => {
      const raw = new Uint8Array(await file.arrayBuffer());
      if (raw.length < 8 || raw[0] !== 0x48 || raw[1] !== 0x4c || raw[2] !== 0x4b) {
        log('[Import] Not a valid .fp template file'); return;
      }
      const origId = (raw[4] << 8) | raw[5];
      const len = (raw[6] << 8) | raw[7];
      if (len > 1024) { log(`[Import] Template too large (${len} bytes)`); return; }
      const data = raw.slice(8, 8 + len);
      if (data.length !== len) {
        log(`[Import] File truncated: expected ${len} bytes, got ${data.length}`); return;
      }
      log(`[Import] ${len}B (original slot ${origId}) → slot ${id}`);

      const { error } = await driver.importTemplate(id, data);
      if (error) { log(`[Import] ${error}`); return; }
      log(`[Import] Stored to slot ${id}`);
      await ops.refreshMap();
    }),

    // ── LED ────────────────────────────────────────────────────────────────
    led: (func, color, cycles) => run(async () => {
      const mode = await driver.led(func, color, cycles);
      patch({ ledMode: mode });
    }),

    // ── Settings ───────────────────────────────────────────────────────────
    setSecurity: (level) => run(async () => {
      const cc = await driver.writeReg(0x05, level);
      log(cc === 0x00 ? `Security level → ${level}` : `Failed: ${ccText(cc)}`);
      if (cc === 0x00) await ops.readSysParam();
    }),

    setPacketSize: (idx) => run(async () => {
      const cc = await driver.writeReg(0x06, idx);
      log(cc === 0x00 ? `Packet size → index ${idx}` : `Failed: ${ccText(cc)}`);
    }),

    setBaud: (n) => run(async () => {
      const cc = await driver.writeReg(0x04, n);
      log(cc === 0x00
        ? `Baud → ${n * 9600}. Disconnect and reconnect at the new rate.`
        : `Failed: ${ccText(cc)}`);
    }),

    changePassword: (current, next) => run(async () => {
      const toBytes = (s) => [0, 2, 4, 6].map((i) => parseInt(s.padStart(8, '0').slice(i, i + 2), 16) || 0);
      const cc = await driver.verifyPassword(toBytes(current));
      if (cc !== 0x00) {
        log(`Current password rejected (${ccText(cc)}) — nothing was changed`);
        return false;
      }
      if (!confirm(`Set the module password to ${next.toUpperCase()}?`)) return false;
      const set = await driver.setPassword(toBytes(next));
      if (set !== 0x00) { log(`Password change failed: ${ccText(set)}`); return false; }
      log('Password changed successfully');
      setPassword(next);
      return true;
    }),
  };

  if (!supported) return <Unsupported />;

  return (
    <div className="app">
      <header className="topbar">
        {/* BASE_URL keeps the public asset resolvable under any deploy path,
            which a hardcoded /favicon.ico would not be with base: './'. */}
        <img className="brand" src={`${import.meta.env.BASE_URL}favicon.ico`} alt="" width="26" height="26" />
        <h1>HLK-ZW Fingerprint Tester</h1>
        <span className="sub">Web Serial · no install required</span>
        <span className="spacer" />
        <RegistryLinks compact />
        <ThemeToggle isDark={isDark} onToggle={() => setTheme(isDark ? 'light' : 'dark')} />
      </header>

      <ConnectionBar
        connected={connected}
        connecting={connecting}
        status={{ text: device.statusText, tone: device.statusTone }}
        onConnect={connect}
        onDisconnect={disconnect}
        baudRate={baudRate}
        setBaudRate={setBaudRate}
        stopBits={stopBits}
        setStopBits={setStopBits}
        password={password}
        setPassword={setPassword}
      />

      <nav className="tabs" style={{ marginTop: 16 }} role="tablist">
        {[
          ['device', 'Device'],
          ['manage', 'Templates'],
          ['settings', 'Settings'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'device' && (
        <DeviceTab
          ops={ops} device={device} mapStates={mapStates} busy={busy} connected={connected}
          imgWidth={imgWidth} setImgWidth={setImgWidth}
          imgHeight={imgHeight} setImgHeight={setImgHeight}
          imgBpp={imgBpp} setImgBpp={setImgBpp}
        />
      )}
      {tab === 'manage' && (
        <ManageTab ops={ops} device={device} busy={busy} connected={connected} />
      )}
      {tab === 'settings' && (
        <SettingsTab
          ops={ops} device={device} busy={busy} connected={connected}
          theme={theme} setTheme={setTheme}
        />
      )}

      <div style={{ marginTop: 14 }}>
        <LogPanel
          lines={lines}
          onClear={() => setLines([])}
          onReport={() => setShowReport(true)}
        />
      </div>

      <footer className="card" style={{ marginTop: 14 }}>
        <p className="install-note">
          Sensor working? Add it to your project — the Arduino library speaks the
          same protocol as this page, including the ZW30xx search fallback.
        </p>
        <RegistryLinks />
      </footer>

      {showReport && (
        <ReportDialog
          onClose={() => setShowReport(false)}
          device={{ ...device, baudRate, stopBits, hiSpeedSearch: driver.hiSpeedSearch }}
          logText={lines.join('\n')}
        />
      )}
    </div>
  );
}

function Unsupported() {
  return (
    <div className="app unsupported">
      <h1>Web Serial is not available in this browser</h1>
      <div className="card" style={{ marginTop: 20 }}>
        <p>
          This tester talks to the sensor over the Web Serial API, which is
          currently implemented only in Chromium-based browsers — Chrome, Edge,
          Opera and Arc. Firefox and Safari do not support it.
        </p>
        <p style={{ marginBottom: 0 }}>
          On Firefox or Safari, use the Python desktop tester in{' '}
          <code>extras/</code> instead — it has the same feature set and runs on
          Windows, macOS and Linux.{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer">View on GitHub</a>
        </p>
      </div>
    </div>
  );
}
