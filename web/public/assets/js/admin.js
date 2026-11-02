import { api, el, formatBytes, formatDate, formatPrice, notice, requireMe } from "./common.js";

const root = document.querySelector("[data-queue]");
const msg = document.querySelector("[data-msg]");
const me = await requireMe();
const SEV = { high: "เสี่ยงสูง", medium: "ควรดู", low: "ข้อมูล" };

if (me.role !== "admin") {
  root.replaceChildren(notice("error", "หน้านี้สำหรับผู้ดูแลระบบเท่านั้น"));
} else {
  load();
}

async function load() {
  try {
    const { items } = await api("/api/admin/queue");
    if (!items.length) {
      root.replaceChildren(el("div", { class: "empty" }, el("p", {}, "ไม่มีงานรอตรวจ")));
      return;
    }
    root.replaceChildren(...items.map(item));
  } catch (e) {
    root.replaceChildren(notice("error", e.message));
  }
}

function item(w) {
  const frameBox = el("div", { class: "stage" }, el("img", { src: w.thumbUrl, alt: `ภาพปกของ ${w.title}` }));
  const play = el("button", { class: "btn small", type: "button" }, "รันตัวอย่างในแซนด์บ็อกซ์");
  play.addEventListener("click", () => {
    frameBox.replaceChildren(el("iframe", { src: w.previewUrl, sandbox: "allow-scripts", title: `ตัวอย่าง ${w.title}`, referrerpolicy: "no-referrer" }));
    play.remove();
  });

  const flags = w.scan.length
    ? el(
        "ul",
        { class: "flags" },
        w.scan.map((f) =>
          el("li", { class: `flag ${f.severity}` }, el("strong", {}, `${SEV[f.severity] || f.severity}: ${f.label}`), ` (${f.count} จุด)`, ...f.samples.map((s) => el("code", {}, `บรรทัด ${s.line}: ${s.excerpt}`))),
        ),
      )
    : el("p", { class: "small", role: "note" }, el("span", { class: "badge approved" }, "สแกนไม่พบรูปแบบที่น่าสงสัย"));

  const reason = el("input", { type: "text", name: "reason", maxlength: "500", placeholder: "เหตุผลที่ไม่อนุมัติ (ผู้สร้างจะเห็นข้อความนี้)", "aria-label": `เหตุผลที่ไม่อนุมัติ ${w.title}` });
  const approve = el("button", { class: "btn primary small", type: "button" }, "อนุมัติขึ้นร้าน");
  const reject = el("button", { class: "btn danger small", type: "submit" }, "ไม่อนุมัติ");
  const card = el(
    "article",
    { class: "qitem", "aria-label": w.title },
    el("div", {}, frameBox, el("div", { class: "stage-tools" }, el("span", {}, "iframe sandbox ไม่มี allow-same-origin"), play)),
    el(
      "div",
      {},
      el("h2", {}, w.title),
      el("p", { class: "muted small" }, `${w.author.name} (${w.authorEmail})  ${formatPrice(w.priceCents)}  ${formatBytes(w.sizeBytes)}  ส่งเมื่อ ${formatDate(w.createdAt)}`),
      w.description ? el("p", { class: "small desc" }, w.description) : null,
      el("h3", {}, "ผลสแกน"),
      flags,
      el("div", { class: "actions" }, approve),
      el("form", { class: "reject-form" }, reason, reject),
    ),
  );
  approve.addEventListener("click", () => act(card, w, "approve"));
  card.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!reason.value.trim()) {
      reason.setAttribute("aria-invalid", "true");
      reason.focus();
      return;
    }
    act(card, w, "reject", reason.value.trim());
  });
  return card;
}

async function act(card, w, action, reason) {
  card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await api(`/api/admin/wallpapers/${encodeURIComponent(w.id)}/${action}`, { method: "POST", body: action === "reject" ? { reason } : {} });
    msg.replaceChildren(notice("ok", action === "approve" ? `อนุมัติ "${w.title}" แล้ว ขึ้นร้านเรียบร้อย` : `ไม่อนุมัติ "${w.title}" แล้ว`));
    card.remove();
    if (!root.children.length) load();
  } catch (e) {
    msg.replaceChildren(notice("error", e.message));
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
