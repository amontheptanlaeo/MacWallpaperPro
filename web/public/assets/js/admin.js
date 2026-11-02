// Moderation queue: live preview (sandboxed), scanner findings, approve / reject with a reason.
import { api, esc, t, toast } from "./site.js";

const root = document.querySelector("[data-queue]");

function scanList(scan) {
  if (!scan.length) return `<p class="muted">${esc(t("admin.scanClean"))}</p>`;
  return `<h3 class="h4">${esc(t("admin.scanFound"))}</h3><ul class="scan">${scan
    .map(
      (f) => `<li class="sev-${esc(f.severity)}"><strong>${esc(t(`scan.${f.id}`))}</strong> (${f.count})${f.samples
        .map((s) => `<code>${esc(t("admin.line", { n: s.line }))}: ${esc(s.excerpt)}</code>`)
        .join("")}</li>`,
    )
    .join("")}</ul>`;
}

function render(items) {
  root.setAttribute("aria-busy", "false");
  if (!items.length) {
    root.innerHTML = `<div class="emptybox"><p>${esc(t("admin.empty"))}</p></div>`;
    return;
  }
  root.innerHTML = items
    .map(
      (w) => `<article class="qitem" data-id="${esc(w.id)}">
  <div class="display"><div class="display__screen">
    <img class="display__poster" src="${esc(w.thumbUrl)}" alt="" width="1600" height="1000">
    <iframe class="display__frame is-ready" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="${esc(w.title)}" src="${esc(w.previewUrl)}"></iframe>
  </div></div>
  <div class="qitem__meta">
    <h2>${esc(w.title)}</h2>
    <p class="muted">${esc(t("card.by", { name: w.author.name }))} (${esc(w.authorEmail)}), ${esc(t(`cat.${w.category}`))}, ${(w.sizeBytes / 1024).toFixed(0)} KB</p>
    ${w.description ? `<p dir="auto">${esc(w.description)}</p>` : ""}
    ${scanList(w.scan)}
    <div class="qitem__actions">
      <button type="button" class="btn btn--light" data-approve>${esc(t("admin.approve"))}</button>
      <label class="field"><span class="sr">${esc(t("admin.reason"))}</span><input data-reason maxlength="500" placeholder="${esc(t("admin.reason"))}"></label>
      <button type="button" class="btn btn--ghost" data-reject>${esc(t("admin.reject"))}</button>
    </div>
  </div>
</article>`,
    )
    .join("");
}

async function load() {
  try {
    render((await api("/api/admin/queue")).items);
  } catch (e) {
    root.innerHTML = `<p class="error" role="alert">${esc(e.message)}</p>`;
  }
}

root?.addEventListener("click", async (e) => {
  const item = e.target.closest(".qitem");
  if (!item) return;
  const id = item.dataset.id;
  try {
    if (e.target.closest("[data-approve]")) {
      await api(`/api/admin/wallpapers/${id}/approve`, { method: "POST" });
      toast(t("admin.approved"));
    } else if (e.target.closest("[data-reject]")) {
      const input = item.querySelector("[data-reason]");
      const reason = input.value.trim();
      if (!reason) {
        input.focus();
        input.setAttribute("aria-invalid", "true");
        return;
      }
      await api(`/api/admin/wallpapers/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      toast(t("admin.rejected"));
    } else return;
    item.remove();
    if (!root.querySelector(".qitem")) render([]);
  } catch (err) {
    toast(err.message);
  }
});

if (root) load();
