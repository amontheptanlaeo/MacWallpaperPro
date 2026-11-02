// My uploads: review status of everything the creator has shared.
import { api, esc, t, toast } from "./site.js";

const list = document.querySelector("[data-mine]");
const fmtDate = (iso) => {
  try {
    return new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
};

async function load() {
  try {
    const items = await api("/api/me/wallpapers");
    list.setAttribute("aria-busy", "false");
    if (!items.length) {
      list.innerHTML = `<li class="emptybox"><p>${esc(t("mine.empty"))}</p><a class="btn btn--light" href="/community/upload">${esc(t("nav.upload"))}</a></li>`;
      return;
    }
    list.innerHTML = items
      .map(
        (w) => `<li class="urow">
  <img src="${esc(w.thumbUrl)}" alt="" loading="lazy" width="1600" height="1000">
  <div>
    <h2>${esc(w.title)}</h2>
    <p>${esc(t(`cat.${w.category}`))}, <time datetime="${esc(w.createdAt)}">${esc(fmtDate(w.createdAt))}</time></p>
    <span class="badge badge--${esc(w.status)}">${esc(t(`mine.${w.status}`))}</span>
    ${w.status === "rejected" && w.rejectReason ? `<p>${esc(t("mine.reason", { reason: w.rejectReason }))}</p>` : ""}
  </div>
  <a class="btn btn--glass btn--sm" href="/community/w/${esc(w.id)}">${esc(t("mine.view"))}</a>
</li>`,
      )
      .join("");
  } catch (e) {
    list.setAttribute("aria-busy", "false");
    list.innerHTML = `<li class="error" role="alert">${esc(e.status === 401 ? t("err.signin") : e.message)}</li>`;
  }
}
if (list) load();

// Delete my account: a confirmation dialog, then DELETE /api/me with an explicit confirm field.
const delModal = document.querySelector("[data-delete-modal]");
document.querySelector("[data-delete-open]")?.addEventListener("click", () => delModal?.showModal());
delModal?.addEventListener("click", (e) => {
  if (e.target === delModal || e.target.closest("[data-close]")) delModal.close();
});
delModal?.querySelector("[data-delete-confirm]")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const err = delModal.querySelector("[data-delete-error]");
  btn.disabled = true;
  err.hidden = true;
  try {
    await api("/api/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
    delModal.close();
    toast(t("mine.deleted"));
    setTimeout(() => location.assign("/"), 1200);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
  }
});
