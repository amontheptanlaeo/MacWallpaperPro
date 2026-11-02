// Creator upload: drag & drop, client-side checks that mirror the server, and a live preview that
// runs the chosen index.html inside the same locked-down sandbox the community uses.
import { t } from "./site.js";

const MAX_HTML = 10 * 1024 * 1024;
const MAX_THUMB = 2 * 1024 * 1024;

const root = document.querySelector("[data-upload]");
const form = root?.querySelector("[data-upload-form]");
const previewBox = root?.querySelector("[data-local-preview]");
const files = { file: null, thumb: null };
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

function showPreview(html) {
  previewBox.querySelector(".display__empty")?.remove();
  previewBox.querySelector("iframe")?.remove();
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formErr = form.querySelector("[data-form-error]");
    formErr.hidden = true;
    for (const n of ["file", "thumb", "title", "category", "description", "tags"]) setErr(n, null);
    let first = null;
    const need = (cond, name, key) => {
      if (!cond) {
        setErr(name, key);
        first ??= name;
      }
    };
    need(files.file, "file", "err.notHtml");
    need(files.thumb, "thumb", "err.notImage");
    need(field("title").value.trim(), "title", "err.title");
    need(field("category").value, "category", "err.category");
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
    fd.set("file", files.file, "index.html");
    fd.set("thumb", files.thumb, files.thumb.name || "thumb");
    try {
      let res;
      try {
        res = await fetch("/api/wallpapers", { method: "POST", body: fd, credentials: "same-origin" });
      } catch {
        throw { code: "network" };
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw { code: body?.error?.code || "generic" };
      root.classList.add("is-done");
      const done = root.querySelector("[data-upload-done]");
      done.hidden = false;
      done.focus();
      scrollTo({ top: 0 });
    } catch (err) {
      const [field, key] = ERR_MAP[err.code] || [null, "err.generic"];
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
