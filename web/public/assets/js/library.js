import { api, el, emptyState, formatPrice, icon, installLink, requireMe } from "./common.js";

const list = document.querySelector("[data-list]");
await requireMe();
try {
  const items = await api("/api/me/library");
  if (!items.length) {
    list.replaceChildren(emptyState("image", "คลังยังว่างอยู่ ของที่ซื้อและของฟรีที่ดาวน์โหลดจะมาอยู่ที่นี่", el("a", { class: "btn small", href: "/community" }, "เลือกวอลเปเปอร์")));
  } else {
    list.replaceChildren(
      ...items.map((w) =>
        el(
          "article",
          { class: "row" },
          el("img", { src: w.thumbUrl, alt: "", loading: "lazy" }),
          el("div", { class: "minw0" }, el("h3", {}, el("a", { href: `/community/w/${w.id}` }, w.title)), el("p", { class: "small muted" }, `โดย ${w.author.name}  ${w.priceCents ? "ซื้อแล้ว" : formatPrice(0)}`)),
          el("div", { class: "row-actions" }, el("a", { class: "btn small primary", href: installLink(w.id) }, icon("app"), "ใช้ใน MacWallpaperPro")),
        ),
      ),
    );
  }
} catch (e) {
  list.replaceChildren(el("div", { class: "notice error", role: "alert" }, el("p", {}, e.message)));
}
