"use client";

import Icon from "./Icon";

export type PanelId =
  | "sessions"
  | "memory"
  | "cron"
  | "tools"
  | "approvals"
  | "skills"
  | "soul"
  | "settings";

const ITEMS: { id: PanelId; icon: string; label: string }[] = [
  { id: "sessions", icon: "sessions", label: "Sessions" },
  { id: "memory", icon: "memory", label: "Memory" },
  { id: "cron", icon: "cron", label: "Cron" },
  { id: "tools", icon: "tools", label: "Tools" },
  { id: "skills", icon: "skills", label: "Skills" },
  { id: "approvals", icon: "approvals", label: "Approvals" },
  { id: "soul", icon: "soul", label: "Soul" },
  { id: "settings", icon: "settings", label: "Settings" },
];

export default function Rail({
  active,
  onSelect,
  pendingApprovals,
}: {
  active: PanelId | null;
  onSelect: (id: PanelId | null) => void;
  pendingApprovals: number;
}) {
  return (
    <nav className="pointer-events-auto relative z-30 flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--line)] bg-black/45 py-3 backdrop-blur-xl">
      <button
        onClick={() => onSelect(null)}
        title="Deck"
        aria-label="Deck"
        className="group mb-2 flex h-9 w-9 items-center justify-center rounded-[3px] transition-colors"
        style={{
          color: active === null ? "var(--accent)" : "var(--faint)",
          background: active === null ? "var(--accent-ghost)" : "transparent",
        }}
      >
        <Icon name="deck" size={19} />
      </button>

      <div className="mb-2 h-px w-6 bg-[var(--line)]" />

      {ITEMS.map((item) => {
        const on = active === item.id;
        const badge = item.id === "approvals" && pendingApprovals > 0;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(on ? null : item.id)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={on}
            className="relative flex h-9 w-9 items-center justify-center rounded-[3px] transition-all duration-150 hover:bg-white/5"
            style={{
              color: on ? "var(--accent)" : badge ? "hsl(8 92% 62%)" : "var(--faint)",
              background: on ? "var(--accent-ghost)" : "transparent",
            }}
          >
            <Icon name={item.icon} />
            {on && (
              <span
                className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r"
                style={{ background: "var(--accent)" }}
              />
            )}
            {badge && (
              <span className="pulse absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(8_92%_60%)]" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
