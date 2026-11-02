import { api, el, icon, notice, requireMe } from "./common.js";

const MAX_HTML = 10 * 1024 * 1024;
const MAX_THUMB = 2 * 1024 * 1024;
const form = document.querySelector("[data-upload]");
const msg = document.querySelector("[data-msg]");
const preview = document.querySelector("[data-thumb-preview]");
const priceHint = document.querySelector("[data-price-hint]");
document.querySelectorAll("[data-ico]").forEach((b) => b.prepend(icon(b.dataset.ico)));

const me = await requireMe();
if (!me.creator.payoutsEnabled) {
  priceHint.textContent = "0 = ฟรี ของที่ขายต้องราคาอย่างน้อย 20 บาท และต้องผูกบัญชีรับเงินก่อนจึงจะขายได้จริง";
  priceHint.append(" ", el("a", { href: "/community/earnings" }, "ผูกบัญชีรับเงิน"));
}

async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const webp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return png || jpg || webp;
}

form.thumb.addEventListener("change", () => {
  const f = form.thumb.files[0];
  if (!f) return preview.classList.add("hidden");
  preview.src = URL.createObjectURL(f);
  preview.classList.remove("hidden");
});

function fail(input, text) {
  if (input) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
  msg.replaceChildren(notice("error", text));
  return false;
}

async function check() {
  form.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
  if (!form.title.value.trim()) return fail(form.title, "ตั้งชื่อวอลเปเปอร์ก่อน");
  const baht = Number(form.price.value || 0);
  if (!Number.isInteger(baht) || baht < 0) return fail(form.price, "ราคาต้องเป็นจำนวนเต็มบาท");
  if (baht > 0 && baht < 20) return fail(form.price, "ของที่ขายต้องราคาอย่างน้อย 20 บาท หรือใส่ 0 เพื่อแจกฟรี");
  if (baht > 10000) return fail(form.price, "ราคาสูงสุด 10,000 บาท");
  const tags = form.tags.value.split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length > 8) return fail(form.tags, "ใส่แท็กได้ไม่เกิน 8 แท็ก");
  if (tags.some((t) => t.length > 24)) return fail(form.tags, "แท็กยาวได้ไม่เกิน 24 ตัวอักษร");
  const file = form.file.files[0];
  if (!file) return fail(form.file, "เลือกไฟล์ index.html");
  if (file.size > MAX_HTML) return fail(form.file, "index.html ต้องไม่เกิน 10 MB");
  const head = await file.slice(0, Math.min(file.size, 1024 * 1024)).text();
  if (!/<html[\s>]/i.test(head) && !/<html[\s>]/i.test(await file.text())) return fail(form.file, "ไฟล์นี้ไม่มีแท็ก <html> จึงไม่ใช่ wallpaper ที่ใช้ได้");
  const thumb = form.thumb.files[0];
  if (!thumb) return fail(form.thumb, "เลือกภาพปก");
  if (thumb.size > MAX_THUMB) return fail(form.thumb, "ภาพปกต้องไม่เกิน 2 MB");
  if (!(await sniff(thumb))) return fail(form.thumb, "ภาพปกต้องเป็นไฟล์ PNG, JPEG หรือ WebP");
  return true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.replaceChildren();
  if (!(await check())) return;
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.lastChild.textContent = "กำลังอัปโหลด…";
  const fd = new FormData();
  fd.set("title", form.title.value);
  fd.set("description", form.description.value);
  fd.set("tags", form.tags.value);
  fd.set("price_cents", String(Number(form.price.value || 0) * 100));
  fd.set("file", form.file.files[0], "index.html");
  fd.set("thumb", form.thumb.files[0]);
  try {
    const { id } = await api("/api/wallpapers", { method: "POST", form: fd });
    form.replaceWith(
      el(
        "section",
        { class: "panel center-panel" },
        el("h2", {}, "ส่งให้ทีมตรวจแล้ว"),
        el("p", { class: "lede" }, "เราจะตรวจความปลอดภัยและคุณภาพก่อนขึ้นร้าน ระหว่างนี้ดูตัวอย่างของคุณได้ (เห็นเฉพาะคุณ)"),
        el("div", { class: "actions" }, el("a", { class: "btn primary", href: `/community/w/${id}` }, "ดูตัวอย่าง"), el("a", { class: "btn ghost", href: "/community/mine" }, "วอลเปเปอร์ของฉัน")),
      ),
    );
    msg.replaceChildren();
  } catch (err) {
    msg.replaceChildren(notice("error", err.message));
    btn.disabled = false;
    btn.lastChild.textContent = "ส่งให้ทีมตรวจ";
  }
});
