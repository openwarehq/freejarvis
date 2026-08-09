import { targets, Session } from "./src/lib/cdp";

const PORT = 9333;
const deadline = Date.now() + 240_000;

async function loggedIn(): Promise<boolean> {
  const page = (await targets(PORT)).find(t => t.type === "page" && t.url.includes("instagram.com"));
  if (!page?.webSocketDebuggerUrl) return false;
  const s = await Session.attach(page.webSocketDebuggerUrl);
  try {
    await s.send("Runtime.enable");
    return await s.eval<boolean>(
      `!document.querySelector('input[name="username"]') && !/\\/accounts\\/login/.test(location.pathname)
       && document.cookie.includes('sessionid')`
    );
  } catch { return false; } finally { s.close(); }
}

process.stdout.write("waiting for you to log in");
while (Date.now() < deadline) {
  if (await loggedIn()) {
    console.log("\n\nlogged in — firing the reel flow (the same path ⌘⇧E takes)\n");
    const res = await fetch("http://localhost:4333/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ script: "reel" }),
    });
    const text = await res.text();
    for (const line of text.split("\n")) {
      const m = line.match(/^data: (.+)$/);
      if (!m) continue;
      const e = JSON.parse(m[1]);
      if (e.t === "tool.started") console.log(`  → ${e.name}`);
      if (e.t === "tool.completed") console.log(`\n  ${e.output}\n`);
    }
    process.exit(0);
  }
  process.stdout.write(".");
  await new Promise(r => setTimeout(r, 4000));
}
console.log("\n\nstill not logged in after 4 minutes — log in in the Chrome window and tell me");
