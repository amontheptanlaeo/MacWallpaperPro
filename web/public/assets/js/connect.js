import { api, el, formatDate, notice } from "./common.js";

const box = document.querySelector("[data-devices]");
async function load() {
  try {
    const { items } = await api("/api/me/tokens");
    if (!items.length) {
      box.replaceChildren(el("p", { class: "muted" }, "ยังไม่มีอุปกรณ์ที่เชื่อมอยู่"));
      return;
    }
    box.replaceChildren(
      ...items.map((t) => {
        const btn = el("button", { class: "btn danger small", type: "button" }, "ยกเลิกสิทธิ์");
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await api(`/api/me/tokens/${t.id}/revoke`, { method: "POST" });
            load();
          } catch (e) {
            box.prepend(notice("error", e.message));
            btn.disabled = false;
          }
        });
        return el("div", { class: "device" }, el("div", {}, el("strong", {}, t.label), el("div", { class: "small muted" }, `เชื่อมเมื่อ ${formatDate(t.createdAt)}  หมดอายุ ${formatDate(t.expiresAt)}`)), btn);
      }),
    );
  } catch (e) {
    box.replaceChildren(notice("error", e.message));
  }
}
load();
