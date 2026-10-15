// Unclaimed: every GitHub account pump.fun routes creator fees to, biggest wait first, read off the chain
// hourly by the keeper. Accounts of organisations are marked: pump cannot pay them, the SOL is stuck for good.
import { esc, sol, int, ago, px, avatar, go } from "../ui.js";
import { board } from "../api.js";

function row(a, i) {
  const org = a.type === "Organization";
  const icon = org ? px("file-stuck", 1, "", "stuck") : a.claimed > 0 ? px("file-paid", 1, "", "has claimed before") : px("file-waiting", 1, "", "never claimed");
  const who = a.login
    ? org
      ? `<span>${esc(a.login)}</span> <span class="tag">organisation · stuck</span>`
      : `<a href="/@${esc(a.login)}">@${esc(a.login)}</a>`
    : `<span class="dim">GitHub id ${esc(a.id)}${a.gone ? " (account gone)" : ""}</span>`;
  return `<tr>
    <td class="num dim">${i + 1}</td>
    <td><div class="who">${icon}${a.login ? avatar(a.avatar) : ""}${who}</div></td>
    <td class="r num"><b>${sol(a.waiting)}</b></td>
    <td class="r num hide-s">${a.claimed ? sol(a.claimed) : `<span class="dim">never</span>`}</td>
    <td class="r hide-s dim">${a.lastClaimed ? ago(a.lastClaimed) : ""}</td>
  </tr>`;
}

export default async function unclaimed(root) {
  root.innerHTML = `
  <div class="page">
    <section>
      <p class="label dim">unclaimed.md</p>
      <h1>Unclaimed</h1>
      <p class="lede" style="margin-top:12px">Every GitHub account pump.fun sends creator fees to, read straight off the chain every hour. The SOL waits in pump's account for that person until they sign in on pump.fun with GitHub and claim it. Nobody else can take it, paidhub included.</p>
    </section>
    <section class="totals" id="totals" aria-label="Totals">
      <div class="panel"><span class="label dim">waiting</span><b id="t-wait">…</b></div>
      <div class="panel"><span class="label dim">accounts with fees</span><b id="t-acc">…</b></div>
      <div class="panel"><span class="label dim">never claimed once</span><b id="t-never">…</b></div>
    </section>
    <section aria-labelledby="look">
      <h2 id="look" style="margin-bottom:14px">Is anything waiting for you?</h2>
      <form class="search" id="find" role="search">
        <label class="sr" for="login">GitHub login</label>
        <input class="well" id="login" placeholder="@github-login" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <button class="btn btn--black" type="submit">${px("lens", 1)} Look up</button>
      </form>
    </section>
    <section aria-labelledby="top">
      <div class="section-head"><h2 id="top">The biggest waits</h2><span class="dim" id="fresh"></span></div>
      <div id="table"><p class="empty">Loading the board…</p></div>
    </section>
  </div>`;

  root.querySelector("#find").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = root.querySelector("#login").value.trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//, "").split("/")[0];
    if (v) go(`/@${v}`);
  });

  try {
    const { data } = await board();
    if (!data) {
      root.querySelector("#table").innerHTML = `<p class="empty">The keeper reads every GitHub fee account on pump.fun once an hour. The first board lands soon.</p>`;
      for (const id of ["t-wait", "t-acc", "t-never"]) root.querySelector(`#${id}`).textContent = "soon";
      return;
    }
    const t = data.totals;
    root.querySelector("#t-wait").textContent = sol(t.waiting);
    root.querySelector("#t-acc").textContent = int(t.accounts);
    root.querySelector("#t-never").textContent = int(t.neverClaimed);
    root.querySelector("#fresh").textContent = `top ${data.top.length} · read ${ago(data.updatedAt)}`;
    root.querySelector("#table").innerHTML = `<table class="board">
      <thead><tr><th>#</th><th>account</th><th class="r">waiting</th><th class="r hide-s">claimed ever</th><th class="r hide-s">last claim</th></tr></thead>
      <tbody>${data.top.map(row).join("")}</tbody>
    </table>`;
  } catch (e) {
    root.querySelector("#table").innerHTML = `<p class="empty">The board could not load: ${esc(e.message)}</p>`;
  }
}
