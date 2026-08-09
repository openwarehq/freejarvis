/**
 * The reel browser, streamed onto the deck.
 *
 * Instagram cannot be put in an iframe — it sends `X-Frame-Options: DENY`, and
 * that is not a bug to work around, it is the site saying no. So the deck does
 * not embed the page; it watches it. CDP's `Page.startScreencast` hands back a
 * JPEG every time the page repaints, and those frames go straight to the deck.
 *
 * The result is better than a tab would have been: the browser can be anywhere,
 * behind anything, on another desktop, and the work still appears on the deck
 * next to the orb. Nothing takes the screen away from you.
 *
 * A single frame is kept, not a queue. If the deck is slower than the page
 * repaints, the right thing to drop is the old frame — nobody wants to watch a
 * backlog of stale pictures catch up.
 */

export type Frame = { data: string; at: number };

let latest: Frame | null = null;
let live = false;
const listeners = new Set<(f: Frame) => void>();

export function pushFrame(data: string): void {
  latest = { data, at: Date.now() };
  for (const l of listeners) l(latest);
}

export function lastFrame(): Frame | null {
  return latest;
}

export function isLive(): boolean {
  return live;
}

export function setLive(v: boolean): void {
  live = v;
  // The final frame is deliberately kept when the feed ends: it is the filled-in
  // post with Share unpressed, which is the thing worth looking at.
  for (const l of listeners) if (latest) l(latest);
}

export function onFrame(fn: (f: Frame) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
