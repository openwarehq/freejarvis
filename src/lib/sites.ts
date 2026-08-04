import fs from "node:fs";
import path from "node:path";

/**
 * Sites the agent can pull up on the deck.
 *
 * Point `SITES_DIR` at a folder and every `.html` file in it — or every
 * `<name>/index.html` under it — becomes something you can ask for by name.
 * Nothing is generated here and nothing is written; this is a viewer.
 *
 * The names are read at request time and fed into the `open_site` tool's own
 * description, which is the part that makes asking for one by name work: a
 * model that has been told the folder contains `azur` will call
 * `open_site("azur")`, and a model that has to guess will not.
 */

export const SITES_DIR = (process.env.SITES_DIR ?? "").trim();

export type Site = { name: string; title: string; bytes: number; modified: number };

function titleOf(file: string): string {
  try {
    // The <title> is in the first few KB of any sane document, and reading
    // 8 KB beats reading a 20 MB single-file export to find it.
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const read = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    const m = buf.subarray(0, read).toString("utf8").match(/<title[^>]*>([^<]*)<\/title>/i);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

/** Resolve a site name to a file on disk, or null. Never escapes SITES_DIR. */
export function resolveSite(name: string): string | null {
  if (!SITES_DIR) return null;
  // A site name is a name, not a path. Anything else is refused outright
  // rather than normalised — there is no legitimate `../` here.
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) return null;

  let root: string;
  try {
    root = fs.realpathSync(path.resolve(SITES_DIR));
  } catch {
    return null;
  }

  for (const candidate of [
    path.join(root, name.endsWith(".html") ? name : `${name}.html`),
    path.join(root, name, "index.html"),
  ]) {
    try {
      // Resolve the file itself, not just the string. A symlink sitting
      // inside the folder and pointing above it passes every lexical prefix
      // check ever written, and then serves whatever it points at.
      const resolved = fs.realpathSync(candidate);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) continue;
      if (fs.statSync(resolved).isFile()) return resolved;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

export function listSites(): Site[] {
  if (!SITES_DIR) return [];
  const root = path.resolve(SITES_DIR);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: Site[] = [];
  for (const e of entries) {
    let file: string | null = null;
    let name = "";
    if (e.isFile() && e.name.toLowerCase().endsWith(".html")) {
      name = e.name.replace(/\.html$/i, "");
      file = path.join(root, e.name);
    } else if (e.isDirectory()) {
      const index = path.join(root, e.name, "index.html");
      if (fs.existsSync(index)) {
        name = e.name;
        file = index;
      }
    }
    if (!file || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) continue;
    try {
      const st = fs.statSync(file);
      out.push({ name, title: titleOf(file), bytes: st.size, modified: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function readSite(name: string): string | null {
  const file = resolveSite(name);
  if (!file) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
