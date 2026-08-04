import { describe, expect, it } from "vitest";
import { takeSentences } from "@/lib/sentences";

/** Feed a string through in small chunks, the way a token stream arrives. */
function stream(text: string, chunk = 3) {
  const out: string[] = [];
  let rest = "";
  for (let i = 0; i < text.length; i += chunk) {
    const r = takeSentences(rest + text.slice(i, i + chunk), false);
    out.push(...r.sentences);
    rest = r.rest;
  }
  out.push(...takeSentences(rest, true).sentences);
  return out;
}

describe("takeSentences", () => {
  it("emits a sentence once whitespace proves it ended", () => {
    const r = takeSentences("Done. Next thing", false);
    expect(r.sentences).toEqual(["Done."]);
    expect(r.rest).toBe("Next thing");
  });

  it("does not split on a terminator sitting at the end of the buffer", () => {
    // The bug this exists to prevent: mid-way through "notes.md." the buffer
    // reads "…to notes.", and calling that a sentence leaves a fragment that
    // the voice reads out as two letters.
    const r = takeSentences("I am writing to notes.", false);
    expect(r.sentences).toEqual([]);
    expect(r.rest).toBe("I am writing to notes.");
  });

  it("keeps a filename in one piece across a whole stream", () => {
    expect(stream("I am writing a summary to notes.md.")).toEqual([
      "I am writing a summary to notes.md.",
    ]);
  });

  it("splits a multi-sentence stream at the right places", () => {
    expect(stream("Done. The file is at notes.md. Anything else?")).toEqual([
      "Done.",
      "The file is at notes.md.",
      "Anything else?",
    ]);
  });

  it("flushes an unpunctuated tail when the run ends", () => {
    const r = takeSentences("no full stop here", true);
    expect(r.sentences).toEqual(["no full stop here"]);
    expect(r.rest).toBe("");
  });

  it("keeps a closing quote or bracket with its sentence", () => {
    expect(takeSentences('He said "go." Then left.', false).sentences).toEqual([
      'He said "go."',
    ]);
  });

  it("handles ellipsis and exclamation", () => {
    expect(stream("Wait… I found it! Two matches.")).toEqual([
      "Wait…",
      "I found it!",
      "Two matches.",
    ]);
  });

  it("does not emit a bare terminator as a sentence", () => {
    expect(takeSentences(". ", false).sentences).toEqual([]);
  });

  it("survives being fed one character at a time", () => {
    expect(stream("First. Second.", 1)).toEqual(["First.", "Second."]);
  });

  it("returns nothing for an empty final flush", () => {
    expect(takeSentences("   ", true).sentences).toEqual([]);
  });
});
