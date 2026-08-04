import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Point the workspace and database somewhere disposable before anything in
// src/lib reads the module-level constants.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "freejarvis-test-"));
process.env.DATA_DIR = tmp;
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.WORKSPACE_DIR = path.join(tmp, "workspace");

const { builtinTools, htmlToText } = await import("@/lib/tools");

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const tool = (name: string) => {
  const t = builtinTools().find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("htmlToText", () => {
  it("drops scripts and styles rather than reading them aloud", () => {
    const out = htmlToText(
      "<html><head><style>p{color:red}</style><script>alert(1)</script></head>" +
        "<body><h1>Title</h1><p>First.</p><p>Second.</p></body></html>",
    );
    expect(out).not.toContain("alert");
    expect(out).not.toContain("color:red");
    expect(out).toContain("Title");
    expect(out).toContain("First.");
  });

  it("turns block ends into line breaks so paragraphs survive", () => {
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one\ntwo");
  });

  it("decodes the entities that show up in real pages", () => {
    expect(htmlToText("<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>")).toBe(
      `a & b <c> "d" 'e'`,
    );
  });
});

describe("the workspace jail", () => {
  beforeAll(async () => {
    await tool("write_file").run({ path: "notes/inside.md", content: "kept" });
  });

  it("writes inside the workspace", async () => {
    const body = fs.readFileSync(path.join(tmp, "workspace", "notes", "inside.md"), "utf8");
    expect(body).toBe("kept");
  });

  it("refuses to climb out with ..", async () => {
    await expect(
      tool("write_file").run({ path: "../escaped.md", content: "no" }),
    ).rejects.toThrow(/outside the workspace/);
    expect(fs.existsSync(path.join(tmp, "escaped.md"))).toBe(false);
  });

  it("refuses an absolute path", async () => {
    await expect(
      tool("write_file").run({ path: "/tmp/freejarvis-escaped.md", content: "no" }),
    ).rejects.toThrow(/outside the workspace/);
  });

  it("refuses to read its way out", async () => {
    await expect(tool("read_file").run({ path: "../../../etc/passwd" })).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it("does not follow a symlink planted inside the workspace", async () => {
    const secret = path.join(tmp, "secret.txt");
    fs.writeFileSync(secret, "do not read me");
    fs.symlinkSync(secret, path.join(tmp, "workspace", "link.txt"));
    await expect(tool("read_file").run({ path: "link.txt" })).rejects.toThrow(
      /outside the workspace/,
    );
  });
});

describe("gating", () => {
  it("marks the tools that change something outside the conversation", () => {
    const gated = builtinTools()
      .filter((t) => t.gated)
      .map((t) => t.name)
      .sort();
    expect(gated).toEqual(["schedule", "write_file"]);
  });

  it("gives every gated tool a reason to show on the approval card", () => {
    for (const t of builtinTools().filter((x) => x.gated)) {
      expect(t.gateReason, t.name).toBeTruthy();
    }
  });
});

describe("schedule", () => {
  it("refuses an invalid cron instead of creating a job that never fires", async () => {
    const out = await tool("schedule").run({
      name: "bad",
      schedule: "every morning",
      prompt: "x",
    });
    expect(out).toMatch(/not a five-field cron/);
  });

  it("creates the job when the expression parses", async () => {
    const out = await tool("schedule").run({
      name: "digest",
      schedule: "0 9 * * *",
      prompt: "summarise",
    });
    expect(out).toMatch(/Scheduled "digest"/);
  });
});

describe("read_web", () => {
  it("refuses anything that is not http", async () => {
    expect(await tool("read_web").run({ url: "file:///etc/passwd" })).toMatch(
      /Only http and https/,
    );
  });
});
