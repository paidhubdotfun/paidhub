// Small shared pieces: selectors, escaping, numbers, the copy button, the toast, the pixel icons.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const CONFIG = window.SITE_CONFIG || {};

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Lamports as SOL: whole thousands grouped, four decimals under 1 SOL, two above. */
export function sol(lamports, { unit = true } = {}) {
  const v = Number(lamports || 0) / 1e9;
  const digits = v === 0 ? 0 : v < 0.01 ? 4 : v < 1 ? 3 : v < 1000 ? 2 : 0;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit ? `${s} SOL` : s;
}

export const int = (n) => Number(n || 0).toLocaleString("en-US");

export function usd(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function ago(when) {
  const t = typeof when === "number" ? (when < 1e12 ? when * 1000 : when) : Date.parse(when);
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const short = (a, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : "");

export const explorer = (kind, id) => `${(CONFIG.EXPLORER || "https://solscan.io").replace(/\/$/, "")}/${kind}/${id}`;

/** The pixel pieces with their native sizes; `k` is the whole-number scale. */
const PX = {
  file: [12, 15],
  "file-paid": [22, 29],
  "file-stuck": [22, 29],
  "file-never": [22, 29],
  "file-yes": [23, 29],
  "file-waiting": [23, 29],
  jar: [21, 28],
  flame: [21, 28],
  lens: [25, 27],
  wallet: [26, 26],
  folder: [25, 26],
  coin: [20, 20],
};
export function px(name, k = 1, cls = "", alt = "") {
  const [w, h] = PX[name] || [16, 16];
  return `<img class="px ${cls}" src="/px/${name}.png" width="${w * k}" height="${h * k}" alt="${esc(alt)}" />`;
}

let toastTimer = null;
export function toast(text) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2200);
}

/** Copy with honest feedback: the clipboard can refuse (an insecure page, a denied permission). */
export async function copy(text, what = "address") {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
    return true;
  } catch {
    toast(`could not copy: select the ${what} and copy it by hand`);
    return false;
  }
}

export function bindCopy(root) {
  for (const b of $$("[data-copy]", root)) {
    b.addEventListener("click", () => copy(b.dataset.copy, b.dataset.what || "address"));
  }
}

/** Official marks only, never redrawn: pump.fun's logomark, the X logo, the GitHub mark. */
export const MARK = {
  pump: `<img class="mark" src="/mark/pump.svg" alt="" width="20" height="20" />`,
  x: `<img class="mark" src="/mark/x-black.png" alt="" width="20" height="20" />`,
  xWhite: `<img class="mark" src="/mark/x.png" alt="" width="20" height="20" />`,
  github: `<img class="mark" src="/mark/github.svg" alt="" width="20" height="20" />`,
};

export const avatar = (url, cls = "") => (url ? `<img class="avatar ${cls}" src="${esc(url)}${url.includes("?") ? "&" : "?"}s=96" alt="" loading="lazy" width="28" height="28" />` : `<span class="avatar ${cls}"></span>`);

/** The state of one person on one coin, as a pixel file: claimed, said yes, said never, waiting. */
export function personState(p) {
  if (p.claimedAt) return { icon: "file-paid", text: "claimed" };
  if (p.word === "yes") return { icon: "file-yes", text: "is in" };
  if (p.word === "never") return { icon: "file-never", text: "said never" };
  return { icon: "file-waiting", text: "not claimed yet" };
}

export function coinState(c) {
  const people = c.people || [];
  if (people.some((p) => p.claimedAt)) return { icon: "file-paid", text: "a developer claimed" };
  if (people.some((p) => p.word === "yes")) return { icon: "file-yes", text: "a developer is in" };
  if (people.length && people.every((p) => p.word === "never")) return { icon: "file-never", text: "the developers said never" };
  return { icon: "file-waiting", text: "waiting for the developers" };
}

/** Move to another page of the site without a reload. */
export function go(to) {
  history.pushState(null, "", to);
  window.dispatchEvent(new Event("paidhub:go"));
}
