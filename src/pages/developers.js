// For developers: sign in with GitHub (no permissions asked), then say never, say you are in, or close
// some repos. Their word is public on purpose: launchers see it before they launch.
import { esc, px, avatar, MARK } from "../ui.js";
import { me, saveMe } from "../api.js";

export default async function developersPage(root) {
  const params = new URLSearchParams(location.search);
  root.innerHTML = `
  <div class="page" style="max-width:860px">
    <section>
      <p class="label dim">developers.md</p>
      <h1>For developers</h1>
      <p class="lede" style="margin-top:12px">Someone may launch a coin on your repo. If they do, half of its creator fees go to your GitHub account on pump.fun, and only you can claim them. paidhub never emails you and never opens issues on your repos. You decide here.</p>
    </section>
    <section class="panel" id="box"><p class="empty">Checking whether you are signed in…</p></section>
    <section class="steps steps--3">
      <div class="step">${px("file-never", 2)}<h3>Never</h3><p>No new coin can pay you. Coins already launched keep their split (pump.fun locks it), but their pages say you said never.</p></div>
      <div class="step">${px("file-yes", 2)}<h3>I'm in</h3><p>Every coin that pays you says you are in, and launchers see it before they launch.</p></div>
      <div class="step">${px("file-stuck", 2)}<h3>Close a repo</h3><p>No coin at all on that repo, for anyone. Only repos you own or committed to.</p></div>
    </section>
  </div>`;

  const box = root.querySelector("#box");
  const note = params.get("signin") === "refused" ? `<p class="tag">GitHub did not sign you in. Try again.</p>` : params.get("signin") === "stale" ? `<p class="tag">That sign-in link expired. Try again.</p>` : "";

  let state;
  try {
    state = await me();
  } catch (e) {
    box.innerHTML = `<p>Could not check your sign-in: ${esc(e.message)}</p>`;
    return;
  }
  if (!state.signedIn) {
    box.innerHTML = `
      ${note}
      <h2>Sign in with GitHub</h2>
      <p style="margin:10px 0 16px">paidhub asks GitHub for nothing but your public id and login. No email, no repo access. The GitHub token is thrown away as soon as it says who you are.</p>
      <a class="btn btn--black" id="signin" href="/api/auth?step=start">${MARK.github.replace('class="mark"', 'class="mark" style="filter:invert(1)"')} Sign in with GitHub</a>`;
    root.querySelector("#signin").addEventListener("click", async (e) => {
      // the route answers 503 until the GitHub app exists: say so instead of showing a raw error page
      e.preventDefault();
      const r = await fetch("/api/auth?step=start", { redirect: "manual" }).catch(() => null);
      if (r && r.status === 503) {
        box.insertAdjacentHTML("beforeend", `<p class="tag" style="margin-top:12px">GitHub sign-in opens with the pad's launch.</p>`);
        return;
      }
      location.href = "/api/auth?step=start";
    });
    return;
  }

  const render = (word) => {
    box.innerHTML = `
      <div class="row" style="gap:16px;align-items:center">${avatar(state.user.avatar, "avatar--big")}<div><h2>@${esc(state.user.login)}</h2><a href="/@${esc(state.user.login)}">What waits for you on pump.fun</a></div></div>
      <form class="form" id="word" style="margin-top:18px">
        <label class="check"><input type="radio" name="w" value="" ${!word.never && !word.yes ? "checked" : ""} /><span><b>No word</b>: coins can be launched; their pages say you have not endorsed them.</span></label>
        <label class="check"><input type="radio" name="w" value="yes" ${word.yes ? "checked" : ""} /><span><b>I'm in</b>: coins can be launched and say you are in.</span></label>
        <label class="check"><input type="radio" name="w" value="never" ${word.never ? "checked" : ""} /><span><b>Never</b>: no new coin may pay me.</span></label>
        <div class="field"><label for="repos">Close these repos (one owner/repo per line, only yours)</label><textarea class="well" id="repos" placeholder="${esc(state.user.login)}/my-repo">${esc((word.neverRepos || []).map((r) => r.fullName).join("\n"))}</textarea></div>
        <div class="row"><button class="btn btn--black" type="submit">Save</button><a class="btn" href="/api/auth?step=out">Sign out</a></div>
        <div class="status" id="saved" aria-live="polite"></div>
      </form>`;
    root.querySelector("#word").addEventListener("submit", async (e) => {
      e.preventDefault();
      const w = root.querySelector('input[name="w"]:checked')?.value || "";
      const repos = root.querySelector("#repos").value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      const out = root.querySelector("#saved");
      out.innerHTML = `<p>Saving…</p>`;
      try {
        const r = await saveMe({ never: w === "never", yes: w === "yes", neverRepos: repos });
        render(r.word);
        root.querySelector("#saved").innerHTML = `<p>Saved. It is public from now on.</p>`;
      } catch (err) {
        out.innerHTML = `<p class="err">${esc(err.message)}</p>`;
      }
    });
  };
  render(state.word);
}
