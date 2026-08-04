import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SHELL_ENABLED, WORKSPACE_DIR } from "./config";
import { addMemory, createJob, listMemories, searchMemories } from "./db";
import type { ToolDef } from "./llm";
import { isValidCron } from "./cron";
import { listSites, resolveSite, SITES_DIR } from "./sites";

const exec = promisify(execFile);

export type Tool = ToolDef & {
  /** Tools that touch the disk, the network outward, or the schedule ask first. */
  gated: boolean;
  /** Shown in the approval card so the decision is about the act, not the name. */
  gateReason?: string;
  run: (args: Record<string, any>) => Promise<string>;
};

/* ── the workspace jail ───────────────────────────────────────────────── */

/**
 * Every path a tool touches resolves inside the workspace directory, checked
 * after resolution rather than before. Rejecting strings containing ".." is
 * the version of this that gets bypassed; comparing the resolved absolute
 * path is the version that does not. Symlinks are resolved too, so a link
 * planted in the workspace cannot point out of it.
 */
async function jail(rel: string): Promise<string> {
  await fs.mkdir(path.resolve(WORKSPACE_DIR), { recursive: true });
  // Compare real paths to real paths. On macOS the temp directory — and
  // plenty of ordinary ones — are themselves symlinks, so a check that mixes
  // a resolved root with an unresolved target rejects files that are in fact
  // inside the workspace.
  const realRoot = await fs.realpath(path.resolve(WORKSPACE_DIR));
  const target = path.resolve(realRoot, rel || ".");

  // Walk up to the nearest ancestor that exists, resolving it, then re-apply
  // the part that does not exist yet. That resolves symlinks anywhere along
  // the chain, including one planted inside the workspace pointing out of it.
  let existing = target;
  const tail: string[] = [];
  for (;;) {
    try {
      await fs.lstat(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      tail.unshift(path.basename(existing));
      existing = parent;
    }
  }

  const resolved = path.resolve(await fs.realpath(existing).catch(() => existing), ...tail);
  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
    throw new Error(`Path is outside the workspace: ${rel}`);
  }
  return resolved;
}

function clip(s: string, n = 6000): string {
  return s.length > n ? `${s.slice(0, n)}\n… [${s.length - n} more characters]` : s;
}

/* ── html to something a model can read ───────────────────────────────── */

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    // Stripping tags leaves the space where the tag was, so every line would
    // otherwise start with one.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ── the tools ────────────────────────────────────────────────────────── */

