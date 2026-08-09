#!/usr/bin/env node
/**
 * Opens the reel browser so you can log into Instagram once.
 *
 * The important part is the debugging port. Logging in with a plain
 * `--user-data-dir` leaves a Chrome holding the profile *without* the port,
 * and Chrome allows one instance per profile — so the next ⌘⇧E cannot start
 * its own and times out with nothing useful to say. Opening it with the port
 * from the start means the window you logged in with is the window the deck
 * drives. Nothing to quit, nothing to remember.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const PROFILE = process.env.REELS_PROFILE || path.join(ROOT, "data", "reels", "chrome");
const PORT = Number(process.env.REELS_CDP_PORT || 9333);

const BINARIES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const open = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v) => { s.destroy(); resolve(v); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.setTimeout(600, () => done(false));
  });

const bin = process.env.REELS_CHROME || BINARIES.find((b) => fs.existsSync(b));
if (!bin) {
  console.error("No Chrome-family browser found. Set REELS_CHROME to one.");
  process.exit(1);
}

if (await open(PORT)) {
  console.log(`The reel browser is already up on port ${PORT}.`);
  console.log(`If you still need to log in, use that window: https://www.instagram.com/`);
  process.exit(0);
}

if (fs.existsSync(path.join(PROFILE, "SingletonLock"))) {
  console.error(
    "A Chrome window is already open on the reel profile without the debugging port.\n" +
      "Chrome allows one instance per profile, so quit that window first, then run this again.",
  );
  process.exit(1);
}

fs.mkdirSync(PROFILE, { recursive: true });
const child = spawn(
  bin,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,960",
    "https://www.instagram.com/",
  ],
  { detached: true, stdio: "ignore" },
);
child.unref();

console.log(`Opening Instagram in the reel profile.\n`);
console.log(`  profile  ${PROFILE}`);
console.log(`  port     ${PORT}\n`);
console.log(`Log in. Leave the window open or close it — either works, because it was`);
console.log(`started with the debugging port and the deck will reuse it.`);
