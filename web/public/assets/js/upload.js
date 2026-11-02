// Creator upload: drag & drop, client-side checks that mirror the server, and a live preview that
// runs the chosen index.html inside the same locked-down sandbox the community uses.
import { t } from "./site.js";

const MAX_HTML = 10 * 1024 * 1024;
const MAX_THUMB = 2 * 1024 * 1024;
const MAX_VIDEO = 60 * 1024 * 1024;

const root = document.querySelector("[data-upload]");
const form = root?.querySelector("[data-upload-form]");
const previewBox = root?.querySelector("[data-local-preview]");
const files = { file: null, thumb: null, video: null };
let kind = "html";
let htmlText = "";

const ERR_MAP = {
  invalid_file: ["file", "err.notHtml"],
  file_too_large: ["file", "err.fileTooBig"],
  invalid_thumb: ["thumb", "err.notImage"],
  thumb_too_large: ["thumb", "err.thumbTooBig"],
  invalid_title: ["title", "err.title"],
  invalid_description: ["description", "err.description"],
  invalid_tags: ["tags", "err.tags"],
  invalid_category: ["category", "err.category"],
  payload_too_large: ["file", "err.fileTooBig"],
  invalid_video: ["video", "err.notVideo"],
  invalid_credit: ["credit", "err.credit"],
  invalid_license: ["license", "err.license"],
  invalid_source_url: ["sourceUrl", "err.sourceUrl"],
  rights_required: ["rights", "err.rights"],
  hash_mismatch: [null, "err.hashMismatch"],
  upload_incomplete: [null, "err.hashMismatch"],
  invalid_sha256: [null, "err.hashMismatch"],
  length_required: [null, "err.hashMismatch"],
  rate_limited: [null, "err.rateLimited"],
  unauthorized: [null, "err.signin"],
  network: [null, "err.network"],
};

const field = (n) => form.elements.namedItem(n);
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function setErr(name, key) {
  const el = form.querySelector(`[data-err-for="${name}"]`);
  if (el) el.textContent = key ? t(key) : "";
  const input = form.querySelector(`[name="${name}"]`);
  if (input) {
    if (key) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  form.querySelector(`[data-drop="${name}"]`)?.classList.toggle("is-invalid", !!key);
}

function sniffImage(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
  return false;
}

/** MP4/MOV: an ISO-BMFF box of type "ftyp" first (same check as the server). */
function sniffVideo(b) {
  if (b.length < 12) return false;
  const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  if (size !== 1 && size < 12) return false;
  if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false;
  for (let i = 8; i < 12; i++) if (b[i] < 0x20 || b[i] > 0x7e) return false;
  return true;
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function clearPreview(emptyKey) {
  previewBox.querySelector("iframe")?.remove();
  const v = previewBox.querySelector("video");
  if (v) {
    URL.revokeObjectURL(v.src);
    v.remove();
  }
  let empty = previewBox.querySelector(".display__empty");
  if (!empty) {
    empty = document.createElement("div");
    empty.className = "display__empty";
    empty.innerHTML = "<p></p>";
    previewBox.append(empty);
  }
  empty.querySelector("p").textContent = t(emptyKey);
}

function showVideoPreview(file) {
  clearPreview("up.previewEmptyVideo");
  previewBox.querySelector(".display__empty")?.remove();
  const v = document.createElement("video");
  v.className = "display__frame is-ready";
  v.muted = true;
  v.loop = true;
  v.autoplay = true;
  v.playsInline = true;
  v.src = URL.createObjectURL(file);
  previewBox.append(v);
  v.play().catch(() => {});
}

function setKind(k) {
  kind = k === "video" ? "video" : "html";
  for (const el of form.querySelectorAll("[data-only]")) el.hidden = el.dataset.only !== kind;
  for (const n of ["file", "video", "credit", "license", "sourceUrl", "rights"]) setErr(n, null);
  if (kind === "video") {
    if (files.video) showVideoPreview(files.video);
    else clearPreview("up.previewEmptyVideo");
  } else if (htmlText) {
    showPreview(htmlText);
  } else {
    clearPreview("up.previewEmpty");
  }
}

function showPreview(html) {
  previewBox.querySelector(".display__empty")?.remove();
  previewBox.querySelector("iframe")?.remove();
  const oldVideo = previewBox.querySelector("video");
  if (oldVideo) {
    URL.revokeObjectURL(oldVideo.src);
    oldVideo.remove();
  }
  const frame = document.createElement("iframe");
  frame.className = "display__frame";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = t("up.previewTitle");
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow || !e.data || e.data.mwpPreviewReady !== true) return;
    removeEventListener("message", onMsg);
    frame.contentWindow.postMessage({ html }, "*"); // opaque-origin sandbox: "*" is the only target that works
    frame.classList.add("is-ready");
  };
  addEventListener("message", onMsg);
  frame.src = "/preview-sandbox";
  previewBox.append(frame);
}

