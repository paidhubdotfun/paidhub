/**
 * What the keeper publishes and the site reads.
 *
 * Two backings, same interface: Vercel Blob when the token is there (that is how the live site
 * reads it), and a plain directory otherwise, which is what the suite drives. Nothing the keeper
 * writes is ever a secret, and nothing the site shows comes from anywhere else.
 */
import fs from "node:fs";
import path from "node:path";
import { fromRoot } from "./paths.js";

const PREFIX = "paidhub";

export function openStore({ dir = process.env.PH_STATE_DIR, token = process.env.BLOB_READ_WRITE_TOKEN } = {}) {
  if (dir) return fileStore(dir);
  if (token) return blobStore(token);
  return fileStore(fromRoot(".state"));
}

/**
 * A plain directory. It is created on the first WRITE, never on open: a serverless filesystem is
 * read only, and a pad whose keeper has not published yet has to answer "nothing here" rather than
 * fail with EROFS on a folder nobody was going to read.
 */
function fileStore(dir) {
  const file = (key) => path.join(dir, `${key.replace(/\//g, "__")}.json`);
  return {
    kind: "file",
    where: dir,
    async read(key, fallback = null) {
      try {
        return JSON.parse(fs.readFileSync(file(key), "utf8"));
      } catch {
        return fallback;
      }
    },
    async write(key, value) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file(key), JSON.stringify(value));
      return file(key);
    },
    async remove(key) {
      try {
        fs.unlinkSync(file(key));
        return true;
      } catch {
        return false;
      }
    },
    async list(prefix) {
      return (await this.listMeta(prefix)).map((x) => x.key);
    },
    async listMeta(prefix) {
      try {
        return fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => ({ key: f.slice(0, -5).replace(/__/g, "/"), uploadedAt: fs.statSync(path.join(dir, f)).mtimeMs }))
          .filter((x) => x.key.startsWith(prefix));
      } catch {
        return [];
      }
    },
  };
}

// A blob's url never changes for its path (no random suffix): a read
// is then one plain fetch, not a list (an "advanced" operation) plus a fetch.
const urls = new Map();

function blobStore(token) {
  const base = "https://blob.vercel-storage.com";
  const url = (key) => `${PREFIX}/${key}.json`;
  return {
    kind: "blob",
    where: "vercel blob",
    async read(key, fallback = null) {
      // the store's public host is in its token (vercel_blob_rw_<store>_<secret>): a read is one fetch, and a
      // missing blob one 404, never a list
      const store = String(token).split("_")[3];
      const where = urls.get(key) || (store ? `https://${store.toLowerCase()}.public.blob.vercel-storage.com/${url(key)}` : "");
      if (where) {
        const res = await fetch(`${where}?t=${Date.now()}`);
        if (res.ok) return res.json().catch(() => fallback);
        if (res.status === 404) return fallback;
        urls.delete(key);
      }
      const listed = await fetch(`${base}?prefix=${encodeURIComponent(url(key))}&limit=1`, {
        headers: { authorization: `Bearer ${token}` },
      }).then((r) => r.json());
      const blob = listed?.blobs?.find((b) => b.pathname === url(key));
      if (!blob) return fallback;
      urls.set(key, blob.url);
      const res = await fetch(`${blob.url}?t=${Date.now()}`);
      if (!res.ok) return fallback;
      return res.json().catch(() => fallback);
    },
    async write(key, value) {
      const res = await fetch(`${base}/${url(key)}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-add-random-suffix": "0",
          "x-allow-overwrite": "1",
          "x-cache-control-max-age": "60",
        },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error(`blob write failed: ${res.status} ${await res.text()}`);
      const written = (await res.json()).url;
      urls.set(key, written);
      return written;
    },
    async remove(key) {
      const listed = await fetch(`${base}?prefix=${encodeURIComponent(url(key))}&limit=1`, {
        headers: { authorization: `Bearer ${token}` },
      }).then((r) => r.json());
      const blob = listed?.blobs?.[0];
      if (!blob) return false;
      urls.delete(key);
      await fetch(`${base}/delete`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ urls: [blob.url] }),
      });
      return true;
    },
    async list(prefix) {
      return (await this.listMeta(prefix)).map((x) => x.key);
    },
    /** Every blob under the prefix, page after page, with when it was last written. */
    async listMeta(prefix) {
      const out = [];
      let cursor = "";
      for (let page = 0; page < 50; page++) {
        const listed = await fetch(`${base}?prefix=${encodeURIComponent(`${PREFIX}/${prefix}`)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
          headers: { authorization: `Bearer ${token}` },
        }).then((r) => r.json());
        for (const b of listed?.blobs || []) {
          const key = b.pathname.replace(new RegExp(`^${PREFIX}/`), "").replace(/\.json$/, "");
          urls.set(key, b.url);
          out.push({ key, uploadedAt: Date.parse(b.uploadedAt) || 0 });
        }
        if (!listed?.hasMore || !listed.cursor) break;
        cursor = listed.cursor;
      }
      return out;
    },
  };
}

/** The pad's front page: every coin, the pot, the last buybacks. Written by the keeper. */
export const STATE_KEY = "state";
/** The Unclaimed board: every GitHub fee account on pump, biggest first. Written by the keeper. */
export const BOARD_KEY = "board";
/** Today's scout list. Written by the keeper. */
export const SCOUT_KEY = "scout";
/** A coin the pad registered (written by /api/send from the pad's own launch record). */
export const coinKey = (mint) => `coins/${mint}`;
/** One coin per repo: the numeric repo id points at its coin. */
export const repoKey = (repoId) => `repos/${repoId}`;
/** Someone is launching this repo right now (a short hold, so two people do not mint two coins). */
export const repoHoldKey = (repoId) => `holds/${repoId}`;
/** What a launch was built for, before it landed. */
export const launchKey = (mint) => `launches/${mint}`;
export const pendingKey = (wallet) => `pending/${wallet}`;
/** A coin's live page: who it pays, what they got, the claims and buybacks. Written by the keeper. */
export const pageKey = (mint) => `pages/${mint}`;
/** A person's own word: "never launch me" (whole account or some repos) and "yes, I am in". */
export const personKey = (githubId) => `people/${githubId}`;
