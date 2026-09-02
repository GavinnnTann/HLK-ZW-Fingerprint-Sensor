import { Card } from './ui.jsx';
import { CHANGELOG } from '../changelog.js';
import { APP_VERSION, BUILD_SHA, BUILD_DATE } from '../lib/build.js';
import { REPO_URL } from '../lib/report.js';

const KINDS = { added: 'Added', changed: 'Changed', fixed: 'Fixed', note: 'Note' };

export default function ChangelogTab() {
  return (
    <div className="grid">
      <Card title="This build">
        <dl className="kv">
          <dt>Version</dt>
          <dd>v{APP_VERSION}</dd>
          <dt>Commit</dt>
          <dd><code className="build-sha">{BUILD_SHA}</code></dd>
          <dt>Built</dt>
          <dd>{BUILD_DATE}</dd>
        </dl>
        <p className="hint" style={{ marginTop: 12 }}>
          The tester redeploys on every push, so the commit — not the version —
          is what identifies your build. Problem reports attach both, so there is
          nothing to copy by hand.
        </p>
      </Card>

      <Card title="What's new">
        <ol className="changelog">
          {CHANGELOG.map((rel) => (
            <li key={rel.version}>
              <div className="row rel-head">
                <h3>v{rel.version}</h3>
                <span className="rel-title">{rel.title}</span>
                <span className="spacer" />
                {rel.version === APP_VERSION && <span className="pill ok">you are here</span>}
                <span className="pill">{rel.date ?? 'unreleased'}</span>
              </div>
              <ul>
                {rel.changes.map(([kind, text]) => (
                  <li key={text}>
                    <span className={`tag ${kind}`}>{KINDS[kind]}</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="hint" style={{ marginTop: 14 }}>
          Releases before v1.2.0 predate the web tester — they cover the Arduino
          library and the Python desktop tester only.{' '}
          <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
            Full release history on GitHub
          </a>
        </p>
      </Card>
    </div>
  );
}
