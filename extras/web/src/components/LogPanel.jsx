import { useEffect, useRef, useState } from 'react';
import { Card } from './ui.jsx';

export default function LogPanel({ lines, onClear, onReport }) {
  const ref = useRef(null);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, follow]);

  const text = lines.join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — Download still works */ }
  }

  function download() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `hlk-zw-log-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card
      title="Log"
      actions={
        <span className="row" style={{ gap: 6 }}>
          <label className="inline" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            Follow
          </label>
          <button className="sm ghost" onClick={copy} disabled={!lines.length}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="sm ghost" onClick={download} disabled={!lines.length}>
            Download
          </button>
          <button className="sm ghost" onClick={onClear} disabled={!lines.length}>
            Clear
          </button>
          <button className="sm primary" onClick={onReport}>
            Report a problem
          </button>
        </span>
      }
    >
      <div className="log" ref={ref}>{text}</div>
      <p className="hint" style={{ marginTop: 8 }}>
        Every frame in and out of the module is recorded here. Attach it to a
        problem report — it is what makes an issue diagnosable.
      </p>
    </Card>
  );
}
