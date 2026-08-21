"use client";

/**
 * SYSTEM STATUS — the left column.
 *
 * Every row is a real reading. The labels are in the suit's language because
 * that is the skin, but nothing here is decorative: WEB INTELLIGENCE is the
 * tool count, NEURAL CORE is whether a brain actually answered, VOICE ENGINE is
 * whether ElevenLabs is configured and reachable. A status board that lights up
 * green whatever the machine is doing is a screensaver.
 */
export default function SystemStatus({
  rows,
}: {
  rows: { label: string; value: string; ok: boolean | null }[];
}) {
  return (
    <section className="ev-panel">
      <header className="ev-panel-head">
        <span className="ev-dot" />
        SYSTEM STATUS
        <span className="ml-auto ev-head-note">SPIDER-OS</span>
      </header>

      <ul className="ev-rows">
        {rows.map((r) => (
          <li key={r.label} className="ev-row">
            <span className="ev-glyph" data-ok={String(r.ok)} />
            <span className="ev-row-label">{r.label}</span>
            <span className="ev-pill" data-ok={String(r.ok)}>
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
