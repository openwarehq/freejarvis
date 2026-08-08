import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { openTab, Session } from "@/lib/cdp";
import { upload, type Step } from "@/lib/uploader";
import { findChrome, portOpen } from "@/lib/uploader";

/**
 * The upload flow, driven end to end.
 *
 * The real `upload()` runs, unmodified, against a page that has the same shape
 * as Instagram's uploader — a Create control, a dialog with a file input, two
 * screens wanting "Next", a contenteditable caption box that only updates
 * through input events, and a Share button.
 *
 * There is no way to test this against instagram.com: it needs a logged-in
 * session, and a test that logs into somebody's account and posts to it is not
 * a test. What this proves is everything under the driver — that a file gets
 * attached without touching a native picker, that the screens are found by
 * their words, that the caption arrives in a way a framework would notice, and
 * above all that **Share is not pressed unless it was asked for**. What it
 * cannot prove is that Instagram's own markup still matches; that is what the
 * text-based targeting is for, and what `hangar doctor` is for.
 */

let server: http.Server;
let origin = "";
let chrome: ReturnType<typeof spawn> | null = null;
let port = 0;
let profile = "";
let video = "";

const has = fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

beforeAll(async () => {
  const page = fs.readFileSync(path.join(process.cwd(), "tests", "uploader.fixture.html"));
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  // A real, tiny video, so the file input receives something a browser will
  // actually accept rather than a renamed text file.
  video = path.join(os.tmpdir(), `hangar-test-${process.pid}.mp4`);
  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=270x480:rate=15:duration=1",
       "-pix_fmt", "yuv420p", "-y", video],
      (e) => (e ? reject(e) : resolve()),
    );
  });

  if (!has) return;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-profile-"));
  port = 9500 + (process.pid % 300);
  chrome = spawn(
    findChrome(),
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,960",
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && !(await portOpen(port))) {
    await new Promise((r) => setTimeout(r, 300));
  }
}, 60_000);

afterAll(async () => {
  chrome?.kill();
  server?.close();
  await fs.promises.rm(video, { force: true }).catch(() => {});
  if (profile) await fs.promises.rm(profile, { recursive: true, force: true }).catch(() => {});
});

async function drive(share: boolean, caption: string) {
  const tab = await openTab(port, "about:blank");
  const s = await Session.attach(tab.webSocketDebuggerUrl!);
  const steps: Step[] = [];
  try {
    await upload(s, { file: video, caption, share, origin, onStep: (x) => steps.push(x) });
    const state = await s.eval<{ caption: string; shared: boolean; file: { name: string; size: number } | null }>(
      `({ caption: window.__caption, shared: window.__shared, file: window.__file })`,
    );
    return { steps, state };
  } finally {
    s.close();
  }
}

describe.skipIf(!has)("the upload flow, end to end", () => {
  it("walks the whole thing and stops with Share unpressed", async () => {
    const { steps, state } = await drive(false, "a test caption\n\n#one #two");

    expect(steps.map((s) => s.t)).toEqual([
      "opening", "create", "picking", "attached",
      "advanced", "advanced", "caption", "ready", "stopped",
    ]);
    // The one that matters. Nothing was posted.
    expect(state.shared).toBe(false);
  }, 90_000);

  it("attaches the real file without a native picker", async () => {
    const { state } = await drive(false, "x");
    expect(state.file?.name).toBe(path.basename(video));
    expect(state.file?.size).toBe(fs.statSync(video).size);
  }, 90_000);

  it("types the caption in a way the page actually hears", async () => {
    // The fixture only records the caption on an input event, exactly as a
    // React-backed box does. Setting textContent would leave this empty and
    // the post would go out blank.
    const text = "second line check\n\n#three #four";
    const { state } = await drive(false, text);
    expect(state.caption.replace(/\n+/g, " ").trim()).toBe(text.replace(/\n+/g, " ").trim());
  }, 90_000);

  it("presses Share only when asked", async () => {
    const { steps, state } = await drive(true, "going out");
    expect(state.shared).toBe(true);
    expect(steps.at(-1)?.t).toBe("shared");
    expect(state.caption).toContain("going out");
  }, 90_000);
});
