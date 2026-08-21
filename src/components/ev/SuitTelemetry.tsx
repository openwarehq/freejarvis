"use client";

/**
 * SUIT TELEMETRY — the meters under the status board.
 *
 * Each bar is a real count against a real ceiling, so a full bar means the
 * thing is genuinely full rather than that it looked better that way. The
 * ceiling is shown next to it for exactly that reason — a bar with no scale is
 * a decoration.
 */
export default function SuitTelemetry({
  bars,
}: {
  bars: { label: string; value: number; max: number; unit?: string }[];
}) {
  return (
    <section className="ev-panel">
      <header className="ev-panel-head">
        <span className="ev-dot" />
        SUIT TELEMETRY
      </header>

      <ul className="ev-bars">
        {bars.map((b) => {
          const pct = Math.max(0, Math.min(100, (b.value / Math.max(1, b.max)) * 100));
          return (
            <li key={b.label}>
              <div className="ev-bar-head">
                <span>{b.label}</span>
                <span className="ev-bar-value">
                  {b.value}
                  {b.unit ?? ""} <em>/ {b.max}</em>
                </span>
              </div>
              <div className="ev-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
