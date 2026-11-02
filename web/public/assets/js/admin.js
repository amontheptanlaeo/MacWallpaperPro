// Moderation queue: live preview (sandboxed), scanner findings, approve / reject with a reason.
import { api, esc, t, toast } from "./site.js";

const root = document.querySelector("[data-queue]");

// The scanner is a hint only: say so next to every result, clean or not.
const advisory = () => `<p class="scan-note" role="note">${esc(t("admin.scanAdvisory"))}</p>`;

function scanList(scan) {
  if (!scan.length) return `<p class="muted">${esc(t("admin.scanClean"))}</p>${advisory()}`;
  return `<h3 class="h4">${esc(t("admin.scanFound"))}</h3>${advisory()}<ul class="scan">${scan
    .map(
      (f) => `<li class="sev-${esc(f.severity)}"><strong>${esc(t(`scan.${f.id}`))}</strong> (${f.count})${f.samples
        .map((s) => `<code>${esc(t("admin.line", { n: s.line }))}: ${esc(s.excerpt)}</code>`)
        .join("")}</li>`,
    )
    .join("")}</ul>`;
}

function videoFacts(w) {
  const src = w.sourceUrl ? `<a href="${esc(w.sourceUrl)}" rel="noopener noreferrer nofollow" target="_blank">${esc(w.sourceUrl)}</a>` : "-";
  return `<dl class="facts">
    <div><dt>${esc(t("detail.credit"))}</dt><dd dir="auto">${esc(w.credit || "-")}</dd></div>
    <div><dt>${esc(t("detail.license"))}</dt><dd dir="auto">${esc(w.license || "-")}</dd></div>
    <div class="facts__wide"><dt>${esc(t("detail.source"))}</dt><dd>${src}</dd></div>
  </dl>
  <p class="muted">${esc(t("admin.rightsConfirmed"))}</p>`;
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
    ${
      w.kind === "video"
        ? // Same-origin <video>: the moderator's session cookie is sent, so pending videos play.
          `<video class="display__frame is-ready" controls muted loop playsinline preload="metadata" title="${esc(w.title)}" src="/api/wallpapers/${esc(w.id)}/download"></video>`
        : `<iframe class="display__frame is-ready" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="${esc(w.title)}" src="${esc(w.previewUrl)}"></iframe>`
    }
  </div></div>
  <div class="qitem__meta">
    <h2>${esc(w.title)}</h2>
    <p class="muted">${esc(t("card.by", { name: w.author.name }))} (${esc(w.authorEmail)}), ${esc(t(`cat.${w.category}`))}, ${w.kind === "video" ? `${esc(t("card.video"))}, ${(w.sizeBytes / 1048576).toFixed(1)} MB` : `${(w.sizeBytes / 1024).toFixed(0)} KB`}</p>
    ${w.kind === "video" ? videoFacts(w) : ""}
    ${w.description ? `<p dir="auto">${esc(w.description)}</p>` : ""}
    ${w.kind === "video" ? "" : scanList(w.scan)}
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
