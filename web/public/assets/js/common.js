// Shared client helpers. All user-provided text goes through textContent (never innerHTML).

export const ICONS = {
  logo: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#33f2cc"/><stop offset="1" stop-color="#9e4dff"/></linearGradient></defs><rect x="2" y="4" width="20" height="14" rx="3.5" fill="none" stroke="url(#lg)" stroke-width="2"/><path d="M6 14.5c2.5-4 5-5.5 12-6" fill="none" stroke="url(#lg)" stroke-width="2" stroke-linecap="round"/><path d="M9 21h6" stroke="url(#lg)" stroke-width="2" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11m0 0-4.2-4.2M12 14.5l4.2-4.2M4.5 19.5h15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  app: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 21h6M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m10 8.5 4 2-4 2z" fill="currentColor"/></svg>',
  cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 4.5h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.1l1.6-6.3H7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="19.5" r="1.3" fill="currentColor"/><circle cx="17" cy="19.5" r="1.3" fill="currentColor"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 18 5.5-5 4 3.5 3-2.5 3.5 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5v-11m0 0L7.8 8.7M12 4.5l4.2 4.2M4.5 19.5h15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 12 2.2 2.2L15.5 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};

/** Tiny DOM builder: el("a", { href, class: "x" }, "text", childNode) */
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v; // ONLY for trusted constant markup (icons)
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function icon(name) {
  const span = document.createElement("span");
  span.innerHTML = ICONS[name] || "";
  return span.firstElementChild;
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = "GET", body, form } = {}) {
  const init = { method, credentials: "same-origin", headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data && data.error;
    throw new ApiError(res.status, e?.code || "error", e?.message || `เกิดข้อผิดพลาด (${res.status})`);
  }
  return data;
}

let mePromise;
/** Current user or null. Cached per page load. */
export function getMe() {
  if (!mePromise) mePromise = api("/api/me").catch(() => null);
  return mePromise;
}

/** Redirect to login when the page needs an account. */
export async function requireMe() {
  const me = await getMe();
  if (!me) {
    location.replace(`/community/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    return new Promise(() => {});
  }
  return me;
}

const baht = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function formatPrice(cents) {
  return cents === 0 ? "ฟรี" : baht.format(cents / 100);
}
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
const dateFmt = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" });
export function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}
export const num = new Intl.NumberFormat("th-TH");

export function installLink(id) {
  return `macwallpaperpro://install?id=${encodeURIComponent(id)}`;
}

/** Only allow same-site relative redirect targets. */
export function safeNext(raw, fallback = "/community") {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export function card(w) {
  const price = el("span", { class: "price" + (w.priceCents === 0 ? " free" : "") }, formatPrice(w.priceCents));
  return el(
    "a",
    { class: "card", href: `/community/w/${encodeURIComponent(w.id)}` },
    el("div", { class: "card-thumb" }, el("img", { src: w.thumbUrl, alt: "", loading: "lazy", decoding: "async", width: 320, height: 200 })),
    el(
      "div",
      { class: "card-meta" },
      el("div", { class: "minw0" }, el("h3", { class: "card-title" }, w.title), el("div", { class: "card-sub" }, el("span", {}, w.author.name), el("span", {}, `ดาวน์โหลด ${num.format(w.downloads)}`))),
      price,
    ),
  );
}

export function skeletonCards(n = 6) {
  return Array.from({ length: n }, () =>
    el("div", { class: "card", "aria-hidden": "true" }, el("div", { class: "card-thumb skeleton" }), el("div", { class: "card-meta" }, el("div", { class: "skeleton sk-line" }))),
  );
}

export function notice(kind, text) {
  return el("div", { class: `notice ${kind}`, role: kind === "error" ? "alert" : "status" }, el("p", {}, text));
}

export function statusBadge(s) {
  const label = { pending: "รอตรวจ", approved: "อยู่บนร้าน", rejected: "ไม่ผ่าน" }[s] || s;
  return el("span", { class: `badge ${s}` }, label);
}

export function emptyState(iconName, text, action) {
  return el("div", { class: "empty" }, icon(iconName), el("p", {}, text), action || null);
}
