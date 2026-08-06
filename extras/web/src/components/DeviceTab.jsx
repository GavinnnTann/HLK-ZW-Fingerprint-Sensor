import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Pill, NumField, Select } from './ui.jsx';
import StorageMap from './StorageMap.jsx';
import { ccText, LED_COLORS, LED_FUNC, PACKET_SIZES } from '../protocol/constants.js';
import { IMAGE_PRESETS, BIT_DEPTHS, expectedBytes, unpackImage } from '../protocol/image.js';

export default function DeviceTab({
  ops, device, mapStates, busy, connected,
  imgWidth, setImgWidth, imgHeight, setImgHeight, imgBpp, setImgBpp,
}) {
  const [enrollId, setEnrollId] = useState(0);
  const [matchTimeout, setMatchTimeout] = useState(10);
  const [ledColor, setLedColor] = useState(0x01);
  const [ledCycles, setLedCycles] = useState(0);
  const [imageTimeout, setImageTimeout] = useState(10);
  const canvasRef = useRef(null);

  const disabled = !connected || busy;
  const maxId = Math.max(0, device.capacity - 1);
  const pkt = PACKET_SIZES.find((p) => p.idx === device.sysParams?.pktIdx);

  const haveBytes = device.imageBytes?.length ?? 0;
  const expectBytes = expectedBytes(imgWidth, imgHeight, imgBpp);
  const sizeMatches = haveBytes > 0 && haveBytes === expectBytes;

  // Reshape the raw capture at whatever width/height/bit-depth is currently
  // selected — recomputes instantly as the user tweaks the controls, no
  // re-capture needed. See protocol/image.js for why this is interactive
  // instead of a fixed size list.
  const pixels = useMemo(() => {
    if (!device.imageBytes) return null;
    return unpackImage(device.imageBytes, imgWidth, imgHeight, imgBpp);
  }, [device.imageBytes, imgWidth, imgHeight, imgBpp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imgWidth;
    canvas.height = imgHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!pixels) return;
    const frame = ctx.createImageData(imgWidth, imgHeight);
    for (let i = 0; i < pixels.length; i++) {
      const v = pixels[i];
      frame.data[i * 4] = v;
      frame.data[i * 4 + 1] = v;
      frame.data[i * 4 + 2] = v;
      frame.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
  }, [pixels, imgWidth, imgHeight]);

  function saveImagePng() {
    const canvas = canvasRef.current;
    if (!canvas || !pixels) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fingerprint_image_${imgWidth}x${imgHeight}_${imgBpp}bpp.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="grid cols-2">
      {/* ── Device info ─────────────────────────────────────────────────── */}
      <Card title="Device">
        <dl className="kv">
          <dt>Status</dt>
          <dd>
            <Pill tone={device.statusTone}>{device.statusText}</Pill>
          </dd>
          <dt>Variant</dt>
          <dd>{device.variant || '—'}</dd>
          <dt>Capacity</dt>
          <dd>{device.sysParams ? `${device.capacity} slots` : '—'}</dd>
          <dt>Security</dt>
          <dd>{device.sysParams ? `level ${device.sysParams.secLevel}` : '—'}</dd>
          <dt>Packet size</dt>
          <dd>{pkt ? `${pkt.bytes} bytes` : '—'}</dd>
          <dt>Module baud</dt>
          <dd>{device.sysParams ? `${device.sysParams.baudN * 9600}` : '—'}</dd>
          <dt>Enrolled</dt>
          <dd>{device.count ?? '—'}</dd>
        </dl>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="sm" disabled={disabled} onClick={ops.verifyPassword}>Verify password</button>
          <button className="sm" disabled={disabled} onClick={ops.readSysParam}>Read params</button>
          <button className="sm" disabled={disabled} onClick={ops.templateCount}>Count</button>
          <button className="sm" disabled={disabled} onClick={ops.fingerPresent}>Finger present?</button>
          <button className="sm" disabled={disabled} onClick={ops.dumpInfoPage}>Dump info page</button>
        </div>
      </Card>

      {/* ── Capabilities ────────────────────────────────────────────────── */}
      <Card
        title="Module capabilities"
        actions={
          <button className="sm" disabled={disabled} onClick={ops.probeCapabilities}>
            Probe
          </button>
        }
      >
        {!device.capabilities && (
          <p className="hint">
            Not every HLK-ZW variant implements every opcode. Probe asks the
            module directly and shows what it accepts — the fastest way to
            explain unexpected behaviour before filing a report.
          </p>
        )}
        {device.capabilities && (
          <table className="caps">
            <thead>
              <tr><th>Feature</th><th>Opcode</th><th>Result</th></tr>
            </thead>
            <tbody>
              {device.capabilities.map((c) => (
                <tr key={c.code}>
                  <td>{c.name}</td>
                  <td><code>{c.code}</code></td>
                  <td>
                    <Pill tone={c.ok ? 'ok' : 'warn'}>
                      {c.ok ? 'supported' : ccText(c.cc)}
                    </Pill>
                    {c.note && <div className="note">{c.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Enrollment ──────────────────────────────────────────────────── */}
      <Card title="Enrollment">
        <div className="row">
          <NumField
            label={`Target slot (0–${maxId})`}
            value={enrollId}
            onChange={setEnrollId}
            min={0}
            max={maxId}
            disabled={disabled}
          />
          <button className="primary" disabled={disabled} onClick={() => ops.enroll(enrollId)}>
            Start enrollment
          </button>
          <button disabled={!busy} onClick={ops.cancelEnroll}>Cancel</button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Scan the same finger twice, lifting between scans. An occupied slot is
          reassigned to the next free one automatically.
        </p>
        <div className="meter" style={{ marginTop: 10 }}>
          <i style={{ width: `${(device.enrollProgress ?? 0) * 10}%` }} />
        </div>
        <p style={{ marginTop: 8, marginBottom: 0 }}>
          {device.enrollStatus || 'Ready'}
        </p>
      </Card>

      {/* ── Verification ────────────────────────────────────────────────── */}
      <Card title="Verification">
        <div className="row">
          <button className="primary" disabled={disabled} onClick={() => ops.match(matchTimeout)}>
            Match
          </button>
          <NumField
            label="Timeout (s)"
            value={matchTimeout}
            onChange={setMatchTimeout}
            min={1}
            max={60}
            disabled={disabled}
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <div className={`match-result ${device.matchTone ?? 'idle'}`}>
            {device.matchText ?? '—'}
          </div>
          {device.matchDetail && <p className="hint">{device.matchDetail}</p>}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Place your finger on the sensor, then click Match.
        </p>
      </Card>

      {/* ── Storage map ─────────────────────────────────────────────────── */}
      <Card
        title="Storage map"
        opcode="0x1F"
        actions={
          <button className="sm" disabled={disabled} onClick={ops.refreshMap}>Refresh</button>
        }
      >
        <StorageMap states={mapStates} capacity={device.capacity} />
      </Card>

      {/* ── LED ─────────────────────────────────────────────────────────── */}
      <Card title="LED" opcode="0x3C">
        <div className="row">
          <Select
            label="Colour"
            value={ledColor}
            disabled={disabled}
            onChange={(v) => setLedColor(Number(v))}
            options={LED_COLORS.map((c) => ({ value: c.value, label: c.name }))}
          />
          <span
            aria-hidden
            style={{
              width: 18, height: 18, borderRadius: 5,
              background: LED_COLORS.find((c) => c.value === ledColor)?.css,
              border: '1px solid var(--border)',
            }}
          />
          <NumField
            label="Cycles"
            value={ledCycles}
            onChange={setLedCycles}
            min={0}
            max={255}
            disabled={disabled}
          />
          <span className="hint">0 = infinite (breathing / flash only)</span>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {[
            ['Breathing', LED_FUNC.BREATHING],
            ['Flash', LED_FUNC.FLASH],
            ['Steady', LED_FUNC.STEADY],
            ['Grad open', LED_FUNC.GRAD_OPEN],
            ['Grad close', LED_FUNC.GRAD_CLOSE],
          ].map(([label, fn]) => (
            <button
              key={label}
              className="sm"
              disabled={disabled}
              onClick={() => ops.led(fn, ledColor, ledCycles)}
            >
              {label}
            </button>
          ))}
          <button className="sm" disabled={disabled} onClick={() => ops.led(LED_FUNC.OFF, 0, 0)}>
            Off
          </button>
        </div>
        {device.ledMode && (
          <p className="hint" style={{ marginTop: 10 }}>
            {device.ledMode === 'aura'
              ? 'RGB Aura LED active.'
              : device.ledMode === 'simple'
                ? 'This variant has no RGB LED — fell back to simple on/off.'
                : 'This module reports no LED hardware at all (normal on ZW302x).'}
          </p>
        )}
      </Card>

      {/* ── Random number ───────────────────────────────────────────────── */}
      <Card title="Random number" opcode="0x14">
        <div className="row">
          <button className="primary" disabled={disabled} onClick={ops.getRandom}>
            Sample random number
          </button>
          <span className="rng-value">{device.randomHex ?? '—'}</span>
          {device.randomValue != null && (
            <span className="hint">({device.randomValue})</span>
          )}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Reads the module's on-chip hardware RNG (PS_GetRandomCode). Independent
          of the fingerprint sensor — no scan required, safe to call any time.
        </p>
      </Card>

      {/* ── Raw image capture ───────────────────────────────────────────── */}
      <Card title="Raw image capture" opcode="0x01 / 0x0A">
        <div className="row">
          <button className="primary" disabled={disabled} onClick={() => ops.captureImage(imageTimeout)}>
            Capture image
          </button>
          <NumField
            label="Timeout (s)"
            value={imageTimeout}
            onChange={setImageTimeout}
            min={1}
            max={60}
            disabled={disabled}
          />
          <button className="sm" disabled={!pixels} onClick={saveImagePng}>
            Save PNG
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Confirmed on a physical HLK-ZW101: 160 × 160 @ 1-bit (the first
          preset below) — the module sends its default preprocessed/binarized
          image, not the grayscale format Hi-Link's demo software assumes.
          Other HLK-ZW variants are unconfirmed; place your finger, click
          Capture, then tweak width / height / bit depth until the preview
          looks like a fingerprint instead of noise.
        </p>

        <div className="row" style={{ marginTop: 12 }}>
          <NumField label="Width" value={imgWidth} onChange={setImgWidth} min={1} max={512} />
          <NumField label="Height" value={imgHeight} onChange={setImgHeight} min={1} max={512} />
          <Select
            label="Bit depth"
            value={imgBpp}
            onChange={(v) => setImgBpp(Number(v))}
            options={BIT_DEPTHS.map((b) => ({ value: b, label: `${b}-bit${b === 1 ? ' (binary)' : ''}` }))}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {IMAGE_PRESETS.map((p) => (
            <button
              key={p.label}
              className="sm ghost"
              onClick={() => { setImgWidth(p.width); setImgHeight(p.height); setImgBpp(p.bitsPerPixel); }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <Pill tone={haveBytes === 0 ? '' : sizeMatches ? 'ok' : 'warn'}>
            {haveBytes} bytes received · {expectBytes} expected at {imgWidth}×{imgHeight}@{imgBpp}bpp
          </Pill>
        </div>

        <div className="image-preview" style={{ marginTop: 10 }}>
          <canvas ref={canvasRef} />
        </div>
        <p style={{ marginTop: 8, marginBottom: 0 }}>{device.imageStatus || 'Ready'}</p>
      </Card>
    </div>
  );
}
