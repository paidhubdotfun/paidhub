import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * The page's CSS is served straight out of public/ rather than bundled: an inline <style> in
 * index.html breaks the build under a Windows user folder whose path carries characters outside
 * ASCII, and this repo's own path carries a `$`.
 *
 * In dev, /api/* is served by the SOURCES in server/, which are the same files tools/bundle.mjs
 * turns into the committed api/*.js functions Vercel runs. Clicking through the site locally
 * exercises the real routes rather than a stub of them.
 */
function apiInDev() {
  return {
    name: "paidhub-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://local");
        if (!url.pathname.startsWith("/api/")) return next();
        const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "");
        const file = path.join(server.config.root, "server", `${name}.js`);
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ ok: false, error: `no route /api/${name}` }));
        }
        try {
          const mod = await server.ssrLoadModule(`/server/${name}.js`);
          req.query = Object.fromEntries(url.searchParams);
          await (mod.handler || mod.default)(req, res);
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [apiInDev()],
  build: { target: "es2022", assetsInlineLimit: 0 },
  server: { port: 5393, strictPort: false },
});
