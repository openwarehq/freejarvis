/**
 * Chrome, driven directly over the DevTools Protocol.
 *
 * No Puppeteer, no Playwright, no dependency at all: Node 22 ships a global
 * `WebSocket`, and CDP is a WebSocket carrying JSON. The entire client is the
 * sixty lines below. That matters more than saving an install — a tool that
 * drives *your* logged-in browser should be something you can read in one
 * sitting before you let it click things on your behalf.
 *
 * Two behaviours worth knowing about:
 *
 * - **Every command can time out.** A CDP call against a page that is still
 *   navigating simply never answers. Without a per-command deadline the whole
 *   run hangs with no output, which is indistinguishable from a crash.
 * - **Events are buffered from the moment the session opens.** Waiting for an
 *   event you have already missed is the classic way to hang forever, so
 *   `waitFor` checks the buffer before it starts waiting.
 */

export type CdpTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CdpError extends Error {}

/** Lists the debuggable targets on a running Chrome. */
export async function targets(port: number): Promise<CdpTarget[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new CdpError(`Chrome answered ${res.status} on port ${port}`);
  return (await res.json()) as CdpTarget[];
}

/** Opens a new tab and returns its target. */
export async function openTab(port: number, url: string): Promise<CdpTarget> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new CdpError(`could not open a tab: ${res.status}`);
  return (await res.json()) as CdpTarget;
}

export class Session {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** Events seen so far, so waitFor cannot miss one that already fired. */
  private seen: Array<{ method: string; params: Record<string, unknown> }> = [];
  private listeners = new Set<(m: string, p: Record<string, unknown>) => void>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => this.onMessage(String(ev.data)));
    ws.addEventListener("close", () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new CdpError("the browser closed the connection"));
      }
      this.pending.clear();
    });
  }

  static async attach(wsUrl: string): Promise<Session> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CdpError("timed out attaching to the tab")), 10_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpError("could not attach to the tab"));
      });
    });
    return new Session(ws);
  }

  private onMessage(raw: string) {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message: string };
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new CdpError(msg.error.message));
      else p.resolve(msg.result);
      return;
    }

    if (msg.method) {
      const ev = { method: msg.method, params: msg.params ?? {} };
      this.seen.push(ev);
      // Keeping every event of a long session is a slow leak; the last few
      // hundred is far more than anything here waits on.
      if (this.seen.length > 400) this.seen.splice(0, 200);
      for (const l of this.listeners) l(ev.method, ev.params);
    }
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 20_000,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`${method} did not answer within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolves when `method` fires — including if it already has. */
  waitFor(method: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    const already = this.seen.find((e) => e.method === method);
    if (already) return Promise.resolve(already.params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new CdpError(`${method} never fired`));
      }, timeoutMs);
      const listener = (m: string, p: Record<string, unknown>) => {
        if (m !== method) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(p);
      };
      this.listeners.add(listener);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }

  // ── the handful of things this tool actually does to a page ──────────────

  /**
   * Evaluates an expression in the page and returns its value.
   *
   * `awaitPromise` is on so callers can hand it an async expression, and
   * `returnByValue` so what comes back is JSON rather than a remote handle
   * that would then need releasing.
   */
  async eval<T>(expression: string, timeoutMs = 20_000): Promise<T> {
    const r = await this.send<{
      result: { value?: T; description?: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (r.exceptionDetails) {
      throw new CdpError(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "page threw",
      );
    }
    return r.result.value as T;
  }

  /** Polls an expression until it is truthy, or gives up. */
  async until<T>(expression: string, opts: { timeoutMs?: number; every?: number } = {}): Promise<T> {
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    const every = opts.every ?? 400;
    let last: Error | null = null;
    for (;;) {
      try {
        const v = await this.eval<T>(expression, 8000);
        if (v) return v;
      } catch (e) {
        last = e as Error;
      }
      if (Date.now() > deadline) {
        throw new CdpError(
          `gave up waiting for: ${expression.slice(0, 90)}${last ? ` (last error: ${last.message})` : ""}`,
        );
      }
      await new Promise((r) => setTimeout(r, every));
    }
  }
}
