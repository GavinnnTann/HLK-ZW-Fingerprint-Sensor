export default function StorageMap({ states, capacity }) {
  const slots = states ?? new Array(capacity).fill(false);
  const used = slots.filter(Boolean).length;

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="hint">
          {used} of {slots.length} slots used
        </span>
      </div>
      <div className="map">
        {slots.map((on, i) => (
          <div
            key={i}
            className={`slot${on ? ' used' : ''}`}
            title={`Slot ${i} — ${on ? 'enrolled' : 'free'}`}
          >
            {i}
          </div>
        ))}
      </div>
    </>
  );
}
