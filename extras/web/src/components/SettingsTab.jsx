import { useState } from 'react';
import { Card, NumField, Select } from './ui.jsx';
import { BAUD_REGS, PACKET_SIZES } from '../protocol/constants.js';

export default function SettingsTab({ ops, device, busy, connected, theme, setTheme }) {
  const [secLevel, setSecLevel] = useState(3);
  const [baudReg, setBaudReg] = useState(6);
  const [pktIdx, setPktIdx] = useState(2);
  const [pwCurrent, setPwCurrent] = useState('00000000');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');

  const disabled = !connected || busy;
  const hexOnly = (s) => s.replace(/[^0-9a-fA-F]/g, '').slice(0, 8);
  const pwMismatch = pwNew !== '' && pwConfirm !== '' && pwNew !== pwConfirm;

  return (
    <div className="grid">
      <Card title="Appearance">
        <Select
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <p className="hint" style={{ marginTop: 10 }}>
          The toggle in the header flips straight between light and dark. Choose
          System here to follow your operating system instead.
        </p>
      </Card>

      <Card title="Before you change anything" danger>
        <p className="dangertext" style={{ margin: 0 }}>
          Everything below is written straight to module flash and survives a
          power cycle.
        </p>
        <ul className="dangertext" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>Baud rate — set it wrong and you must reconnect at the new rate to recover.</li>
          <li>Security level — permanently shifts the false-accept / false-reject threshold.</li>
          <li>Packet size — affects all later communication; a mismatch breaks the link.</li>
          <li>Password — enforcement varies by firmware. Leave at 00000000 unless you are sure.</li>
        </ul>
      </Card>

      <div className="grid cols-2">
        <Card title="Security level" opcode="WriteReg 0x05">
          <div className="row">
            <NumField
              label="Level (1 permissive – 5 strict)"
              value={secLevel}
              onChange={setSecLevel}
              min={1}
              max={5}
              disabled={disabled}
            />
            <button className="sm" disabled={disabled} onClick={() => ops.setSecurity(secLevel)}>
              Write
            </button>
          </div>
          {device.sysParams && (
            <p className="hint" style={{ marginTop: 10 }}>
              Module currently reports level {device.sysParams.secLevel}.
            </p>
          )}
        </Card>

        <Card title="Packet size" opcode="WriteReg 0x06">
          <div className="row">
            <Select
              label="Size"
              value={pktIdx}
              disabled={disabled}
              onChange={(v) => setPktIdx(Number(v))}
              options={PACKET_SIZES.map((p) => ({ value: p.idx, label: `${p.bytes} bytes` }))}
            />
            <button className="sm" disabled={disabled} onClick={() => ops.setPacketSize(pktIdx)}>
              Write
            </button>
          </div>
        </Card>
      </div>

      <Card title="Baud rate" opcode="WriteReg 0x04">
        <div className="row">
          <Select
            label="Rate"
            value={baudReg}
            disabled={disabled}
            onChange={(v) => setBaudReg(Number(v))}
            options={BAUD_REGS.map((b) => ({ value: b.n, label: `${b.baud} (reg ${b.n})` }))}
          />
          <button className="sm" disabled={disabled} onClick={() => ops.setBaud(baudReg)}>
            Write
          </button>
          <span className="warntext">
            After writing, disconnect and reconnect at the new rate.
          </span>
        </div>
      </Card>

      <Card title="Change password" opcode="0x12" danger>
        <p className="dangertext" style={{ marginTop: 0 }}>
          The factory default is 00000000. The current password is verified
          against the module before anything is written. Some firmware ignores
          password gating entirely; other variants reject every command until the
          correct password is sent, which makes a forgotten password very hard to
          recover.
        </p>
        <div className="grid" style={{ maxWidth: 320, gap: 10 }}>
          <label>
            Current (8 hex chars)
            <input
              type="text"
              value={pwCurrent}
              style={{ fontFamily: 'var(--mono)', width: '100%' }}
              onChange={(e) => setPwCurrent(hexOnly(e.target.value))}
            />
          </label>
          <label>
            New
            <input
              type="password"
              value={pwNew}
              placeholder="00000000"
              style={{ fontFamily: 'var(--mono)', width: '100%' }}
              onChange={(e) => setPwNew(hexOnly(e.target.value))}
            />
          </label>
          <label>
            Confirm new
            <input
              type="password"
              value={pwConfirm}
              placeholder="00000000"
              style={{ fontFamily: 'var(--mono)', width: '100%' }}
              onChange={(e) => setPwConfirm(hexOnly(e.target.value))}
            />
          </label>
        </div>
        {pwMismatch && (
          <p className="dangertext" style={{ marginBottom: 0 }}>
            New password and confirmation do not match.
          </p>
        )}
        <button
          className="danger"
          style={{ marginTop: 12 }}
          disabled={disabled || pwMismatch || pwNew.length !== 8 || pwConfirm.length !== 8}
          onClick={() => ops.changePassword(pwCurrent, pwNew).then((ok) => {
            if (ok) { setPwCurrent(pwNew); setPwNew(''); setPwConfirm(''); }
          })}
        >
          Change password
        </button>
      </Card>
    </div>
  );
}
