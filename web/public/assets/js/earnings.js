import { api, el, formatDate, formatPrice, notice, num, requireMe } from "./common.js";

const box = document.querySelector("[data-connect]");
const stats = document.querySelector("[data-stats]");
const msg = document.querySelector("[data-msg]");
await requireMe();
const q = new URLSearchParams(location.search);
if (q.get("onboarding") === "done") msg.append(notice("ok", "กลับมาจาก Stripe แล้ว ถ้ากรอกข้อมูลครบ สถานะจะเปลี่ยนเป็นพร้อมรับเงินภายในไม่กี่นาที"));
if (q.get("onboarding") === "refresh") msg.append(notice("warn", "ลิงก์ยืนยันตัวตนหมดอายุ กดปุ่มด้านล่างเพื่อทำต่อ"));

const thb = (c) => (c === 0 ? "฿0" : formatPrice(c));

function table(headers, rows, empty) {
  if (!rows.length) return el("p", { class: "muted" }, empty);
  return el("table", {}, el("thead", {}, el("tr", {}, headers.map(([h, n]) => el("th", { class: n ? "num" : null, scope: "col" }, h)))), el("tbody", {}, rows.map((r) => el("tr", {}, r.map(([v, n]) => el("td", { class: n ? "num" : null }, v))))));
}

try {
  const e = await api("/api/creator/earnings");
  document.querySelector("[data-fee-line]").textContent = `คุณได้ ${100 - e.feePercent}% ของทุกการขาย แพลตฟอร์มหัก ${e.feePercent}% (ค่าธรรมเนียม Stripe รวมอยู่ในส่วนของแพลตฟอร์ม)`;

  const onboardBtn = el("button", { class: "btn violet", type: "button" }, e.creator.connected ? "ทำการยืนยันตัวตนต่อ" : "ผูกบัญชีรับเงินกับ Stripe");
  const err = el("div", { "aria-live": "polite" });
  onboardBtn.addEventListener("click", async () => {
    onboardBtn.disabled = true;
    err.replaceChildren();
    try {
      const { url } = await api("/api/creator/onboard", { method: "POST" });
      location.href = url;
    } catch (x) {
      err.replaceChildren(notice("error", x.message));
      onboardBtn.disabled = false;
    }
  });
  const status = e.creator.payoutsEnabled
    ? [el("p", {}, el("span", { class: "badge approved" }, "พร้อมรับเงิน")), el("p", { class: "muted" }, "เงินจากการขายจะเข้าบัญชี Stripe ของคุณโดยตรง แล้วโอนเข้าธนาคารตามรอบของ Stripe")]
    : e.creator.connected
      ? [el("p", {}, el("span", { class: "badge pending" }, "ยังยืนยันไม่เสร็จ")), el("p", { class: "muted" }, "Stripe ยังต้องการข้อมูลบางอย่างก่อนเปิดรับเงิน งานที่ตั้งราคาไว้จะยังซื้อไม่ได้จนกว่าจะเสร็จ"), el("div", { class: "actions" }, onboardBtn), err]
      : [el("p", { class: "muted" }, "ผูกบัญชีเพื่อขายวอลเปเปอร์ Stripe จะขอข้อมูลยืนยันตัวตนและบัญชีธนาคาร ใช้เวลาราว 5 นาที ของฟรีอัปโหลดได้เลยโดยไม่ต้องผูก"), el("div", { class: "actions" }, onboardBtn), err];
  if (!e.stripeConfigured) onboardBtn.disabled = true;
  if (!e.stripeConfigured && !e.creator.payoutsEnabled) status.unshift(notice("warn", "เซิร์ฟเวอร์นี้ยังไม่ได้เปิดระบบชำระเงิน (ไม่มี STRIPE_SECRET_KEY) จึงยังผูกบัญชีไม่ได้"));
  box.replaceChildren(el("h2", { id: "payout-h" }, "บัญชีรับเงิน"), ...status);

  const t = e.totals;
  stats.replaceChildren(
    ...[["ยอดขาย", num.format(t.salesCount) + " ครั้ง"], ["รายรับรวม", thb(t.grossCents)], ["ค่าธรรมเนียมแพลตฟอร์ม", thb(t.feeCents)], ["ส่วนของคุณ", thb(t.netCents)]].map(([k, v]) =>
      el("div", { class: "stat" }, el("div", { class: "k" }, k), el("div", { class: "v" }, v)),
    ),
  );
  document.querySelector("[data-items]").replaceChildren(
    table(
      [["ชิ้นงาน"], ["ราคา", 1], ["ดาวน์โหลด", 1], ["ขายได้", 1], ["ส่วนของคุณ", 1]],
      e.items.map((i) => [[el("a", { href: `/community/w/${i.wallpaperId}` }, i.title)], [formatPrice(i.priceCents), 1], [num.format(i.downloads), 1], [num.format(i.salesCount), 1], [thb(i.netCents), 1]]),
      "ยังไม่มีงานที่อัปโหลด",
    ),
  );
  document.querySelector("[data-recent]").replaceChildren(
    table(
      [["วันที่"], ["ชิ้นงาน"], ["ราคา", 1], ["ส่วนของคุณ", 1]],
      e.recent.map((r) => [[formatDate(r.paidAt)], [r.title], [thb(r.amountCents), 1], [thb(r.netCents), 1]]),
      "ยังไม่มีการขาย",
    ),
  );
} catch (x) {
  box.replaceChildren(notice("error", x.message));
}
