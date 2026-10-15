/**
 * Public files the pad writes: a coin's picture and its metadata. Vercel Blob when the token is
 * there, a directory under public/ when the suite is driving, so the same code path runs in both.
 */
import fs from "node:fs";
import path from "node:path";
import { fromRoot } from "./paths.js";

export async function putPublic(key, bytes, contentType) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const local = process.env.PH_PUBLIC_DIR;
  if (!token || local) {
    const dir = local || fromRoot(".state", "public");
    const file = path.join(dir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    const base = process.env.PH_PUBLIC_BASE || "http://localhost:5319/_local";
    return `${base}/${key}`;
  }
  const res = await fetch(`https://blob.vercel-storage.com/paidhub/${key}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": contentType,
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-cache-control-max-age": "31536000",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`could not store the file: ${res.status} ${await res.text()}`);
  return (await res.json()).url;
}
