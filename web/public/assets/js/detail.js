import { api, el, formatBytes, formatDate, formatPrice, getMe, icon, installLink, notice, statusBadge } from "./common.js";

const root = document.querySelector("[data-detail]");
const id = decodeURIComponent(location.pathname.split("/").filter(Boolean)[2] || "");
const params = new URLSearchParams(location.search);

function stage(w) {
  const box = el("div", { class: "stage" });
  box.style.backgroundImage = `url("${w.thumbUrl}")`; // poster while the live preview boots (CSSOM, CSP-safe)
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const poster = el("img", { src: w.thumbUrl, alt: `ภาพปกของ ${w.title}` });
  if (reduce) {
    box.append(poster);
    const play = el("button", { class: "btn small", type: "button" }, "เล่นตัวอย่างสด");
    play.addEventListener("click", () => {
      box.replaceChildren(frame(w));
      play.remove();
    });
    return { box, extra: play };
  }
  box.append(frame(w));
  return { box, extra: null };
}

function frame(w) {
  // Untrusted HTML: sandboxed without allow-same-origin, served from /preview with a sandbox CSP.
  return el("iframe", {
    src: `/preview/${encodeURIComponent(w.id)}`,
    sandbox: "allow-scripts",
    title: `ตัวอย่างสดของ ${w.title} ขยับเมาส์บนภาพเพื่อลอง`,
    referrerpolicy: "no-referrer",
  });
}

async function render() {
  let w;
  try {
    w = await api(`/api/wallpapers/${encodeURIComponent(id)}`);
  } catch (e) {
    root.replaceChildren(
      el("section", { class: "panel center-panel" }, el("h1", {}, e.status === 404 ? "ไม่พบวอลเปเปอร์นี้" : "โหลดไม่สำเร็จ"), el("p", { class: "lede" }, e.status === 404 ? "อาจถูกนำออกจากร้าน หรือยังรอการตรวจอยู่" : e.message), el("div", { class: "actions" }, el("a", { class: "btn primary", href: "/community" }, "กลับไปที่ร้าน"))),
    );
    return;
  }
  document.title = `${w.title} | MacWallpaperPro`;
  const me = await getMe();
  const isFree = w.priceCents === 0;
  const canInstall = isFree || w.owned;

  const msgs = el("div");
  if (params.get("purchase") === "success") msgs.append(notice("ok", "ชำระเงินเรียบร้อย ระบบกำลังยืนยันกับ Stripe ถ้าปุ่มติดตั้งยังไม่ขึ้น รอสักครู่แล้วรีเฟรช"));
  if (params.get("purchase") === "cancelled") msgs.append(notice("warn", "ยกเลิกการชำระเงินแล้ว ยังไม่มีการตัดเงิน"));
  if (w.status !== "approved") msgs.append(notice(w.status === "rejected" ? "error" : "warn", w.status === "pending" ? "ชิ้นนี้ยังรอการตรวจ มีแค่คุณและทีมงานที่เห็นหน้านี้" : "ชิ้นนี้ไม่ผ่านการตรวจ ดูเหตุผลได้ที่หน้า วอลเปเปอร์ของฉัน"));

  const actions = el("div", { class: "actions" });
  if (canInstall) {
    const a = el("a", { class: "btn primary", href: installLink(w.id) }, icon("app"), "ใช้ใน MacWallpaperPro");
    actions.append(a, el("p", { class: "small dim" }, "ยังไม่มีแอป ", el("a", { href: "/download" }, "ดาวน์โหลดที่นี่")));
  } else {
    const buy = el("button", { class: "btn primary", type: "button" }, icon("cart"), `ซื้อ ${formatPrice(w.priceCents)}`);
    const err = el("div", { "aria-live": "polite" });
    buy.addEventListener("click", async () => {
      if (!me) {
        location.href = `/community/login?next=${encodeURIComponent(location.pathname)}`;
        return;
      }
      buy.disabled = true;
      err.replaceChildren();
      try {
        const { url } = await api(`/api/wallpapers/${encodeURIComponent(w.id)}/checkout`, { method: "POST" });
        location.href = url;
      } catch (e) {
        err.replaceChildren(notice("error", e.message));
        buy.disabled = false;
      }
    });
    actions.append(buy, el("a", { class: "btn ghost", href: installLink(w.id) }, "เปิดในแอป"), err, el("p", { class: "small dim" }, "จ่ายผ่าน Stripe หลังจ่ายแล้วติดตั้งได้ทั้งบนเว็บนี้และในแอป"));
  }

  const { box, extra } = stage(w);
  const full = el("button", { class: "btn ghost small", type: "button" }, icon("expand"), "เต็มจอ");
  full.addEventListener("click", () => box.requestFullscreen?.());

  const tags = w.tags.length ? el("dd", {}, w.tags.map((t) => el("a", { class: "chip", href: `/community?tag=${encodeURIComponent(t)}` }, `#${t}`))) : el("dd", {}, "-");

  root.replaceChildren(
    msgs,
    el(
      "div",
      { class: "detail" },
      el("div", {}, box, el("div", { class: "stage-tools" }, el("span", {}, "ตัวอย่างนี้รันในแซนด์บ็อกซ์ ขยับเมาส์หรือคลิกบนภาพได้เลย"), extra || full)),
      el(
        "aside",
        { class: "side", "aria-label": "รายละเอียด" },
        w.status !== "approved" ? statusBadge(w.status) : null,
        el("h1", {}, w.title),
        el("p", { class: "by" }, `โดย ${w.author.name}`),
        el("p", { class: "big-price" }, formatPrice(w.priceCents)),
        w.owned && !isFree ? el("p", { class: "small muted" }, "คุณเป็นเจ้าของชิ้นนี้แล้ว") : null,
        actions,
        el(
          "dl",
          { class: "facts" },
          el("dt", {}, "ดาวน์โหลด"), el("dd", {}, String(w.downloads)),
          el("dt", {}, "ขนาด"), el("dd", {}, formatBytes(w.sizeBytes)),
          el("dt", {}, "เวอร์ชัน"), el("dd", {}, String(w.version)),
          el("dt", {}, "เผยแพร่"), el("dd", {}, formatDate(w.createdAt)),
          el("dt", {}, "แท็ก"), tags,
          el("dt", {}, "SHA-256"), el("dd", { class: "mono small", title: "แอปตรวจค่านี้ก่อนติดตั้ง" }, w.sha256),
        ),
      ),
    ),
    w.description ? el("div", {}, el("h2", { class: "sr-only" }, "คำอธิบาย"), el("p", { class: "desc" }, w.description)) : null,
  );
}
render();
