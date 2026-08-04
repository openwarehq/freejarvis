import { createSession, listJobs, logActivity, recordJobRun } from "./db";
import { matches, parseCron } from "./cron";
import { collect, runPrompt } from "./runner";

/**
 * The scheduler lives in the web process.
 *
 * A queue that needs its own service is a second command, and the bar in this
 * repo is one. The cost is honest and stated: nothing fires while the
 * container is down, and a job that was mid-flight when it stopped does not
 * resume — it simply runs at its next scheduled time.
 */

type SchedulerState = { timer: NodeJS.Timeout | null; lastTick: string | null };

declare global {
  // eslint-disable-next-line no-var
  var __freejarvisScheduler: SchedulerState | undefined;
}

// Next's dev server re-evaluates modules on edit. Without a global handle
// you get a new interval per edit and a job that fires eleven times.
const state: SchedulerState = (globalThis.__freejarvisScheduler ??= {
  timer: null,
  lastTick: null,
});

function stamp(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}

export function startScheduler() {
  if (state.timer) return;
  // Every 20 seconds, but each wall-clock minute is only ever acted on once.
  state.timer = setInterval(tick, 20_000);
  // Don't hold the process open for the sake of the timer.
  state.timer.unref?.();
  logActivity("system", "scheduler started");
}

async function tick() {
  const now = new Date();
  const key = stamp(now);
  if (state.lastTick === key) return;
  state.lastTick = key;

  let jobs;
  try {
    jobs = listJobs().filter((j) => j.enabled);
  } catch {
    return; // Database not ready yet; try again in twenty seconds.
  }

  for (const job of jobs) {
    const cron = parseCron(job.schedule);
    if (!cron || !matches(cron, now)) continue;
    void runJob(job.id, job.name, job.prompt);
  }
}

export async function runJob(id: string, name: string, prompt: string) {
  logActivity("job", `${name} started`);
  const session = createSession(`job · ${name}`, "cron");
  try {
    const { text, ok, error } = await collect(
      runPrompt({ sessionId: session.id, input: prompt, unattended: true }),
    );
    recordJobRun(id, ok ? "ok" : "failed", ok ? text : (error ?? "failed"));
    logActivity("job", `${name} ${ok ? "finished" : `failed — ${error}`}`);
  } catch (e) {
    recordJobRun(id, "failed", (e as Error).message);
    logActivity("job", `${name} failed — ${(e as Error).message}`);
  }
}
