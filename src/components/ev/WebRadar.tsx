"use client";

/**
 * SPIDER-WEB TELEMETRY — the web.
 *
 * A radar chart, drawn as a web because that is what a radar chart already is:
 * concentric rings, radial spokes, a filled polygon across them. The reference
 * gets that for free, and so the shape on screen is the real reading rather
 * than a spider drawn over one.
 *
 * Each axis is normalised against its own ceiling, because the counts are not
 * comparable — nine tools and four hundred memories on one scale would make
 * every web a single spike. `max` per axis is what makes the shape mean
 * anything.
 */
export type Axis = { label: string; value: number; max: number };

const R = 78;
const CX = 100;
const CY = 92;

function point(i: number, n: number, radius: number): [number, number] {
  // Start at twelve o'clock and go clockwise, so the first axis is the one you
  // read first rather than whichever way atan2 happens to point.
  const a = (Math.PI * 2 * i) / n - Math.PI / 2;
  return [CX + Math.cos(a) * radius, CY + Math.sin(a) * radius];
}

export default function WebRadar({ axes }: { axes: Axis[] }) {
  const n = Math.max(3, axes.length);
  const rings = [0.25, 0.5, 0.75, 1];

  const web = rings
    .map((r) =>
      Array.from({ length: n }, (_, i) => point(i, n, R * r).map((v) => v.toFixed(1)).join(","))
        .join(" "),
    )
    .map((pts, i) => <polygon key={i} points={pts} className="ev-web-ring" />);

  const spokes = Array.from({ length: n }, (_, i) => {
    const [x, y] = point(i, n, R);
    return <line key={i} x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)} className="ev-web-spoke" />;
  });

  const shape = axes
    .map((a, i) => {
      const r = R * Math.max(0.06, Math.min(1, a.value / Math.max(1, a.max)));
      return point(i, n, r).map((v) => v.toFixed(1)).join(",");
    })
    .join(" ");

  return (
    <section className="ev-panel">
      <header className="ev-panel-head">
        <span className="ev-dot" />
        SPIDER-WEB TELEMETRY
      </header>

      <svg viewBox="0 0 200 190" className="ev-web" role="img" aria-label="System load across five axes">
        <g>{web}</g>
        <g>{spokes}</g>
        <polygon points={shape} className="ev-web-shape" />
        {axes.map((a, i) => {
          const [x, y] = point(i, n, R + 13);
          return (
            <text
              key={a.label}
              x={x.toFixed(1)}
              y={y.toFixed(1)}
              className="ev-web-label"
              textAnchor={x > CX + 4 ? "start" : x < CX - 4 ? "end" : "middle"}
              dominantBaseline="middle"
            >
              {a.label}
            </text>
          );
        })}
      </svg>
    </section>
  );
}
