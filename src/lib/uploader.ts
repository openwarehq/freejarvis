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

  // Exact text equality was wrong, and Instagram's own sidebar is the proof:
  // the Create control renders as an icon labelled "New post" wrapped around a
  // span reading "Create", so its innerText is the concatenation
  // "New postCreate" — which equals neither. The whole nav is like this:
  // "HomeHome", "ReelsReels", "SearchSearch", "SettingsMore".
  //
  // So a control matches if any of the strings it presents — its text, its
  // aria-label, its title — is the label, starts with it, or ends with it.
  // Prefix and suffix are safe here in a way they would not be on the page at
  // large, because only controls are searched and only short ones: a paragraph
  // containing the word "Next" is never a candidate.
  const names = (n) => [
    n.innerText || n.textContent || '',
    n.getAttribute && n.getAttribute('aria-label') || '',
    n.getAttribute && n.getAttribute('title') || '',
  ].map(x => x.replace(/\\s+/g, ' ').trim().toLowerCase()).filter(x => x && x.length <= 40);

  const shown = (n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
  };

  const nodes = [...document.querySelectorAll('button,[role="button"],a,div[tabindex],[role="menuitem"]')]
    .filter(shown);

  // Exact first, everywhere, before falling back to the looser rounds — an
  // exact "Next" further down the page beats a prefix match on something else.
  for (const test of [
    (c) => c === want,
    (c) => c.endsWith(want),
    (c) => c.startsWith(want),
  ]) {
    const hit = nodes.find(n => names(n).some(test));
    if (hit) return hit;
  }
  return null;
})()`;

const clickIt = (text: string) => `(() => {
  const el = ${clickable(text)};
  if (!el) return false;
  el.scrollIntoView({block:'center'});
  el.click();
  return true;
})()`;

const exists = (text: string) => `Boolean(${clickable(text)})`;

/**
 * The composer, however Instagram has it labelled today — and only if it is
 * actually on screen.
 *
 * Existence is not enough, and the fixture caught it: a caption box that is
 * mounted but hidden behind the crop screen answers `querySelector` perfectly
 * well. The loop that drives towards the composer then thinks it has arrived
 * before pressing Next at all, and types the caption into something nobody can
 * see. Visibility is the property that was actually meant.
 */
const CAPTION_SELECTOR = `(() => {
  const seen = (n) => {
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden' ? n : null;
  };
  return seen(document.querySelector('div[contenteditable="true"][role="textbox"]'))
      || [...document.querySelectorAll('div[contenteditable="true"]')].map(seen).find(Boolean)
      || [...document.querySelectorAll('textarea[aria-label*="aption" i]')].map(seen).find(Boolean)
      || null;
})()`;
const CAPTION_BOX_EXISTS = `Boolean(${CAPTION_SELECTOR})`;

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

  // Asking "is this the login page?" is the wrong question, and asking it cost
  // a confusing failure three steps later. A half-finished sign-in — a
  // verification code, a suspicious-login challenge, a save-your-details
  // interstitial — has no username field and is not /accounts/login, so it
  // sailed through and then died on a missing file input.
  //
  // Nor can the session cookie be checked from here: `sessionid` is HttpOnly
  // by design, so `document.cookie` never contains it however logged in you
  // are. A check written against it can only ever be false.
  //
  // So the question is "is the app usable?", and the answer is whether its own
  // navigation rendered.
  const state = await s.until<string>(`(() => {
    const p = location.pathname;
    if (/^\\/(accounts\\/(login|signup|emailsignup)|auth_platform|challenge|two_factor)/.test(p)) return 'auth';
    if (document.querySelector('input[name="username"]')) return 'auth';
    const nav = [...document.querySelectorAll('a,[role="link"],[role="button"],svg[aria-label]')]
      .some(n => /^(Home|Search|Create|Explore|Reels|Profile)$/i.test(
        ((n.getAttribute && n.getAttribute('aria-label')) || n.innerText || '').trim()
      ));
    return nav ? 'ok' : '';
  })()`, { timeoutMs: 25_000 }).catch(() => "unknown");

  if (state !== "ok") {
    say({ t: "logged-out" });
    const where = await s.eval<string>("location.pathname").catch(() => "");
    throw new CdpError(
      state === "auth"
        ? `Instagram has not finished signing you in — it is on ${where}, asking for a verification code or a confirmation. ` +
          `Finish it in the browser window that is already open, get to your feed, then press the key again.`
        : `Instagram loaded but its navigation never appeared (${where || "unknown page"}), so I could not tell whether you are signed in.`,
    );
  }

  // ── clear whatever is already on screen ─────────────────────────────────
  // Two things sit in front of the app and neither is an error:
  //
  // "Save your login info?" and "Turn on notifications" are shown on a fresh
  // session, and they swallow the click meant for Create.
  //
  // And a previous run that stopped at Share leaves the composer open. Opening
  // Create again then raises "Discard post?", which is a dialog about the old
  // attempt appearing in the middle of the new one. It has to be answered
  // before anything else, and the answer is yes — the clip is still in the
  // queue, because nothing is recorded as flown until it is actually posted.
  await dismiss(s, ["Not now", "Not Now", "Not now, thanks", "Cancel", "Dismiss"]);
  if (await s.eval<boolean>(exists("Discard")).catch(() => false)) {
    await s.eval(clickIt("Discard"));
    await sleep(900);
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

  // ── Create is a menu, not a button ──────────────────────────────────────
  // It opens "Post", "Live video", "Ad" rather than the uploader itself. That
  // second click is skipped rather than assumed, because the menu has not
  // always been there and may not always be: if the file input turns up on its
  // own, there is nothing to choose.
  const fileInput = `Boolean(document.querySelector('input[type=file]'))`;
  if (!(await s.eval<boolean>(fileInput).catch(() => false))) {
    await sleep(1200);
    if (!(await s.eval<boolean>(fileInput).catch(() => false))) {
      const chose =
        (await s.eval<boolean>(clickIt("Post"))) ||
        (await s.eval<boolean>(clickIt("Post to feed")));
      if (chose) say({ t: "advanced", label: "Post", step: 0 });
    }
  }

  // ── attach the file ─────────────────────────────────────────────────────
  say({ t: "picking", file: opts.file });
  // The dialog renders an <input type=file> whether or not the picker is open.
  // Waiting for it is waiting for the dialog.
  await s.until<boolean>(fileInput, { timeoutMs: 25_000 });

  const { root } = await s.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
  const { nodeId } = await s.send<{ nodeId: number }>("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "input[type=file]",
  });
  if (!nodeId) throw new CdpError("the upload dialog opened but has no file input");

  await s.send("DOM.setFileInputFiles", { files: [opts.file], nodeId });
  say({ t: "attached" });

  // ── through the crop and filter screens ─────────────────────────────────
  //
  // Two "Next" screens today, and the naive version — click Next, wait, click
  // Next — does not survive a video. Instagram is still ingesting the file
  // while the crop screen is up, so the button is there but inert: the click
  // lands, nothing advances, and the run sails on to a composer that has not
  // been reached.
  //
  // So this does not count screens. It drives towards the composer and keeps
  // pressing Next until it arrives, which self-corrects whether the button was
  // not ready, the screen took four seconds, or Instagram adds a third step.
  let advanced = 0;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await s.eval<boolean>(CAPTION_BOX_EXISTS).catch(() => false)) break;

    if (await s.eval<boolean>(clickIt("Next")).catch(() => false)) {
      advanced++;
      say({ t: "advanced", label: "Next", step: advanced });
      // Long enough for the next screen to mount before it is inspected, and
      // short enough that a stuck screen is retried rather than waited out.
      await sleep(1800);
      continue;
    }
    await sleep(900);
  }

  if (!(await s.eval<boolean>(CAPTION_BOX_EXISTS).catch(() => false))) {
    throw new CdpError(
      `pressed Next ${advanced} time${advanced === 1 ? "" : "s"} but the caption screen never arrived — ` +
        `the video may still be processing, or the flow has changed`,
    );
  }

  // ── the caption ─────────────────────────────────────────────────────────
  // Waiting for Share was wrong: it renders before the composer mounts, so the
  // caption box was reached a beat too early and the run died saying it did
  // not exist — while a look at the page a second later found it perfectly.
  // Wait for the thing about to be used.
  await s.until<boolean>(CAPTION_BOX_EXISTS, { timeoutMs: 40_000 });
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
    const box = ${CAPTION_SELECTOR};
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
    const box = ${CAPTION_SELECTOR};
    return box ? (box.innerText || box.value || '').trim().length : 0;
  })()`);
  if (got === 0) throw new CdpError("the caption box stayed empty after typing");
}

/** Clicks away anything in the list that happens to be on screen. */
async function dismiss(s: Session, labels: string[]): Promise<void> {
  for (const label of labels) {
    if (await s.eval<boolean>(exists(label)).catch(() => false)) {
      await s.eval(clickIt(label)).catch(() => {});
      await sleep(700);
    }
  }
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
