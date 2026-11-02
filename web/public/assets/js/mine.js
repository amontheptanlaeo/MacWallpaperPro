// My uploads: review status of everything the creator has shared.
import { api, esc, t } from "./site.js";

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
