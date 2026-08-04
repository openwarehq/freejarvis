"use client";

import { useEffect } from "react";
import Icon from "./Icon";
import type { PendingApproval } from "@/hooks/useDeck";

/**
 * The approval card.
 *
 * The run is genuinely stopped while this is on screen — the stream is open
 * and the loop is polling for the decision. It shows the exact arguments,
 * because approving "write_file" tells you nothing and approving
 * `write_file {"path":"notes/today.md"}` tells you everything.
 */
export default function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: PendingApproval;
  onDecide: (id: string, decision: "approve" | "deny") => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDecide(approval.id, "deny");
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onDecide(approval.id, "approve");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approval.id, onDecide]);

  let args = approval.args;
  try {
    args = JSON.stringify(JSON.parse(approval.args), null, 2);
  } catch {
    /* leave it as it came */
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-sm">
      <div
        className="rise glass w-[min(460px,calc(100vw-48px))] rounded-[5px] p-4"
        style={{ borderColor: "hsl(8 92% 60% / 0.45)" }}
        role="alertdialog"
        aria-labelledby="approval-title"
      >
        <div className="mb-3 flex items-center gap-2">
          <Icon name="approvals" size={15} className="text-[hsl(8_92%_64%)]" />
          <span id="approval-title" className="label label-bright">
            APPROVAL REQUIRED
          </span>
          <span className="label ml-auto">ESC DENIES</span>
        </div>

        <p className="mb-3 text-[13px] leading-relaxed text-[var(--text)]">{approval.reason}</p>

        <div className="mb-4 rounded-[3px] border border-[var(--line)] bg-black/50 p-2.5">
          <div className="label mb-1.5" style={{ color: "hsl(8 92% 64%)" }}>
            {approval.name}
          </div>
          <pre className="data scroll max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10.5px] leading-snug text-[var(--dim)]">
            {args}
          </pre>
        </div>

        <div className="flex gap-2">
          <button className="btn flex-1" onClick={() => onDecide(approval.id, "deny")}>
            Deny
          </button>
          <button
            className="btn btn-accent flex-1"
            onClick={() => onDecide(approval.id, "approve")}
            autoFocus
          >
            Approve · ⌘⏎
          </button>
        </div>
      </div>
    </div>
  );
}
