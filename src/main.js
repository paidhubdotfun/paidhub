// The shell: the file tree on the left and a tiny router. Each page renders into <main> and may return a cleanup.
import "@fontsource/pixelify-sans/700.css";
import "./app.css";
import { $, $$ } from "./ui.js";
import { watchErrors } from "./report.js";
import home from "./pages/home.js";
import unclaimed from "./pages/unclaimed.js";
import person from "./pages/person.js";
import coin from "./pages/coin.js";
import launch from "./pages/launch.js";
import scout from "./pages/scout.js";
import developers from "./pages/developers.js";
import docs from "./pages/docs.js";

watchErrors();

const PAGES = { "/": ["coins", home], "/unclaimed": ["unclaimed", unclaimed], "/launch": ["launch", launch], "/scout": ["scout", scout], "/developers": ["developers", developers], "/docs": ["docs", docs] };

function route(path) {
  if (PAGES[path]) return PAGES[path];
  let m = path.match(/^\/@([A-Za-z0-9-]{1,39})$/);
  if (m) return ["unclaimed", (root) => person(root, m[1])];
  m = path.match(/^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  if (m) return ["coins", (root) => coin(root, m[1], m[2])];
  return [
    "",
    (root) => {
      root.innerHTML = `<div class="page"><section class="panel" style="max-width:620px"><p class="label dim">404.md</p><h1>No file here</h1><p class="lede" style="margin:12px 0 20px">This page does not exist. A repo's coin lives at paidhub.io/owner/repo, a person at paidhub.io/@login.</p><div class="row"><a class="btn btn--black" href="/">Back to the coins</a><a class="btn" href="/unclaimed">Who is owed</a></div></section></div>`;
    },
  ];
}

let cleanup = null;
async function render() {
  try {
    cleanup?.();
  } catch {}
  cleanup = null;
  const main = $("#main");
  const path = decodeURIComponent(location.pathname.replace(/\/+$/, "")) || "/";
  const [section, page] = route(path);
  for (const a of $$("#nav a")) {
    if (a.dataset.page === section) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  document.body.dataset.route = path === "/" ? "home" : "";
  main.innerHTML = "";
  // each page renders into its own box: work a page finishes after the visitor moved on lands in a detached
  // box instead of looking for its elements on the next page
  const view = document.createElement("div");
  main.append(view);
  cleanup = (await page(view)) || null;
  const title = main.querySelector("h1")?.textContent?.trim();
  document.title = path === "/" || !title ? "paidhub: coins for GitHub repos that pay the people who wrote the code" : `${title} · paidhub`;
}

// same-origin links move without a reload
document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || a.target || a.hasAttribute("download") || url.pathname.startsWith("/api/")) return;
  if (url.pathname === location.pathname && url.hash) return;
  e.preventDefault();
  history.pushState(null, "", url.pathname + url.search);
  render().then(() => {
    window.scrollTo(0, 0);
    $("#main").focus({ preventScroll: true });
  });
});
window.addEventListener("popstate", render);
// pages move with go() in ui.js, which pushes the url and asks for a render
window.addEventListener("paidhub:go", () => render().then(() => window.scrollTo(0, 0)));

render();
