import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  candidates,
  clock,
  fingerprint,
  measuredCaption,
  settled,
  size,
  titleFrom,
  type Probe,
} from "@/lib/reels";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-q-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (name: string, bytes = 4096, mtime?: Date) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, Buffer.alloc(bytes, name.charCodeAt(0)));
  if (mtime) fs.utimesSync(f, mtime, mtime);
  return f;
};

describe("the drop folder", () => {
  it("takes videos and leaves everything else alone", () => {
    put("a.mp4");
    put("b.mov");
    put("c.webm");
    put("notes.txt");
    put("thumb.jpg");
    expect(candidates(dir).map((c) => c.name).sort()).toEqual(["a.mp4", "b.mov", "c.webm"]);
  });

  it("ignores the half-written files a download leaves behind", () => {
    // Picking one of these up gives a corrupt upload and no error anywhere.
    put("good.mp4");
    put("half.mp4.download");
    put("part.mov.part");
    put(".DS_Store");
    put("._resource.mov");
    expect(candidates(dir).map((c) => c.name)).toEqual(["good.mp4"]);
  });

  it("goes oldest first, so the folder is a queue and not a stack", () => {
    put("newest.mp4", 4096, new Date("2026-03-03"));
    put("oldest.mp4", 4096, new Date("2026-01-01"));
    put("middle.mp4", 4096, new Date("2026-02-02"));
    expect(candidates(dir).map((c) => c.name)).toEqual(["oldest.mp4", "middle.mp4", "newest.mp4"]);
  });

  it("will not call a file that is still growing ready", async () => {
    const f = put("growing.mp4", 1024);
    const grow = setInterval(() => fs.appendFileSync(f, Buffer.alloc(512)), 120);
    const ready = await settled(f, 500);
    clearInterval(grow);
    expect(ready).toBe(false);
  });

  it("calls a finished file ready", async () => {
    expect(await settled(put("done.mp4"), 200)).toBe(true);
  });

  it("treats an empty file as not ready", async () => {
    fs.writeFileSync(path.join(dir, "empty.mp4"), "");
    expect(await settled(path.join(dir, "empty.mp4"), 100)).toBe(false);
  });
});

describe("remembering what has flown", () => {
  it("recognises the same file after it is renamed", () => {
    // Filing a clip into an archive folder after posting it must not make it
    // look new again.
    const a = put("clip.mp4", 8192);
    const b = path.join(dir, "posted-2026-08-08.mp4");
    fs.renameSync(a, b);
    expect(fingerprint(b)).toBe(fingerprint(b));

    const c = put("clip.mp4", 8192);
    expect(fingerprint(c)).toBe(fingerprint(b));
  });

  it("tells two different clips apart", () => {
    const a = put("one.mp4", 8192);
    const b = put("two.mp4", 8193);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("survives a file smaller than the sample window", () => {
    expect(fingerprint(put("tiny.mp4", 12))).toHaveLength(24);
  });
});

describe("the measured caption", () => {
  const base: Probe = {
    file: "/x/vexlb.mov", name: "vexlb.mov", bytes: 1 << 20,
    seconds: 9.4, width: 1080, height: 1920, fps: 60,
    shape: "portrait", hasAudio: true, cuts: 41,
    created: new Date("2026-08-08T04:32:00"), codec: "h264",
  };

  it("says only what was measured", () => {
    const text = measuredCaption(base);
    expect(text).toContain("0:09");
    expect(text).toContain("41 cuts");
    expect(text).toContain("1080×1920");
    expect(text).toContain("Saturday");
    // Nothing about what is in the video, because nothing looked at it.
    expect(text).not.toMatch(/beautiful|amazing|vibe|check out|link in bio/i);
  });

  it("keeps the operator's own words as the title", () => {
    expect(titleFrom("hangar_demo_v2.mp4")).toBe("hangar demo");
    expect(titleFrom("BackAlleyCut.mov")).toBe("Back Alley Cut");
  });

  it("throws away names that are not titles", () => {
    // "Screen Recording 2026-04-24 at 5.04.01 PM" is not a caption and
    // dressing it up as one is worse than not having one.
    expect(titleFrom("Screen Recording 2026-04-24 at 5.04.01 PM.mov")).toBeNull();
    expect(titleFrom("IMG_4021.mov")).toBeNull();
    expect(titleFrom("2026-08-08 22.14.11.mp4")).toBeNull();
  });

  it("still has something to say when the filename is useless", () => {
    const text = measuredCaption({ ...base, name: "IMG_4021.mov" });
    expect(text.split("\n")[0]).toBe("0:09 of portrait footage.");
  });

  it("does not claim cuts it could not count", () => {
    expect(measuredCaption({ ...base, cuts: null })).not.toMatch(/cut/);
    expect(measuredCaption({ ...base, cuts: 0 })).not.toMatch(/cut/);
  });

  it("mentions silence, because silence is a choice", () => {
    expect(measuredCaption({ ...base, hasAudio: false })).toContain("no sound");
  });
});

describe("formatting", () => {
  it("reads durations as a clock", () => {
    expect(clock(9.4)).toBe("0:09");
    expect(clock(109.6)).toBe("1:50");
    expect(clock(0.2)).toBe("0:00");
  });

  it("reads sizes at the scale a person thinks in", () => {
    expect(size(501 * 1024)).toBe("501KB");
    expect(size(63 * (1 << 20))).toBe("63MB");
    expect(size(2.5 * (1 << 30))).toBe("2.5GB");
  });
});
