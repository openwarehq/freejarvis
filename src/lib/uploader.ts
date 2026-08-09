/**
 * The browser, and the uploader inside it.
 *
 * A second Chrome, with its own profile, that you log into Instagram in once.
 * Not a workaround — since Chrome 136 the remote-debugging port is refused
 * outright on the default profile, because "any local process can drive the
 * browser you are logged into everywhere" is a real hole. A separate profile
 * holds one session, for one site, that you chose to put there. Nothing here
 * can reach your mail, your bank, or the tabs in your other window.
 *
 * It is not headless. You watch it work, and if it does something you did not
 * expect you are looking straight at it.
 *
 * **Everything is found by what it says, not by what it is called.** Instagram
 * ships obfuscated class names that change without notice — `._acan._acap` is a
 * selector with a shelf life measured in weeks. The words "Create", "Next" and
 * "Share" have been the same for years, and they are how a person finds the
 * button too.
 *
 * The file never goes near the OS file picker; CDP sets it on the
 * `<input type=file>` directly. The caption goes in through the input pipeline,
 * because setting `textContent` on Instagram's composer looks right on screen
 * and posts **empty** — React never hears about it.
 *
 * **It stops before posting.** `share: false` is the default and the tool never
 * passes anything else: it fills the post in and leaves the last button for a
 * human. Nothing in freejarvis should be able to publish to a real account
 * because a script reached the end of a flow.
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import type { Session } from "./cdp";
import { CdpError } from "./cdp";
import { REELS_HOME } from "./reels";


const run = promisify(execFile);

export const PROFILE = process.env.REELS_PROFILE || path.join(REELS_HOME, "chrome");
export const CDP_PORT = Number(process.env.REELS_CDP_PORT || 9333);

const BINARIES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

export class ChromeError extends Error {}

export function findChrome(): string {
  const explicit = process.env.REELS_CHROME;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new ChromeError(`REELS_CHROME points at nothing: ${explicit}`);
    return explicit;
  }
  const found = BINARIES.find((b) => fs.existsSync(b));
  if (!found) {
    throw new ChromeError(
      "no Chrome-family browser found. Install Google Chrome, or set REELS_CHROME to a binary.",
    );
  }
  return found;
}

export async function portOpen(port = CDP_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(700, () => done(false));
  });
}

/**
 * Starts the browser if it is not already up, and waits for the port.
 *
 * Detached and with its streams released, so the browser outlives the command —
 * the whole point is that the window stays there for you to look at, and the
 * next run reattaches to the same one instead of opening a third.
 */
export async function ensureChrome(opts: { port?: number; headless?: boolean } = {}): Promise<{
  started: boolean;
  port: number;
  profile: string;
}> {
  const port = opts.port ?? CDP_PORT;
  if (await portOpen(port)) return { started: false, port, profile: PROFILE };

  fs.mkdirSync(PROFILE, { recursive: true });

  // The trap this catches, which cost twenty silent seconds every time:
  //
  // Chrome allows exactly one instance per profile directory. If a window is
  // already open on this profile *without* the debugging flag — the obvious
  // thing to have left open after logging in — the spawn below does not start
  // a second browser. It hands the request to the running one, focuses its
  // window, and exits, so the port never opens and the only symptom is a
  // timeout that says nothing about why.
  //
  // Chrome marks a profile in use with a SingletonLock symlink. If that is
  // there and the port is shut, the diagnosis is certain, so say it now rather
  // than after a twenty-second wait.
  if (fs.existsSync(path.join(PROFILE, "SingletonLock"))) {
    throw new ChromeError(
      "a Chrome window is already open on the reel profile without the debugging port, " +
        "and Chrome allows only one at a time per profile. Quit that window and try again — " +
        "or start it with `npm run reels:login`, which opens it with the port so it can be reused.",
    );
  }

  const bin = findChrome();

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Instagram's web uploader is desktop-only and checks the window; a small
    // window drops it into the mobile layout, which has no upload button.
    "--window-size=1440,960",
    ...(opts.headless ? ["--headless=new"] : []),
  ];

  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return { started: true, port, profile: PROFILE };
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new ChromeError(
    `Chrome did not open its debugging port on ${port} within 20s. ` +
      `If a Chrome is already running from this profile without the flag, quit it and try again.`,
  );
}

