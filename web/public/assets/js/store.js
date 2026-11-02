import { api, card, el, emptyState, icon, skeletonCards } from "./common.js";

document.querySelectorAll("[data-ico]").forEach((s) => s.replaceWith(icon(s.dataset.ico)));

const grid = document.querySelector("[data-grid]");
const more = document.querySelector("[data-more]");
const tagsBox = document.querySelector("[data-tags]");
const countEl = document.querySelector("[data-count]");
const qInput = document.querySelector("#q");
const sortBtns = [...document.querySelectorAll("[data-sort]")];

const params = new URLSearchParams(location.search);
const state = {
  sort: params.get("sort") === "popular" ? "popular" : "new",
  q: params.get("q") || "",
  tag: params.get("tag") || "",
  next: null,
};
qInput.value = state.q;
const knownTags = new Set();

function syncUrl() {
  const p = new URLSearchParams();
  if (state.sort !== "new") p.set("sort", state.sort);
  if (state.q) p.set("q", state.q);
  if (state.tag) p.set("tag", state.tag);
  history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
}

function renderSort() {
  sortBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
}

function renderTags() {
  const tags = [...knownTags].slice(0, 16);
  if (state.tag && !knownTags.has(state.tag)) tags.unshift(state.tag);
  tagsBox.replaceChildren(
    el("button", { type: "button", class: "chip", "aria-pressed": String(!state.tag), onclick: () => setTag("") }, "ทั้งหมด"),
    ...tags.map((t) => el("button", { type: "button", class: "chip", "aria-pressed": String(state.tag === t), onclick: () => setTag(t) }, `#${t}`)),
  );
}

function setTag(t) {
  state.tag = t;
  load(true);
}

let seq = 0;
async function load(reset) {
  const my = ++seq;
  if (reset) {
    state.next = null;
    grid.replaceChildren(...skeletonCards(6));
    grid.setAttribute("aria-busy", "true");
    syncUrl();
    renderSort();
    renderTags();
  }
  const p = new URLSearchParams({ sort: state.sort });
  if (state.q) p.set("q", state.q);
  if (state.tag) p.set("tag", state.tag);
  if (!reset && state.next) p.set("cursor", state.next);
  try {
    const { items, next } = await api(`/api/wallpapers?${p}`);
    if (my !== seq) return;
    items.forEach((w) => w.tags.forEach((t) => knownTags.add(t)));
    if (reset) grid.replaceChildren();
    if (reset && !items.length) {
      grid.replaceChildren(
        emptyState(
          "search",
          state.q || state.tag ? "ไม่พบวอลเปเปอร์ที่ตรงกับการค้นหา ลองคำอื่นหรือล้างตัวกรอง" : "ยังไม่มีวอลเปเปอร์ในร้าน",
          state.q || state.tag
            ? el("button", { class: "btn small", type: "button", onclick: () => { state.q = ""; state.tag = ""; qInput.value = ""; load(true); } }, "ล้างตัวกรอง")
            : el("a", { class: "btn small", href: "/community/upload" }, "อัปโหลดชิ้นแรก"),
        ),
      );
    }
    grid.append(...items.map(card));
    state.next = next;
    more.classList.toggle("hidden", !next);
    countEl.textContent = `แสดง ${grid.querySelectorAll(".card").length} รายการ`;
    renderTags();
  } catch (e) {
    if (my !== seq) return;
    grid.replaceChildren(el("div", { class: "notice error", role: "alert" }, el("p", {}, e.message)));
  } finally {
    grid.removeAttribute("aria-busy");
  }
}

sortBtns.forEach((b) =>
  b.addEventListener("click", () => {
    if (state.sort === b.dataset.sort) return;
    state.sort = b.dataset.sort;
    load(true);
  }),
);
let t;
qInput.addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(() => {
    state.q = qInput.value.trim();
    load(true);
  }, 280);
});
document.querySelector("[data-search]").addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(t);
  state.q = qInput.value.trim();
  load(true);
});
more.addEventListener("click", () => load(false));

load(true);
