import { describe, expect, it } from "vitest";
import { createSseParser } from "@/lib/events";

function collect(chunks: string[]): string[] {
  const seen: string[] = [];
  const parser = createSseParser((d) => seen.push(d));
  for (const c of chunks) parser.push(c);
  return seen;
}

describe("createSseParser", () => {
  it("reads whole frames", () => {
    expect(collect(['data: {"a":1}\n\ndata: {"a":2}\n\n'])).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("survives a chunk boundary in the middle of a frame", () => {
    // This is the failure that shows up only against a real network: the
    // stream arrives split at an arbitrary byte and a naive split() loses it.
    expect(collect(['data: {"he', 'llo":true}\n\n'])).toEqual(['{"hello":true}']);
  });

  it("survives a boundary inside the frame separator", () => {
    expect(collect(['data: {"a":1}\n', '\ndata: {"a":2}\n\n'])).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("handles CRLF, which some proxies insert", () => {
    expect(collect(['data: {"a":1}\r\n\r\n'])).toEqual(['{"a":1}']);
  });

  it("ignores comment and event lines but keeps the data", () => {
    expect(collect([': keepalive\nevent: tool.started\ndata: {"id":"1"}\n\n'])).toEqual([
      '{"id":"1"}',
    ]);
  });

  it("holds an incomplete trailing frame rather than emitting half of it", () => {
    expect(collect(['data: {"a":1}\n\ndata: {"b":'])).toEqual(['{"a":1}']);
  });

  it("passes [DONE] through for the caller to interpret", () => {
    expect(collect(["data: [DONE]\n\n"])).toEqual(["[DONE]"]);
  });
});
