#!/usr/bin/env node
/**
 * The serverless functions, bundled.
 *
 * Vercel's dependency tracer does not pull @solana/web3.js into an ESM function: the build says
 * READY and every route then answers FUNCTION_INVOCATION_FAILED with
 * "Cannot find package '@solana/web3.js'". An esbuild ESM bundle of the same code still throws on
 * Vercel's Node runtime; a CommonJS bundle does not. So each route in server/ is bundled into
 * api/<route>.js as CJS, api/package.json declares `type: commonjs` under this `type: module`
 * project, and THE BUNDLES ARE COMMITTED: Vercel finds functions in the repo tree, not in the build
 * output, and tools/ is in .vercelignore so this cannot run during the Vercel build.
 *
 * Editing anything in server/ means running this again.
 *
 *   node tools/bundle.mjs            build
 *   node tools/bundle.mjs --check    fail if the committed bundles are stale
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "server");
const OUT = path.join(ROOT, "api");
const CHECK = process.argv.includes("--check");

const routes = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
  .map((f) => f.replace(/\.js$/, ""));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`
);

let stale = [];
for (const route of routes) {
  const outfile = path.join(OUT, `${route}.js`);
  const before = fs.existsSync(outfile) ? hash(fs.readFileSync(outfile)) : "";
  await esbuild.build({
    entryPoints: [path.join(SRC, `${route}.js`)],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    minify: true,
    legalComments: "none",
    banner: {
      js: `// Built by tools/bundle.mjs from server/${route}.js. Do not edit; edit the source and run it again.`,
    },
  });
  const after = hash(fs.readFileSync(outfile));
  if (CHECK && before !== after) stale.push(route);
  const size = (fs.statSync(outfile).size / 1024).toFixed(0);
  console.log(`api/${route}.js  ${size} KB`);
}

if (CHECK && stale.length) {
  console.error(`\nstale bundles: ${stale.join(", ")}. Run node tools/bundle.mjs and commit them.`);
  process.exitCode = 1;
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
