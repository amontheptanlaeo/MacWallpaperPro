import { api, card, el, emptyState, icon, skeletonCards } from "./common.js";

const HERO_WALLPAPER = "nebula-flow";

document.querySelectorAll("[data-ico]").forEach((a) => a.prepend(icon(a.dataset.ico)));

// Desktop clock (the app's clock feature, live)
const tEl = document.querySelector("[data-desk-time]");
const dEl = document.querySelector("[data-desk-date]");
const fmtT = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" });
const fmtD = new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long" });
function tick() {
  const now = new Date();
  tEl.textContent = fmtT.format(now);
  dEl.textContent = fmtD.format(now);
}
tick();
setInterval(tick, 10_000);

// Live wallpaper behind the hero. Sandboxed (no allow-same-origin), so it runs in an opaque origin.
async function mountLive() {
  const slot = document.querySelector("[data-live-slot]");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    document.querySelector("[data-hint]")?.remove();
    return; // poster image (CSS background) stays
  }
  try {
    const head = await fetch(`/preview/${HERO_WALLPAPER}`, { method: "HEAD" });
    if (!head.ok) throw new Error("no preview");
  } catch {
    document.querySelector("[data-hint]")?.remove();
    return;
  }
  const frame = el("iframe", {
    class: "desk-live",
    src: `/preview/${HERO_WALLPAPER}`,
    sandbox: "allow-scripts",
    title: "ตัวอย่างวอลเปเปอร์สด Nebula Flow",
    tabindex: "-1",
    "aria-hidden": "true",
    loading: "eager",
    referrerpolicy: "no-referrer",
  });
  slot.replaceWith(frame);
}
mountLive();

async function shelf() {
  const grid = document.querySelector("[data-shelf]");
  grid.replaceChildren(...skeletonCards(4));
  try {
    const { items } = await api("/api/wallpapers?sort=new");
    if (!items.length) {
      grid.replaceWith(emptyState("image", "ยังไม่มีวอลเปเปอร์ในร้าน มาเป็นคนแรกที่อัปโหลดกัน", el("a", { class: "btn small", href: "/community/upload" }, "อัปโหลดวอลเปเปอร์")));
      return;
    }
    grid.replaceChildren(...items.slice(0, 4).map(card));
  } catch {
    grid.replaceChildren(el("p", { class: "muted" }, "โหลดรายการไม่สำเร็จ ลองรีเฟรชหน้านี้"));
  }
}
shelf();
