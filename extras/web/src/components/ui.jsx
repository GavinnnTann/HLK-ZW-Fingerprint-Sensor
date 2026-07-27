export function ThemeToggle({ isDark, onToggle }) {
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button className="icon-btn" onClick={onToggle} title={label} aria-label={label}>
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8Z" />
    </svg>
  );
}

export function Card({ title, opcode, danger, children, actions }) {
  return (
    <section className={`card${danger ? ' danger' : ''}`}>
      {title && (
        <h2>
          {title}
          {opcode && <span className="opcode">{opcode}</span>}
          {actions && <span className="spacer" />}
          {actions}
        </h2>
      )}
      {children}
    </section>
  );
}

export function Pill({ tone = '', children }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function NumField({ label, value, onChange, min = 0, max = 999, disabled }) {
  return (
    <label className="inline">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </label>
  );
}

export function Select({ label, value, onChange, options, disabled }) {
  return (
    <label className="inline">
      {label}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
