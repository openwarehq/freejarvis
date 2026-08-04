"use client";

import { useState } from "react";
import Icon from "../Icon";
import Sheet, { Empty, when } from "../Sheet";
import { useResource } from "@/hooks/useResource";
import type { JobView } from "@/app/api/jobs/route";

const EXAMPLES = [
  { label: "9am daily", cron: "0 9 * * *" },
  { label: "weekdays 8am", cron: "0 8 * * 1-5" },
  { label: "every 30m", cron: "*/30 * * * *" },
  { label: "Mon 9am", cron: "0 9 * * 1" },
];

export default function CronPanel({ onClose }: { onClose: () => void }) {
  const { data, reload } = useResource<{ local: JobView[]; remote: JobView[] | null }>(
    "/api/jobs",
    15_000,
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, schedule: cron, prompt }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) return setError(j.error ?? "Could not create the job.");
    setName("");
    setPrompt("");
    setOpen(false);
    void reload();
  };

  const act = async (job: JobView, body: Record<string, unknown>) => {
    await fetch(`/api/jobs/${job.id}?owner=${job.owner}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    void reload();
  };

  const remove = async (job: JobView) => {
    await fetch(`/api/jobs/${job.id}?owner=${job.owner}`, { method: "DELETE" });
    void reload();
  };

  const local = data?.local ?? [];
  const remote = data?.remote ?? null;

  return (
    <Sheet
      title="Cron"
      subtitle="Prompts that run without you"
      onClose={onClose}
      actions={
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "New"}
        </button>
      }
    >
      {open && (
        <div className="space-y-2 border-b border-[var(--line)] bg-black/30 p-3">
          <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="field" placeholder="0 9 * * *" value={cron} onChange={(e) => setCron(e.target.value)} />
          <div className="flex flex-wrap gap-1">
            {EXAMPLES.map((ex) => (
              <button key={ex.cron} className="btn" style={{ padding: "4px 8px" }} onClick={() => setCron(ex.cron)}>
                {ex.label}
              </button>
            ))}
          </div>
          <textarea
            className="field min-h-[70px] resize-y"
            placeholder="What should it do each time? The answer lands in the activity feed."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {error && <p className="text-[11px] text-[hsl(8_92%_66%)]">{error}</p>}
          <button className="btn btn-accent w-full" onClick={create} disabled={!name.trim() || !prompt.trim()}>
            Schedule it
          </button>
        </div>
      )}

      {remote && remote.length > 0 && (
        <>
          <div className="label border-b border-[var(--line)] bg-black/30 px-4 py-2">
            ON THE AGENT · {remote.length}
          </div>
          {remote.map((j) => (
            <JobRow key={`h-${j.id}`} job={j} onAct={act} onRemove={remove} />
          ))}
        </>
      )}

      <div className="label border-b border-[var(--line)] bg-black/30 px-4 py-2">
        IN FREEJARVIS · {local.length}
      </div>
      {local.length === 0 ? (
        <Empty
          title="No jobs"
          detail="A job is a prompt on a schedule. It runs unattended, so gated tools are refused rather than queued for an approval nobody is there to give."
        />
      ) : (
        local.map((j) => <JobRow key={j.id} job={j} onAct={act} onRemove={remove} />)
      )}
    </Sheet>
  );
}

function JobRow({
  job,
  onAct,
  onRemove,
}: {
  job: JobView;
  onAct: (j: JobView, body: Record<string, unknown>) => void;
  onRemove: (j: JobView) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="border-b border-[var(--line)] px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className="h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: job.enabled ? "var(--accent)" : "var(--faint)" }}
        />
        <span className="flex-1 truncate text-[12.5px] text-[var(--text)]">{job.name}</span>
        <button
          className="p-1 text-[var(--faint)] transition-colors hover:text-[var(--text)]"
          title={job.enabled ? "Pause" : "Resume"}
          onClick={() => onAct(job, { enabled: !job.enabled })}
        >
          <Icon name={job.enabled ? "pause" : "play"} size={13} />
        </button>
        <button
          className="p-1 text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
          title="Run now"
          onClick={() => onAct(job, { run: true })}
        >
          <Icon name="bolt" size={13} />
        </button>
        <button
          className="p-1 text-[var(--faint)] transition-colors hover:text-[hsl(8_92%_64%)]"
          title="Delete"
          onClick={() => onRemove(job)}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="data text-[10px] text-[var(--accent)]">{job.schedule}</span>
        <span className="text-[10.5px] text-[var(--faint)]">{job.scheduleLabel}</span>
        {job.enabled && job.nextRun && (
          <span className="text-[10.5px] text-[var(--faint)]">next {when(job.nextRun)}</span>
        )}
        {job.lastStatus && (
          <span
            className="label"
            style={{
              fontSize: 8.5,
              color: job.lastStatus === "ok" ? "var(--accent)" : "hsl(8 92% 64%)",
            }}
          >
            LAST {job.lastStatus.toUpperCase()} {when(job.lastRunAt)}
          </span>
        )}
      </div>

      {job.prompt && (
        <button
          className="mt-1.5 flex items-center gap-1 text-left text-[10.5px] text-[var(--faint)] transition-colors hover:text-[var(--dim)]"
          onClick={() => setShow((v) => !v)}
        >
          <Icon name="chevronDown" size={10} className={show ? "" : "-rotate-90"} />
          {show ? "hide" : "prompt"}
        </button>
      )}
      {show && (
        <pre className="data mt-1.5 whitespace-pre-wrap rounded-[3px] border border-[var(--line)] bg-black/40 p-2 text-[10px] leading-snug text-[var(--dim)]">
          {job.prompt}
        </pre>
      )}
      {show && job.lastOutput && (
        <pre className="data scroll mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-[3px] border border-[var(--line)] bg-black/40 p-2 text-[10px] leading-snug text-[var(--dim)]">
          {job.lastOutput}
        </pre>
      )}
    </div>
  );
}
