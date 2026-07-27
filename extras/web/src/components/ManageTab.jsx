import { useRef, useState } from 'react';
import { Card, NumField } from './ui.jsx';

export default function ManageTab({ ops, device, busy, connected }) {
  const [checkId, setCheckId] = useState(0);
  const [delId, setDelId] = useState(0);
  const [rangeFirst, setRangeFirst] = useState(0);
  const [rangeLast, setRangeLast] = useState(9);
  const [exportId, setExportId] = useState(0);
  const [importId, setImportId] = useState(0);
  const fileRef = useRef(null);

  const disabled = !connected || busy;
  const maxId = Math.max(0, device.capacity - 1);

  return (
    <div className="grid cols-2">
      <Card title="Check slot" opcode="0x07">
        <div className="row">
          <NumField label="Slot" value={checkId} onChange={setCheckId} max={maxId} disabled={disabled} />
          <button className="sm" disabled={disabled} onClick={() => ops.checkExists(checkId)}>
            Check
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Loads the slot into CharBuffer1 to see whether a template is stored there.
        </p>
      </Card>

      <Card title="Delete one" opcode="0x0C">
        <div className="row">
          <NumField label="Slot" value={delId} onChange={setDelId} max={maxId} disabled={disabled} />
          <button className="sm danger" disabled={disabled} onClick={() => ops.deleteOne(delId)}>
            Delete
          </button>
        </div>
      </Card>

      <Card title="Delete range" opcode="0x0C">
        <div className="row">
          <NumField label="From" value={rangeFirst} onChange={setRangeFirst} max={maxId} disabled={disabled} />
          <NumField label="To" value={rangeLast} onChange={setRangeLast} max={maxId} disabled={disabled} />
          <button
            className="sm danger"
            disabled={disabled || rangeLast < rangeFirst}
            onClick={() => ops.deleteRange(rangeFirst, rangeLast)}
          >
            Delete range
          </button>
        </div>
        {rangeLast < rangeFirst && (
          <p className="dangertext" style={{ marginTop: 8 }}>
            "To" must be greater than or equal to "From".
          </p>
        )}
      </Card>

      <Card title="Wipe library" opcode="0x0D" danger>
        <p className="dangertext" style={{ marginTop: 0 }}>
          Permanently erases every stored fingerprint on the module. There is no
          undo and no confirmation from the device.
        </p>
        <button className="danger" disabled={disabled} onClick={ops.wipeAll}>
          Wipe all fingerprints
        </button>
      </Card>

      <Card title="Export template" opcode="0x08">
        <div className="row">
          <NumField label="Slot" value={exportId} onChange={setExportId} max={maxId} disabled={disabled} />
          <button className="sm" disabled={disabled} onClick={() => ops.exportTemplate(exportId)}>
            Export to file
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Downloads a <code>.fp</code> file — the same format the Python tester
          reads and writes, so templates move between the two freely.
        </p>
      </Card>

      <Card title="Import template" opcode="0x09">
        <div className="row">
          <NumField label="To slot" value={importId} onChange={setImportId} max={maxId} disabled={disabled} />
          <button className="sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
            Choose .fp file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".fp,application/octet-stream"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) ops.importTemplate(importId, f);
              e.target.value = '';
            }}
          />
        </div>
      </Card>
    </div>
  );
}
