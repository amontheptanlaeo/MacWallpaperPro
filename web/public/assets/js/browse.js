// Community browse: instant filters (search, sort, category), infinite scroll with a "Load more"
// fallback. The first page is server-rendered; this only takes over after load.
import { api, renderCard, t } from "./site.js";

const FIRST_ROWS = 8;
const gallery = document.querySelector("[data-gallery]");
const form = document.querySelector("[data-filters]");
const chips = document.querySelector("[data-chips]");
const gridA = gallery?.querySelector("[data-grid-a]");
const gridB = gallery?.querySelector("[data-grid-b]");
const more = gallery?.querySelector("[data-more]");
const end = gallery?.querySelector("[data-end]");
const empty = gallery?.querySelector("[data-empty]");
const errorEl = gallery?.querySelector("[data-error]");
const sentinel = gallery?.querySelector("[data-sentinel]");
const h1 = document.querySelector(".pagehead h1");

const state = (() => {
  const p = new URLSearchParams(location.search);
  return {
    q: p.get("q") || "",
    sort: p.get("sort") === "popular" ? "popular" : "new",
    category: p.get("category") || "all",
    next: gallery?.dataset.next || null,
    count: (gridA?.children.length || 0) + (gridB?.children.length || 0),
    loading: false,
    seq: 0,
  };
})();

function query(cursor) {
  const p = new URLSearchParams({ sort: state.sort });
  if (state.q) p.set("q", state.q);
  if (state.category !== "all") p.set("category", state.category);
  if (cursor) p.set("cursor", cursor);
  return p;
}

function syncUrl() {
  const p = query(null);
  if (p.get("sort") === "new") p.delete("sort");
  const qs = p.toString();
  history.replaceState(null, "", `/community${qs ? "?" + qs : ""}`);
  for (const a of chips?.querySelectorAll("[data-category]") || []) {
    const on = a.dataset.category === state.category;
    if (on) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
    const cp = query(null);
    cp.delete("sort");
    if (state.sort === "popular") cp.set("sort", "popular");
    if (a.dataset.category === "all") cp.delete("category");
    else cp.set("category", a.dataset.category);
    const s = cp.toString();
    a.href = `/community${s ? "?" + s : ""}`;
  }
  if (h1) h1.textContent = state.category === "all" ? t("browse.title") : t(`cat.${state.category}`);
  const hidden = form?.querySelector('input[name="category"]');
  if (hidden) hidden.value = state.category === "all" ? "" : state.category;
}

function setFoot() {
  more.hidden = !state.next;
  end.hidden = !!state.next || state.count === 0;
  empty.hidden = state.count > 0;
}

function append(items) {
  for (const w of items) {
    const target = state.count < FIRST_ROWS ? gridA : gridB;
    target.insertAdjacentHTML("beforeend", renderCard(w));
    state.count++;
  }
}

async function load({ reset }) {
  if (state.loading && !reset) return;
  const seq = ++state.seq;
  state.loading = true;
  gallery.setAttribute("aria-busy", "true");
  errorEl.hidden = true;
  try {
    const res = await api(`/api/wallpapers?${query(reset ? null : state.next)}`);
    if (seq !== state.seq) return; // a newer filter change won
    if (reset) {
      gridA.innerHTML = "";
      gridB.innerHTML = "";
      state.count = 0;
    }
    append(res.items || []);
    state.next = res.next || null;
  } catch {
    if (seq === state.seq) errorEl.hidden = false;
  } finally {
    if (seq === state.seq) {
      state.loading = false;
      gallery.setAttribute("aria-busy", "false");
      setFoot();
    }
  }
}

function refilter() {
  syncUrl();
  load({ reset: true });
}

if (gallery && form) {
  let debounce = 0;
  const qInput = form.querySelector('input[name="q"]');
  qInput?.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = qInput.value.trim().slice(0, 100);
      refilter();
    }, 320);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(debounce);
    state.q = (qInput?.value || "").trim().slice(0, 100);
    refilter();
  });
  form.querySelector("[data-sort]")?.addEventListener("change", (e) => {
    state.sort = e.target.value === "popular" ? "popular" : "new";
    refilter();
  });
  chips?.addEventListener("click", (e) => {
    const a = e.target.closest("[data-category]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    state.category = a.dataset.category;
    refilter();
  });
  more?.addEventListener("click", () => load({ reset: false }));
  gallery.querySelector("[data-retry]")?.addEventListener("click", () => load({ reset: state.count === 0 }));
  if (sentinel && "IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && state.next && !state.loading) load({ reset: false });
    }, { rootMargin: "600px 0px" }).observe(sentinel);
  }
  setFoot();
}
