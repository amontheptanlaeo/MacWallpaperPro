import { api, el, emptyState, formatPrice, num, requireMe, statusBadge } from "./common.js";

const list = document.querySelector("[data-list]");
await requireMe();
try {
  const items = await api("/api/me/wallpapers");
  if (!items.length) {
    list.replaceChildren(emptyState("upload", "คุณยังไม่ได้อัปโหลดวอลเปเปอร์", el("a", { class: "btn small", href: "/community/upload" }, "อัปโหลดชิ้นแรก")));
  } else {
    list.replaceChildren(
      ...items.map((w) =>
        el(
          "article",
          { class: "row" },
          el("img", { src: w.thumbUrl, alt: "", loading: "lazy" }),
          el(
            "div",
            { class: "minw0" },
            el("h3", {}, w.title),
            el("p", { class: "small muted" }, statusBadge(w.status), "  ", formatPrice(w.priceCents), "  ", `ดาวน์โหลด ${num.format(w.downloads)}`),
            w.status === "rejected" && w.rejectReason ? el("p", { class: "small" }, `เหตุผล: ${w.rejectReason}`) : null,
          ),
          el("div", { class: "row-actions" }, el("a", { class: "btn small", href: `/community/w/${w.id}` }, w.status === "approved" ? "ดูในร้าน" : "ดูตัวอย่าง")),
        ),
      ),
    );
  }
} catch (e) {
  list.replaceChildren(el("div", { class: "notice error", role: "alert" }, el("p", {}, e.message)));
}
