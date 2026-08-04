import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Without this, Next walks up looking for a lockfile, finds one in the home
  // directory, and traces the standalone build from there — which puts
  // server.js somewhere the Dockerfile does not COPY from and produces an
  // image that builds cleanly and then cannot start.
  outputFileTracingRoot: path.join(__dirname),
  // better-sqlite3 is a native addon. Next would otherwise try to bundle it
  // into the server chunks and the .node binary would not survive the trip.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
