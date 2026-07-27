import { ARDUINO_URL, PLATFORMIO_URL, REPO_URL } from '../lib/report.js';

// Links to the places this library is published. Rendered as native chips
// rather than <img> badges from ardu-badge.com / badges.registry.platformio.org
// so they match the theme, cost no third-party request, and cannot break the
// layout when an external host is slow or blocked.
export default function RegistryLinks({ compact = false }) {
  return (
    <div className="chip-row">
      <a className="chip" href={ARDUINO_URL} target="_blank" rel="noreferrer"
        title="Install from the Arduino Library Manager">
        <ChipIcon />
        Arduino{compact ? '' : ' Library Manager'}
      </a>
      <a className="chip" href={PLATFORMIO_URL} target="_blank" rel="noreferrer"
        title="View on the PlatformIO Registry">
        <ChipIcon />
        PlatformIO{compact ? '' : ' Registry'}
      </a>
      <a className="chip" href={REPO_URL} target="_blank" rel="noreferrer"
        title="Source on GitHub">
        <GitHubIcon />
        GitHub
      </a>
    </div>
  );
}

// Generic package glyph — deliberately not a reproduction of the Arduino or
// PlatformIO wordmarks, which are trademarks of their respective owners.
function ChipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M21 8v8l-9 5-9-5V8l9-5 9 5Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7 0-.7 0-.7 1.2.1 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.1 5.1 18.1 5.4 18.1 5.4c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