async function accept(kind, file) {
  const drop = form.querySelector(`[data-drop="${kind}"]`);
  const text = drop.querySelector("[data-drop-text]");
  setErr(kind, null);
  files[kind] = null;
  drop.classList.remove("has-file");
  if (!file) return;
  if (kind === "file") {
    if (file.size > MAX_HTML) return setErr("file", "err.fileTooBig");
    const s = await file.text();
    if (!/<html[\s>]/i.test(s)) return setErr("file", "err.notHtml");
    htmlText = s;
    files.file = file;
    const title = form.querySelector('[name="title"]');
    const m = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(s);
    if (title && !title.value && m) title.value = m[1].trim();
    showPreview(s);
  } else if (kind === "video") {
    if (file.size > MAX_VIDEO) return setErr("video", "err.videoTooBig");
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!sniffVideo(head)) return setErr("video", "err.notVideo");
    files.video = file;
    const title = form.querySelector('[name="title"]');
    if (title && !title.value) title.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 80);
    showVideoPreview(file);
  } else {
    if (file.size > MAX_THUMB) return setErr("thumb", "err.thumbTooBig");
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!sniffImage(head)) return setErr("thumb", "err.notImage");
    files.thumb = file;
    const img = drop.querySelector("[data-thumb-preview]");
    if (img) {
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(file);
      img.hidden = false;
    }
  }
  drop.classList.add("has-file");
  text.textContent = `${file.name} (${fmtSize(file.size)})`;
}

if (form) {
  for (const drop of form.querySelectorAll("[data-drop]")) {
    const kind = drop.dataset.drop;
    const input = drop.querySelector("input[type=file]");
    input.addEventListener("change", () => accept(kind, input.files[0] || null));
    const zone = drop.querySelector(".drop__zone");
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("is-drag");
    });
    zone.addEventListener("dragleave", () => drop.classList.remove("is-drag"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-drag");
      const f = e.dataTransfer?.files?.[0];
      if (f) accept(kind, f);
    });
  }
  // Don't let a stray drop outside the zones navigate away from the form.
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => e.preventDefault());
  for (const r of form.querySelectorAll('input[name="kind"]')) r.addEventListener("change", () => r.checked && setKind(r.value));
  setKind(form.querySelector('input[name="kind"]:checked')?.value || "html");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formErr = form.querySelector("[data-form-error]");
    formErr.hidden = true;
    for (const n of ["file", "video", "thumb", "title", "category", "description", "tags", "credit", "license", "sourceUrl", "rights"]) setErr(n, null);
    let first = null;
    const need = (cond, name, key) => {
      if (!cond) {
        setErr(name, key);
        first ??= name;
      }
    };
    if (kind === "video") need(files.video, "video", "err.notVideo");
    else need(files.file, "file", "err.notHtml");
    need(files.thumb, "thumb", "err.notImage");
    need(field("title").value.trim(), "title", "err.title");
    need(field("category").value, "category", "err.category");
    if (kind === "video") {
      need(field("credit").value.trim(), "credit", "err.credit");
      need(field("license").value.trim(), "license", "err.license");
      const src = field("sourceUrl").value.trim();
      need(!src || /^https?:\/\//i.test(src), "sourceUrl", "err.sourceUrl");
      need(field("rights").checked, "rights", "err.rights");
    }
    if (first) {
      form.querySelector(`[name="${first}"]`)?.focus();
      return;
    }
    const btn = form.querySelector("[data-submit]");
    const label = btn.querySelector("span");
    const prev = label.textContent;
    btn.disabled = true;
    label.textContent = t("up.submitting");
    const fd = new FormData();
    fd.set("title", field("title").value.trim());
    fd.set("description", field("description").value.trim());
    fd.set("tags", field("tags").value);
    fd.set("category", field("category").value);
    fd.set("thumb", files.thumb, files.thumb.name || "thumb");
    const send = async (url, init) => {
      let res;
      try {
        res = await fetch(url, { credentials: "same-origin", ...init });
      } catch {
        throw { code: "network" };
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw { code: body?.error?.code || "generic" };
      return body;
    };
    try {
      if (kind === "video") {
        fd.set("kind", "video");
        fd.set("credit", field("credit").value.trim());
        fd.set("license", field("license").value.trim());
        fd.set("sourceUrl", field("sourceUrl").value.trim());
        fd.set("rights", field("rights").checked ? "on" : "");
        // The Worker never hashes the file (free-plan CPU): we declare the SHA-256 and R2 verifies it.
        label.textContent = t("up.hashing");
        const sha = hex(await crypto.subtle.digest("SHA-256", await files.video.arrayBuffer()));
        label.textContent = t("up.submitting");
        const draft = await send("/api/wallpapers", { method: "POST", body: fd });
        label.textContent = t("up.uploadingVideo");
        await send(draft.uploadUrl, {
          method: "PUT",
          body: files.video,
          headers: { "Content-Type": "video/mp4", "X-Content-SHA256": sha },
        });
      } else {
        fd.set("file", files.file, "index.html");
        await send("/api/wallpapers", { method: "POST", body: fd });
      }
      root.classList.add("is-done");
      const done = root.querySelector("[data-upload-done]");
      done.hidden = false;
      done.focus();
      scrollTo({ top: 0 });
    } catch (err) {
      let [field, key] = ERR_MAP[err.code] || [null, "err.generic"];
      if (kind === "video" && (err.code === "file_too_large" || err.code === "payload_too_large")) [field, key] = ["video", "err.videoTooBig"];
      if (field) {
        setErr(field, key);
        form.querySelector(`[name="${field}"]`)?.focus();
      } else {
        formErr.textContent = t(key);
        formErr.hidden = false;
      }
    } finally {
      btn.disabled = false;
      label.textContent = prev;
    }
  });
}
