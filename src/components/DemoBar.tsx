"use client";

import Icon from "./Icon";
import type { DemoScript } from "@/lib/demo";

/**
 * The filming control. Only ever on screen in demo mode.
 *
 * Sits bottom-left where the activity ticker normally lives, so it is easy to
 * crop out of a vertical frame — or leave in, since a reel that shows the
 * take being fired is more honest than one that doesn't.
 */
export default function DemoBar({
  scripts,
  active,
  onPick,
  onTake,
  onReset,
  running,
}: {
  scripts: DemoScript[];
  active: string;
  onPick: (id: string) => void;
  onTake: () => void;
  onReset: () => void;
  running: boolean;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-40 w-[min(330px,42vw)]">
      <div className="glass rounded-[4px] p-2">
        <div className="mb-2 flex items-center gap-2 px-1">
          <span
            className="h-[6px] w-[6px] rounded-full"
            style={{ background: "hsl(38 95% 60%)" }}
          />
          <span className="label" style={{ color: "hsl(38 95% 66%)" }}>
            DEMO MODE
          </span>
          <span className="label ml-auto" style={{ fontSize: 8 }}>
            SCRIPTED · /API/DEMO
          </span>
        </div>

        <div className="mb-1.5 flex flex-wrap gap-1">
          {scripts.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              className="btn"
              style={{
                padding: "4px 8px",
                ...(s.id === active
                  ? {
                      borderColor: "var(--accent-dim)",
                      color: "var(--accent)",
                      background: "var(--accent-ghost)",
                    }
                  : {}),
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          <button className="btn btn-accent flex-1" onClick={onTake} disabled={running}>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="play" size={11} />
              Take · ⌘⌥⇧A
            </span>
          </button>
          <button className="btn" onClick={onReset}>
            Reset · ⌘⌥⇧R
          </button>
        </div>
      </div>
    </div>
  );
}
