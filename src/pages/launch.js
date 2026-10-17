// Launch: paste a repo, see exactly who gets paid, name the coin, sign the coin and then its fee split.
// The server checks the repo and the people again and builds everything; the wallet only signs.
import { CONFIG, esc, px, avatar, go } from "../ui.js";
import { repo as repoCheck, api } from "../api.js";
import { available, connect, connected, signAll } from "../wallet.js";
import { report } from "../report.js";
import { LAUNCH, checkLaunch, parseRepo } from "../../shared/rules.js";

const MAX_IMAGE = 1_500_000;

export default async function launchPage(root) {
  const params = new URLSearchParams(location.search);
  const open = CONFIG.LAUNCH_OPEN;
  root.innerHTML = `
  <div class="page" style="max-width:860px">
    <section>
      <p class="label dim">launch.md</p>
      <h1>Launch a coin on a repo</h1>
      <p class="lede" style="margin-top:12px">One coin per repo. Half of its creator fees go to the people who wrote the code, through pump.fun's GitHub fee accounts. You get 10% of the fees for launching it.</p>
      ${open ? "" : `<p class="notice">${px("file-waiting", 1)} Launching opens when the pad goes live. You can already check who any repo would pay.</p>`}
    </section>

    <form class="form panel" id="form" novalidate>
      <div class="field">
        <label class="form-step" for="repo">1 · The repo</label>
        <div class="search" style="width:100%">
          <input class="well" id="repo" name="repo" placeholder="github.com/owner/repo" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(params.get("repo") || "")}" />
          <button class="btn btn--black" type="button" id="check">Check</button>
        </div>
        <div id="people" aria-live="polite"></div>
      </div>

      <fieldset id="coin" disabled style="border:0;padding:0;margin:0;display:grid;gap:18px">
        <legend class="form-step">2 · The coin</legend>
        <div class="two">
          <div class="field"><label for="name">Name (has to contain the repo's name)</label><input class="well" id="name" maxlength="${LAUNCH.nameMax}" /></div>
          <div class="field"><label for="symbol">Ticker</label><input class="well" id="symbol" maxlength="${LAUNCH.symbolMax}" placeholder="letters and digits" autocapitalize="characters" /></div>
        </div>
        <div class="field"><label for="description">Description (optional)</label><textarea class="well" id="description" maxlength="${LAUNCH.descriptionMax}" placeholder="paidhub adds a line saying who the coin pays and that the developers have not endorsed it"></textarea></div>
        <div class="field"><span>Picture (png, jpeg, webp or gif, up to 1.5 MB)</span>
          <div class="picker">
            <input id="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
            <label class="btn" for="image">Choose a picture</label>
            <img class="picker__thumb" id="thumb" alt="" hidden />
            <span class="dim" id="image-name">none chosen</span>
          </div>
        </div>
        <div class="two">
          <div class="field"><label for="twitter">X (optional)</label><input class="well" id="twitter" placeholder="@handle or x.com link" /></div>
          <div class="field"><label for="website">Website (optional)</label><input class="well" id="website" placeholder="its paidhub page" /></div>
        </div>
        <div class="field"><label for="buy">Your first buy, in SOL (${LAUNCH.devBuyMin / 1e9} to ${LAUNCH.devBuyMax / 1e9})</label><input class="well" id="buy" type="number" min="${LAUNCH.devBuyMin / 1e9}" max="${LAUNCH.devBuyMax / 1e9}" step="0.01" value="0.1" inputmode="decimal" /></div>
        <p class="dim" style="font-size:13px">On top of the first buy, the launch costs about 0.035 SOL in rent and network fees (the coin, its fee split, and a pump.fun GitHub account for each developer who does not have one yet).</p>
      </fieldset>

      <div class="field">
        <span class="form-step">3 · Sign</span>
        <div class="row">
          <button class="btn" type="button" id="wallet">${px("wallet", 1)} Connect wallet</button>
          <button class="btn btn--black" type="submit" id="go" ${open ? "" : "disabled"}>Sign and launch</button>
        </div>
        <p class="dim" style="font-size:13px">Your wallet asks twice: first the coin with your first buy, then, once the coin is on chain, its fee split. pump.fun locks the split forever.</p>
      </div>
      <div class="status" id="status" aria-live="polite"></div>
    </form>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const status = (lines, err = false) => {
    $("#status").innerHTML = (Array.isArray(lines) ? lines : [lines]).map((l, i, a) => `<p class="${err && i === a.length - 1 ? "err" : ""}">${l}</p>`).join("");
  };
  let target = null;

  async function check() {
    const v = $("#repo").value.trim();
    target = null;
    $("#coin").disabled = true;
    if (!parseRepo(v)) {
      $("#people").innerHTML = `<p class="dim" style="margin-top:8px">Paste github.com/owner/repo or owner/repo.</p>`;
      return;
    }
    $("#people").innerHTML = `<p class="dim" style="margin-top:8px">Checking ${esc(v)}…</p>`;
    try {
      const r = await repoCheck(v, connected()?.address || "");
      if (r.taken) {
        $("#people").innerHTML = `<p style="margin-top:8px">${esc(r.repo.fullName)} already has its coin. <a href="/${esc(r.repo.fullName)}">Open it</a>.</p>`;
        return;
      }
      if (r.held) {
        $("#people").innerHTML = `<p style="margin-top:8px">Someone is launching ${esc(r.repo.fullName)} right now. Look again in a few minutes.</p>`;
        return;
      }
      target = r;
      $("#people").innerHTML = `
        <p style="margin:10px 0 6px">${esc(r.repo.fullName)} · ${r.repo.stars.toLocaleString("en-US")} stars${r.repo.license ? ` · ${esc(r.repo.license)}` : ""}. Half of every fee goes to:</p>
        <ul class="files">${r.people
          .map((p) => `<li class="file-row" style="grid-template-columns:44px minmax(0,1fr) auto">${px("file-waiting", 2, "state")}<span class="person">${avatar(p.avatar)}<a href="/@${esc(p.login)}" target="_blank" rel="noopener">@${esc(p.login)}</a><span class="dim">${p.why === "owner" ? "owner" : `${p.commits} commits`}</span>${p.yes ? `<span class="tag">is in</span>` : ""}</span><span class="num">${(p.shareBps / 100).toFixed(2)}%</span></li>`)
          .join("")}</ul>`;
      $("#coin").disabled = false;
      if (!$("#name").value) $("#name").value = r.repo.name.slice(0, LAUNCH.nameMax);
    } catch (e) {
      $("#people").innerHTML = `<p class="err" style="margin-top:8px;background:#000;color:var(--yellow);padding:6px 10px">${esc(e.message)}</p>`;
    }
  }

  $("#check").addEventListener("click", check);
  $("#repo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      check();
    }
  });
  if (params.get("repo")) check();

  $("#image").addEventListener("change", () => {
    const f = $("#image").files[0];
    const thumb = $("#thumb");
    if (!f) {
      thumb.hidden = true;
      $("#image-name").textContent = "none chosen";
      return;
    }
    $("#image-name").textContent = f.size > MAX_IMAGE ? `${f.name}: over 1.5 MB, pick a smaller one` : f.name;
    thumb.src = URL.createObjectURL(f);
    thumb.hidden = false;
  });

  function walletLabel() {
    const w = connected();
    $("#wallet").innerHTML = w ? `${px("wallet", 1)} ${esc(w.address.slice(0, 4))}…${esc(w.address.slice(-4))}` : `${px("wallet", 1)} Connect wallet`;
  }
  walletLabel();
  $("#wallet").addEventListener("click", async () => {
    try {
      if (!available().length) {
        status("No Solana wallet in this browser. Phantom, Solflare and Backpack all work.", true);
        return;
      }
      await connect();
      walletLabel();
      status("");
    } catch (e) {
      status(`The wallet did not connect: ${esc(e.message)}`, true);
    }
  });

  const readImage = (file) =>
    new Promise((resolve, reject) => {
      if (!file) return reject(new Error("the coin needs a picture"));
      if (file.size > MAX_IMAGE) return reject(new Error("the picture is over 1.5 MB"));
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("the picture could not be read"));
      fr.readAsDataURL(file);
    });

  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!open) return status("Launching opens when the pad goes live.", true);
    if (!target) return status("Check the repo first.", true);
    const input = { name: $("#name").value, symbol: $("#symbol").value, description: $("#description").value, twitter: $("#twitter").value, website: $("#website").value };
    try {
      checkLaunch(input, target.repo);
    } catch (err) {
      return status(esc(err.message), true);
    }
    const buy = Math.round(Number($("#buy").value) * 1e9);
    if (!(buy >= LAUNCH.devBuyMin && buy <= LAUNCH.devBuyMax)) return status(`The first buy is ${LAUNCH.devBuyMin / 1e9} to ${LAUNCH.devBuyMax / 1e9} SOL.`, true);
    $("#go").disabled = true;
    const log = [];
    const step = (t) => {
      log.push(t);
      status(log);
    };
    try {
      if (!connected()) await connect();
      walletLabel();
      const image = await readImage($("#image").files[0]);
      step("Building the coin and its fee split…");
      const built = await api("/api/launch", { method: "POST", body: { ...input, repo: target.repo.fullName, wallet: connected().address, image, devBuyLamports: buy } });
      step(`Built $${esc(built.metadata.symbol)}. Approve the coin with your first buy in your wallet (1 of 2)…`);
      let signed;
      try {
        signed = await signAll(built.transactions);
      } catch (err) {
        report("wallet-refused", { message: err.message });
        throw new Error("the wallet did not sign. Nothing was sent.");
      }
      step("Creating the coin…");
      let sent = await api("/api/send", { method: "POST", body: { mint: built.mint, transactions: signed } });
      if (!sent.onPad) {
        // the split is built and simulated only now that the coin exists, so the wallet can check it
        const split = await api("/api/finish", { method: "POST", body: { mint: built.mint, wallet: connected().address } });
        step(`$${esc(built.metadata.symbol)} is on chain. Approve its fee split in your wallet (2 of 2)…`);
        try {
          signed = await signAll(split.transactions);
        } catch (err) {
          report("wallet-refused", { message: err.message, step: "split" });
          throw new Error(`the wallet did not sign the split. The coin exists; finish it from its page: paidhub.io/${target.repo.fullName}`);
        }
        step("Locking the split…");
        sent = await api("/api/send", { method: "POST", body: { mint: built.mint, transactions: signed } });
      }
      if (!sent.onPad) throw new Error(sent.note);
      step(`Done. $${esc(built.metadata.symbol)} is live and its split is locked. Opening its page…`);
      setTimeout(() => go(`/${target.repo.fullName}`), 1200);
    } catch (err) {
      report("launch", { message: err.message, repo: target?.repo?.fullName || "" });
      log.push(esc(err.message));
      status(log, true);
      $("#go").disabled = false;
    }
  });
}