/** Brings the window forward, so the click-through is something you can watch. */
export async function focus(): Promise<void> {
  try {
    await run("osascript", [
      "-e",
      'tell application "System Events" to set frontmost of (first process whose name contains "Chrome") to true',
    ]);
  } catch {
    // Not being able to raise the window is not a reason to stop.
  }
}

export function loggedInHint(): string {
  return (
    `Log in once, in the reel browser:\n\n` +
    `  npm run reels:login\n\n` +
    `That opens Instagram in the profile at ${PROFILE}, with the debugging port ` +
    `already on so the same window gets reused. Log in, then leave it open or close it — ` +
    `either works. The session stays in that profile and nothing else on your machine is touched.`
  );
}


export type Step =
  | { t: "opening" }
  | { t: "logged-out" }
  | { t: "create" }
  | { t: "picking"; file: string }
  | { t: "attached" }
  | { t: "advanced"; label: string; step: number }
  | { t: "caption"; chars: number }
  | { t: "ready" }
  | { t: "shared" }
  | { t: "stopped"; why: string };

export type Options = {
  file: string;
  caption: string;
  /** Off by default: fill everything in and stop with Share unpressed. */
  share?: boolean;
  /**
   * Where to drive. Overridable for one reason: the flow can then be run
   * end to end against a fixture that mimics the uploader, which is the only
   * way to test a driver for a site you must not log a test into.
   */
  origin?: string;
  onStep?: (s: Step) => void;
};

/**
 * Finds a clickable thing by its visible text.
 *
 * Returned as an expression rather than a helper so it can be handed to
 * `until()` and polled — Instagram's screens swap in without a navigation, so
 * there is nothing to wait on except the button appearing.
 */
const clickable = (text: string) => `(() => {
  const want = ${JSON.stringify(text)}.toLowerCase();
  const nodes = [...document.querySelectorAll('button,[role="button"],a,div[tabindex]')];
  const hit = nodes.find(n => {
    const t = (n.innerText || n.textContent || '').trim().toLowerCase();
    if (t !== want) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
  });
  return hit || null;
})()`;

const clickIt = (text: string) => `(() => {
  const el = ${clickable(text)};
  if (!el) return false;
  el.scrollIntoView({block:'center'});
  el.click();
  return true;
})()`;

const exists = (text: string) => `Boolean(${clickable(text)})`;

