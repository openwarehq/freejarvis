"use client";

import type { ReactNode } from "react";
import Icon from "./Icon";

/** The panel container: a glass sheet over the canvas, never a new page. */
export default function Sheet({
  title,
  subtitle,
  onClose,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside className="sheet glass pointer-events-auto z-40 flex h-full w-[min(460px,calc(100vw-52px))] shrink-0 flex-col border-y-0 border-l-0">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="label label-bright">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-[10.5px] text-[var(--faint)]">{subtitle}</p>
          )}
        </div>
        {actions}
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-[3px] text-[var(--faint)] transition-colors hover:bg-white/5 hover:text-[var(--text)]"
          aria-label="Close"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="scroll flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="label label-bright">{title}</p>
      {detail && (
        <p className="mx-auto mt-2 max-w-[300px] text-[11.5px] leading-relaxed text-[var(--faint)]">
          {detail}
        </p>
      )}
    </div>
  );
}

export function Row({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className="block w-full border-b border-[var(--line)] px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      style={active ? { background: "var(--accent-ghost)" } : undefined}
    >
      {children}
    </Tag>
  );
}

export function when(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 60_000) return "in under a minute";
    if (ahead < 3_600_000) return `in ${Math.round(ahead / 60_000)}m`;
    if (ahead < 86_400_000) return `in ${Math.round(ahead / 3_600_000)}h`;
    return new Date(ts).toLocaleDateString();
  }
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
