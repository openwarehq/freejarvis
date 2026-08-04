"use client";

import Sheet, { Empty, when } from "../Sheet";
import { useResource } from "@/hooks/useResource";

type Approval = {
  id: string;
  tool_name: string;
  tool_args: string;
  reason: string;
  status: string;
  created_at: number;
  decided_at: number | null;
};

export default function ApprovalsPanel({ onClose }: { onClose: () => void }) {
  const { data, reload } = useResource<{ approvals: Approval[]; pending: number }>(
    "/api/approvals",
    5000,
  );
  const rows = data?.approvals ?? [];

  const decide = async (id: string, decision: "approve" | "deny") => {
    await fetch(`/api/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    void reload();
  };

  return (
    <Sheet
      title="Approvals"
      subtitle={`${data?.pending ?? 0} waiting · ${rows.length} in the log`}
      onClose={onClose}
    >
      {rows.length === 0 ? (
        <Empty
          title="Nothing has asked"
          detail="Tools that write files, schedule work or run commands stop and ask. Everything else just runs."
        />
      ) : (
        rows.map((a) => (
          <div key={a.id} className="border-b border-[var(--line)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="data text-[11.5px] text-[var(--text)]">{a.tool_name}</span>
              <span
                className="label ml-auto"
                style={{
                  fontSize: 8.5,
                  color:
                    a.status === "pending"
                      ? "hsl(8 92% 66%)"
                      : a.status === "approved"
                        ? "var(--accent)"
                        : "var(--faint)",
                }}
              >
                {a.status.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--faint)]">{a.reason}</p>
            <pre className="data scroll mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-[3px] border border-[var(--line)] bg-black/40 p-2 text-[10px] leading-snug text-[var(--dim)]">
              {a.tool_args}
            </pre>
            <div className="mt-2 flex items-center gap-2">
              <span className="data text-[9.5px] text-[var(--faint)]">{when(a.created_at)}</span>
              {a.status === "pending" && (
                <>
                  <button
                    className="btn ml-auto"
                    style={{ padding: "4px 9px" }}
                    onClick={() => decide(a.id, "deny")}
                  >
                    Deny
                  </button>
                  <button
                    className="btn btn-accent"
                    style={{ padding: "4px 9px" }}
                    onClick={() => decide(a.id, "approve")}
                  >
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>
        ))
      )}
    </Sheet>
  );
}
