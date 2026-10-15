/**
 * The signed-in developer: one HttpOnly cookie holding their public GitHub id and login, signed with
 * PH_SECRET. The GitHub token used to read who they are is thrown away the moment it is read.
 */
import crypto from "node:crypto";

const COOKIE = "ph_s";
const STATE = "ph_o";
const DAY = 86_400_000;

function key() {
  const s = process.env.PH_SECRET;
  if (!s || s.length < 32) throw new Error("PH_SECRET is not set");
  return s;
}
const sign = (text) => crypto.createHmac("sha256", key()).update(text).digest("base64url");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function readCookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sealed(value) {
  const [body, mac] = String(value || "").split(".");
  if (!body || !mac) return null;
  const want = sign(body);
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try {
    const o = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return o.exp && o.exp > Date.now() ? o : null;
  } catch {
    return null;
  }
}

const cookie = (name, value, maxAgeS) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;

export function session(req) {
  return sealed(readCookies(req)[COOKIE]);
}

export function startCookie() {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const body = b64({ nonce, exp: Date.now() + 15 * 60_000 });
  return { nonce, header: cookie(STATE, `${body}.${sign(body)}`, 900) };
}

export function checkState(req, state) {
  const o = sealed(readCookies(req)[STATE]);
  return !!o && o.nonce === state;
}

export function sessionCookie(user) {
  const body = b64({ id: String(user.id), login: user.login, avatar: user.avatar || "", exp: Date.now() + 30 * DAY });
  return [cookie(COOKIE, `${body}.${sign(body)}`, 30 * 86400), cookie(STATE, "", 0)];
}

export const clearCookies = () => [cookie(COOKIE, "", 0), cookie(STATE, "", 0)];
