import { api, notice, safeNext } from "./common.js";

const form = document.querySelector("[data-auth]");
const mode = form.dataset.auth;
const msg = document.querySelector("[data-msg]");
const next = safeNext(new URLSearchParams(location.search).get("next"));

document.querySelectorAll("[data-keep-next]").forEach((a) => {
  const n = new URLSearchParams(location.search).get("next");
  if (n) a.href += `?next=${encodeURIComponent(safeNext(n))}`;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.replaceChildren();
  const fd = new FormData(form);
  const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  for (const input of form.querySelectorAll("input[required]")) {
    const bad = !input.value.trim() || (input.type === "email" && !input.validity.valid) || (input.minLength > 0 && input.value.length < input.minLength);
    input.setAttribute("aria-invalid", String(bad));
  }
  const firstBad = form.querySelector('[aria-invalid="true"]');
  if (firstBad) {
    msg.replaceChildren(notice("error", mode === "register" ? "กรอกข้อมูลให้ครบ รหัสผ่านอย่างน้อย 10 ตัวอักษร" : "กรอกอีเมลและรหัสผ่าน"));
    firstBad.focus();
    return;
  }
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await api(`/api/auth/${mode}`, { method: "POST", body });
    location.href = next;
  } catch (err) {
    msg.replaceChildren(notice("error", err.message));
    btn.disabled = false;
  }
});
