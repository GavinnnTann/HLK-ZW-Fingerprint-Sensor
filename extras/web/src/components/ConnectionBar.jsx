import { useState } from 'react';
import { Card, Pill } from './ui.jsx';
import { BAUD_RATES } from '../protocol/constants.js';

// Firefox 151+ implements Web Serial, but gates the first port request behind a
// site-permission add-on install prompt that appears *before* the port picker.
// Without a heads-up that reads as a failed connection, so the hint below
// calls it out. UA sniffing is fine here: it only changes help text.
const isFirefox = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);

export default function ConnectionBar({
  connected, connecting, status, onConnect, onDisconnect,
  baudRate, setBaudRate, stopBits, setStopBits, password, setPassword,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Card>
      <div className="row">
        <button
          className={connected ? '' : 'primary'}
          onClick={connected ? onDisconnect : onConnect}
          disabled={connecting}
        >
          {connecting ? 'Connecting…' : connected ? 'Disconnect' : 'Connect to sensor'}
        </button>

        <label className="inline">
          Baud
          <select
            value={baudRate}
            disabled={connected}
            onChange={(e) => setBaudRate(Number(e.target.value))}
          >
            {BAUD_RATES.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>

        <Pill tone={status.tone}>{status.text}</Pill>

        <span className="spacer" />

        <button className="sm ghost" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? 'Hide advanced' : 'Advanced'}
        </button>
      </div>

      {showAdvanced && (
        <div className="row" style={{ marginTop: 12 }}>
          <label className="inline">
            Stop bits
            <select
              value={stopBits}
              disabled={connected}
              onChange={(e) => setStopBits(Number(e.target.value))}
            >
              <option value={1}>1 (default)</option>
              <option value={2}>2</option>
            </select>
          </label>
          <span className="hint">
            The ZW302x datasheet specifies 8N2. Receivers normally accept 8N1
            either way — change this only if framing looks corrupt.
          </span>

          <label className="inline" style={{ marginLeft: 'auto' }}>
            Password
            <input
              type="text"
              value={password}
              maxLength={8}
              spellCheck={false}
              style={{ width: 110, fontFamily: 'var(--mono)' }}
              onChange={(e) => setPassword(e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
              placeholder="00000000"
            />
          </label>
        </div>
      )}

      {!connected && (
        <p className="hint" style={{ marginTop: 10 }}>
          Click Connect and pick your USB-serial adapter (CH340, CP2102, FTDI) in
          the browser prompt. Default baud for HLK-ZW sensors is 57600.
          {isFirefox && (
            <> On Firefox the first connection asks you to install a small
            site-permission add-on before the port picker opens — accept it, then
            choose the port.</>
          )}
        </p>
      )}
    </Card>
  );
}
