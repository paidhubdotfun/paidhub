/**
 * Where the repo root is, from inside a route.
 *
 * These routes ship as CommonJS bundles, because Vercel's dependency tracer cannot pull
 * @solana/web3.js into an ESM function. In a CJS bundle `import.meta.url` is EMPTY, so nothing here
 * may resolve a path from the module itself. The lambda's working directory is /var/task, which is
 * the repo root; locally it is the site folder. Both come out the same.
 */
import fs from "node:fs";
import path from "node:path";

export function fromRoot(...parts) {
  return path.join(process.cwd(), ...parts);
}

/** The first candidate that exists, so one layout change cannot silently break a route. */
export function findFile(candidates) {
  for (const c of candidates) {
    const file = fromRoot(...(Array.isArray(c) ? c : [c]));
    if (fs.existsSync(file)) return file;
  }
  return "";
}
