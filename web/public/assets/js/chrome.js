// Site chrome: the macOS-style menu bar (navigation + live clock + account menu).
import { api, el, getMe, ICONS, icon } from "./common.js";

const LINKS = [
  ["/community", "ร้านชุมชน"],
  ["/community/upload", "อัปโหลด"],
  ["/community/library", "คลังของฉัน"],
  ["/download", "ดาวน์โหลดแอป"],
];

function current(href) {
  const p = location.pathname.replace(/\/$/, "") || "/";
  if (href === "/community") return p === "/community" || p.startsWith("/community/w");
  return p === href;
}

function closeOnOutside(details) {
  document.addEventListener("click", (e) => {
    if (details.open && !details.contains(e.target)) details.open = false;
  });
  details.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && details.open) {
      details.open = false;
      details.querySelector("summary").focus();
    }
  });
}

function clock() {
  const t = el("span", { class: "mb-clock", "aria-hidden": "true" });
  const fmtDate = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short" });
  const fmtTime = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" });
  const tick = () => {
    const now = new Date();
    t.replaceChildren(el("span", { class: "mb-date" }, fmtDate.format(now) + "  "), fmtTime.format(now));
  };
  tick();
  setInterval(tick, 15_000);
  return t;
}

async function render() {
  const bar = document.querySelector("[data-menubar]");
  if (!bar) return;
  bar.setAttribute("aria-label", "เมนูหลัก");

  const brand = el("a", { class: "mb-brand", href: "/", html: ICONS.logo + "<span>MacWallpaperPro</span>" });
  const links = el(
    "nav",
    { class: "mb-links", "aria-label": "เมนูหลัก" },
    LINKS.map(([href, label]) => el("a", { href, "aria-current": current(href) ? "page" : null }, label)),
  );

  const burger = el("details", { class: "mb-burger" });
  burger.append(
    el("summary", { "aria-label": "เปิดเมนู", html: ICONS.menu }),
    el("div", { class: "mb-menu left" }, LINKS.map(([href, label]) => el("a", { href }, label))),
  );
  closeOnOutside(burger);

  const account = el("div", { class: "mb-account" });
  bar.replaceChildren(brand, links, burger, el("span", { class: "mb-spacer" }), account, clock());

  const me = await getMe();
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    account.replaceChildren(el("a", { href: `/community/login?next=${next}` }, "เข้าสู่ระบบ"));
    return;
  }
  const d = el("details");
  const items = [
    el("div", { class: "mb-who" }, me.displayName, el("br"), me.email),
    el("a", { href: "/community/mine" }, "วอลเปเปอร์ของฉัน"),
    el("a", { href: "/community/library" }, "คลังของฉัน"),
    el("a", { href: "/community/earnings" }, "รายได้และบัญชีรับเงิน"),
    el("a", { href: "/app/connect" }, "เชื่อมแอปบน Mac"),
  ];
  if (me.role === "admin") items.push(el("hr"), el("a", { href: "/community/admin" }, "ตรวจงานที่รออนุมัติ"));
  const out = el("button", { type: "button" }, "ออกจากระบบ");
  out.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/";
  });
  items.push(el("hr"), out);
  const summary = el("summary", { "aria-label": `บัญชี ${me.displayName}` }, icon("user"), el("span", {}, me.displayName));
  summary.querySelector("svg").setAttribute("width", "16");
  summary.querySelector("svg").setAttribute("height", "16");
  d.append(summary, el("div", { class: "mb-menu" }, items));
  closeOnOutside(d);
  account.replaceChildren(d);
}

render();
