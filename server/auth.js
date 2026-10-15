/**
 * Sign in with GitHub, for developers only: no scope is asked, so the pad learns the public id and login
 * and nothing else. ?step=start sends you to GitHub, ?step=back comes home, ?step=out signs you out.
 */
import { bad, route, query } from "./lib/http.js";
import { startCookie, checkState, sessionCookie, clearCookies } from "./lib/session.js";

function redirect(res, to, cookies = []) {
  res.statusCode = 302;
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.setHeader("location", to);
  res.setHeader("cache-control", "no-store");
  res.end();
  return res;
}

const site = () => String(process.env.PH_SITE_URL || "").replace(/\/$/, "");

export const handler = route(async (req, res) => {
  const id = process.env.PH_GH_CLIENT_ID;
  const secret = process.env.PH_GH_CLIENT_SECRET;
  if (!id || !secret) return bad(res, "GitHub sign-in is not configured yet", 503);
  const step = String(query(req, "step") || "start");

  if (step === "out") return redirect(res, `${site()}/developers`, clearCookies());

  if (step === "start") {
    const { nonce, header } = startCookie();
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", id);
    url.searchParams.set("redirect_uri", `${site()}/api/auth?step=back`);
    url.searchParams.set("state", nonce);
    url.searchParams.set("allow_signup", "false");
    return redirect(res, url.toString(), [header]);
  }

  if (step === "back") {
    const code = String(query(req, "code") || "");
    if (!code || !checkState(req, String(query(req, "state") || ""))) return redirect(res, `${site()}/developers?signin=stale`, clearCookies());
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: id, client_secret: secret, code, redirect_uri: `${site()}/api/auth?step=back` }),
    }).then((r) => r.json());
    if (!tokenRes.access_token) return redirect(res, `${site()}/developers?signin=refused`, clearCookies());
    const user = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${tokenRes.access_token}`, accept: "application/vnd.github+json", "user-agent": "paidhub" },
    }).then((r) => r.json());
    // the token is not kept: it only told us who this is
    if (!user?.id || user.type !== "User") return redirect(res, `${site()}/developers?signin=refused`, clearCookies());
    return redirect(res, `${site()}/developers`, sessionCookie({ id: user.id, login: user.login, avatar: user.avatar_url }));
  }
  return bad(res, "step is start, back or out");
});

export default handler;