export async function upload(s: Session, opts: Options): Promise<void> {
  const say = opts.onStep ?? (() => {});

  await s.send("Page.enable");
  await s.send("Runtime.enable");
  await s.send("DOM.enable");

  // ── open ────────────────────────────────────────────────────────────────
  say({ t: "opening" });
  await s.send("Page.navigate", { url: opts.origin ?? "https://www.instagram.com/" });
  await s.waitFor("Page.loadEventFired", 45_000).catch(() => {});
  // The shell loads long before the app renders anything clickable.
  await s.until<boolean>(`document.readyState === 'complete'`, { timeoutMs: 30_000 });
  await sleep(1200);

  const loggedOut = await s.eval<boolean>(
    `Boolean(document.querySelector('input[name="username"]')) ||
     /\\/accounts\\/login/.test(location.pathname)`,
  );
  if (loggedOut) {
    say({ t: "logged-out" });
    throw new CdpError("not logged in to Instagram in the freejarvis browser profile");
  }

  // ── create ──────────────────────────────────────────────────────────────
  say({ t: "create" });
  // "Create" is a nav item on desktop; on a narrow window it collapses into
  // "More". Both are tried before giving up, and the window is opened wide
  // precisely so the first one is there.
  const opened =
    (await s.eval<boolean>(clickIt("Create"))) ||
    (await s.eval<boolean>(clickIt("New post")));
  if (!opened) {
    throw new CdpError(
      "could not find the Create button — Instagram may have changed its navigation, " +
        "or the window is too narrow for the desktop layout",
    );
  }

  // ── attach the file ─────────────────────────────────────────────────────
  say({ t: "picking", file: opts.file });
  // The dialog renders an <input type=file> whether or not the picker is open.
  // Waiting for it is waiting for the dialog.
  await s.until<boolean>(`Boolean(document.querySelector('input[type=file]'))`, {
    timeoutMs: 25_000,
  });

  const { root } = await s.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
  const { nodeId } = await s.send<{ nodeId: number }>("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "input[type=file]",
  });
  if (!nodeId) throw new CdpError("the upload dialog opened but has no file input");

  await s.send("DOM.setFileInputFiles", { files: [opts.file], nodeId });
  say({ t: "attached" });

  // ── through the crop and filter screens ─────────────────────────────────
  // Two "Next" screens today. Looping rather than hard-coding two means a third
  // screen appearing does not break it, and a flow that only has one still ends.
  let advanced = 0;
  for (let i = 0; i < 4; i++) {
    const there = await waitForEither(s, ["Next", "Share"], 40_000);
    if (there === "Share") break;
    await s.eval(clickIt("Next"));
    advanced++;
    say({ t: "advanced", label: "Next", step: advanced });
    await sleep(900);
  }

  // ── the caption ─────────────────────────────────────────────────────────
  await s.until<boolean>(exists("Share"), { timeoutMs: 40_000 });
  await writeCaption(s, opts.caption);
  say({ t: "caption", chars: opts.caption.length });

  say({ t: "ready" });

  if (!opts.share) {
    say({
      t: "stopped",
      why: "everything is filled in and Share has not been pressed. Press it yourself, or run again with --post.",
    });
    return;
  }

  await s.eval(clickIt("Share"));
  say({ t: "shared" });
}

/**
 * Types the caption into the composer.
 *
 * The box is a contenteditable that React watches. Setting `textContent` looks
 * right and posts empty, because React never hears about it — the events below
 * are what make the change real. `insertText` through the input event is the
 * one path that both fills the node and notifies the framework.
 */
async function writeCaption(s: Session, text: string): Promise<void> {
  const focused = await s.eval<boolean>(`(() => {
    const box = document.querySelector('div[contenteditable="true"][role="textbox"]')
             || document.querySelector('div[contenteditable="true"]')
             || document.querySelector('textarea[aria-label*="aption" i]');
    if (!box) return false;
    box.focus();
    return true;
  })()`);
  if (!focused) throw new CdpError("could not find the caption box");

  // Through the input pipeline, one insertText, so React's onChange fires once
  // with the whole string rather than 400 times.
  await s.send("Input.insertText", { text });
  await sleep(400);

  const got = await s.eval<number>(`(() => {
    const box = document.querySelector('div[contenteditable="true"][role="textbox"]')
             || document.querySelector('div[contenteditable="true"]')
             || document.querySelector('textarea[aria-label*="aption" i]');
    return box ? (box.innerText || box.value || '').trim().length : 0;
  })()`);
  if (got === 0) throw new CdpError("the caption box stayed empty after typing");
}

/** Waits until one of several labels is on screen, and says which. */
async function waitForEither(s: Session, labels: string[], timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const label of labels) {
      if (await s.eval<boolean>(exists(label)).catch(() => false)) return label;
    }
    if (Date.now() > deadline) {
      throw new CdpError(`none of [${labels.join(", ")}] appeared within ${timeoutMs / 1000}s`);
    }
    await sleep(500);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const _internals = { clickable, clickIt, exists, waitForEither };
