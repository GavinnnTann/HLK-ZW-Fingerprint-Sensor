import { useState } from 'react';
import {
  submitReport, isSupabaseConfigured, buildDiagnostics, githubIssueUrl,
} from '../lib/report.js';

export default function ReportDialog({ onClose, device, logText }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [includeLog, setIncludeLog] = useState(true);
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [error, setError] = useState('');

  const configured = isSupabaseConfigured();
  const diagnostics = buildDiagnostics({ device, logText });
  const canSend = title.trim().length > 2 && description.trim().length > 5;

  async function send() {
    setState('sending');
    const res = await submitReport({
      title: title.trim(),
      description: description.trim(),
      contact: contact.trim() || null,
      log_text: includeLog ? logText.slice(-100_000) : null,
      diagnostics,
    });
    if (res.ok) {
      setState('sent');
    } else {
      setError(res.error);
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <Backdrop onClose={onClose}>
        <h2>Report sent</h2>
        <p className="hint">
          Thank you — the log and module details came through. If you left an
          email we may follow up with questions.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="primary" onClick={onClose}>Close</button>
        </div>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onClose}>
      <h2>Report a problem</h2>
      <p className="hint">
        Sends your log plus what the module reported about itself. That pairing
        is what makes a sensor issue diagnosable.
      </p>

      {!configured && (
        <div className="banner warn" style={{ marginTop: 14 }}>
          This deployment has no report endpoint configured. You can still open a
          prefilled GitHub issue or download the log below.
        </div>
      )}

      <div className="field">
        <label htmlFor="r-title">What went wrong?</label>
        <input
          id="r-title"
          type="text"
          value={title}
          placeholder="e.g. ZW3020 stores fingerprints but never matches"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="r-desc">Details</label>
        <textarea
          id="r-desc"
          rows={5}
          value={description}
          placeholder="Which module, what you did, what you expected, what happened instead."
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="r-contact">Email (optional)</label>
        <input
          id="r-contact"
          type="email"
          value={contact}
          placeholder="So we can follow up — leave blank to stay anonymous"
          onChange={(e) => setContact(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="inline">
          <input
            type="checkbox"
            checked={includeLog}
            onChange={(e) => setIncludeLog(e.target.checked)}
          />
          Attach the session log ({logText.split('\n').length} lines)
        </label>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary className="hint" style={{ cursor: 'pointer' }}>
          What gets sent with this report
        </summary>
        <pre
          className="log"
          style={{ height: 150, marginTop: 8, whiteSpace: 'pre-wrap' }}
        >
          {JSON.stringify(diagnostics, null, 2)}
        </pre>
      </details>

      {state === 'error' && (
        <div className="banner err" style={{ marginTop: 14 }}>
          Could not send: {error}
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        {configured && (
          <button className="primary" disabled={!canSend || state === 'sending'} onClick={send}>
            {state === 'sending' ? 'Sending…' : 'Send report'}
          </button>
        )}
        <a
          href={githubIssueUrl({ title, description, logText: includeLog ? logText : '' })}
          target="_blank"
          rel="noreferrer"
        >
          <button>Open GitHub issue instead</button>
        </a>
        <span className="spacer" />
        <button className="ghost" onClick={onClose}>Cancel</button>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }) {
  return (
    <div
      className="backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="dialog" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}