export function builtinTools(): Tool[] {
  const tools: Tool[] = [
    {
      name: "now",
      description:
        "The current date and time, with the timezone. Call this before any reasoning about dates — you have no clock otherwise.",
      parameters: { type: "object", properties: {} },
      gated: false,
      run: async () => {
        const d = new Date();
        return `${d.toISOString()} (local: ${d.toString()})`;
      },
    },

    {
      name: "remember",
      description:
        "Store a durable fact about the owner, their projects or their preferences. Use it unprompted whenever something worth keeping comes up.",
      parameters: {
        type: "object",
        properties: {
          body: { type: "string", description: "The fact, written to be read months later." },
          tag: { type: "string", description: "One word: person, project, preference, fact." },
        },
        required: ["body"],
      },
      gated: false,
      run: async (a) => {
        if (!a.body?.trim()) return "Nothing to remember — body was empty.";
        const m = addMemory(String(a.body).trim(), String(a.tag ?? "note"));
        return `Remembered (${m.id}).`;
      },
    },

    {
      name: "recall",
      description:
        "Search stored memories. Call this before saying you don't know something about the owner.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Words to look for. Empty lists the most recent." } },
      },
      gated: false,
      run: async (a) => {
        const q = String(a.query ?? "").trim();
        const rows = q ? searchMemories(q, 15) : listMemories(15);
        if (!rows.length) return q ? `Nothing stored matching "${q}".` : "Memory is empty.";
        return rows.map((r) => `- [${r.tag}] ${r.body}`).join("\n");
      },
    },

    {
      name: "read_web",
      description:
        "Fetch a URL and return its readable text. Use it for documentation, articles and pages the owner links.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "An http or https URL." } },
        required: ["url"],
      },
      gated: false,
      run: async (a) => {
        const url = String(a.url ?? "");
        if (!/^https?:\/\//i.test(url)) return "Only http and https URLs can be fetched.";
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        try {
          const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { "User-Agent": "freejarvis/1.0 (+self-hosted)" },
            redirect: "follow",
          });
          const body = await res.text();
          if (!res.ok) return `HTTP ${res.status} from ${url}\n${clip(body, 500)}`;
          const type = res.headers.get("content-type") ?? "";
          return clip(type.includes("json") ? body : htmlToText(body));
        } catch (e) {
          return `Could not fetch ${url}: ${(e as Error).message}`;
        } finally {
          clearTimeout(timer);
        }
      },
    },

    {
      name: "list_files",
      description: "List files in the workspace directory.",
      parameters: {
        type: "object",
        properties: { dir: { type: "string", description: "Relative path. Defaults to the workspace root." } },
      },
      gated: false,
      run: async (a) => {
        const dir = await jail(String(a.dir ?? "."));
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          if (!entries.length) return "(empty)";
          return entries
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .sort()
            .join("\n");
        } catch (e) {
          return `Could not list: ${(e as Error).message}`;
        }
      },
    },

    {
      name: "read_file",
      description: "Read a text file from the workspace directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      gated: false,
      run: async (a) => {
        const p = await jail(String(a.path ?? ""));
        try {
          return clip(await fs.readFile(p, "utf8"));
        } catch (e) {
          return `Could not read: ${(e as Error).message}`;
        }
      },
    },

    {
      name: "write_file",
      description: "Write a text file into the workspace directory, creating parent folders.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      gated: true,
      gateReason: "Writes a file to disk.",
      run: async (a) => {
        const p = await jail(String(a.path ?? ""));
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, String(a.content ?? ""));
        return `Wrote ${path.relative(path.resolve(WORKSPACE_DIR), p)} (${String(a.content ?? "").length} bytes).`;
      },
    },

    {
      name: "schedule",
      description:
        "Create a recurring job. The prompt runs unattended on the schedule and its answer lands in the deck's activity feed.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          schedule: { type: "string", description: "Five-field cron, e.g. `0 9 * * *` for 9am daily." },
          prompt: { type: "string", description: "What to do each time it fires." },
        },
        required: ["name", "schedule", "prompt"],
      },
      gated: true,
      gateReason: "Adds a job that will run on its own, without you in the room.",
      run: async (a) => {
        const schedule = String(a.schedule ?? "").trim();
        if (!isValidCron(schedule))
          return `\`${schedule}\` is not a five-field cron expression. Example: \`0 9 * * *\`.`;
        const job = createJob(String(a.name ?? "job"), schedule, String(a.prompt ?? ""));
        return `Scheduled "${job.name}" (${job.id}) on \`${schedule}\`.`;
      },
    },
  ];

  // Only offered when there is somewhere to read sites from. A tool that can
  // only ever fail is worse than no tool — the model will keep reaching for it.
  if (SITES_DIR) {
    const sites = listSites();
    const known = sites.length
      ? sites.map((s) => (s.title ? `\`${s.name}\` (${s.title})` : `\`${s.name}\``)).join(", ")
      : "none found in the configured folder";

    tools.push({
      name: "open_site",
      description:
        "Pull a site up on the deck — it takes over the screen and the owner sees it immediately. " +
        `Available right now: ${known}. ` +
        "Match what the owner asked for against that list and pass the name exactly as written there.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "One of the names listed in this tool's description." },
        },
        required: ["name"],
      },
      gated: false,
      run: async (a) => {
        const name = String(a.name ?? "").trim().replace(/\.html$/i, "");
        if (!resolveSite(name)) {
          const options = listSites().map((s) => s.name).join(", ");
          return `No site called "${name}". Available: ${options || "(none)"}.`;
        }
        const site = listSites().find((s) => s.name === name);
        // The deck watches for this tool by name and opens the view itself;
        // this string is what the model reads back, not the mechanism.
        return `Opened "${name}" on the deck${site?.title ? ` — ${site.title}` : ""}. The owner can see it now.`;
      },
    });
  }

  if (SHELL_ENABLED) {
    tools.push({
      name: "shell",
      description:
        "Run a shell command in the workspace directory. Expensive and gated — prefer the file tools.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
      gated: true,
      gateReason: "Runs a command on the machine hosting freejarvis.",
      run: async (a) => {
        const cwd = await jail(".");
        try {
          const { stdout, stderr } = await exec("/bin/sh", ["-c", String(a.command ?? "")], {
            cwd,
            timeout: 60_000,
            maxBuffer: 4 * 1024 * 1024,
          });
          return clip([stdout, stderr].filter(Boolean).join("\n") || "(no output)");
        } catch (e) {
          const err = e as { stdout?: string; stderr?: string; message: string };
          return clip(
            [err.stdout, err.stderr, err.message].filter(Boolean).join("\n"),
          );
        }
      },
    });
  }

  return tools;
}

export function toolDefs(tools: Tool[]): ToolDef[] {
  return tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
}
