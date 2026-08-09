#!/usr/bin/env node
/**
 * What ⌘⇧E runs.
 *
 * A global hotkey has no terminal in front of it, so everything it has to say
 * goes to a notification and a log. It also has no browser in front of it,
 * which is the whole reason this exists as a script rather than a keybinding on
 * the deck: the point is to send a clip while you are doing something else, and
 * "first focus this browser tab" is not that.
 *
 * If the deck happens to be running it goes through `/api/demo`, so the agent
 * narrates the take on screen while it works — the same live tool step, just
 * with a voice. If the deck is not running it does the work itself. Either way
 * the browser opens, the post is filled in, and Share is left alone.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG = path.join(ROOT, "data", "reels", "hotkey.log");
const DECK = Number(process.env.PORT || 4333);

fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (s) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`);
const notify = (title, body) =>
  execFile("osascript", [
    "-e",
    `display notification "${String(body).replace(/["\\]/g, "\\$&").replace(/\n/g, " ")}" with title "${title}"`,
  ], () => {});

const up = (port) =>
  new Promise((r) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v) => { s.destroy(); r(v); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.setTimeout(600, () => done(false));
  });

/** Runs the tool in-process, for when the deck is not up. */
function direct() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
        "-e",
        `import { builtinTools } from "${path.join(ROOT, "src", "lib", "tools.ts")}";
         const t = builtinTools().find(x => x.name === "post_reel");
         console.log(await t.run({}));`,
      ],
      { cwd: ROOT, env: process.env },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => resolve(out.trim().split("\n").pop() || "(no output)"));
  });
}

async function viaDeck() {
  const res = await fetch(`http://127.0.0.1:${DECK}/api/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script: "reel" }),
  });
  const text = await res.text();
  for (const line of text.split("\n")) {
    const m = line.match(/^data: (.+)$/);
    if (!m) continue;
    const e = JSON.parse(m[1]);
    if (e.t === "tool.completed") return e.output;
  }
  return "the deck answered but said nothing";
}

notify("freejarvis", "Taking the next clip…");
log("fired");

try {
  const deckUp = await up(DECK);
  log(deckUp ? "going through the deck" : "deck is down — running it here");
  const output = deckUp ? await viaDeck() : await direct();
  log(output);
  console.log(output);
  // "Share" in the output means it got all the way there.
  notify(/Share/.test(output) ? "freejarvis — ready" : "freejarvis — stopped", output.slice(0, 220));
} catch (e) {
  log(`failed: ${e.message}`);
  notify("freejarvis — stopped", e.message.slice(0, 220));
  process.exit(1);
}
