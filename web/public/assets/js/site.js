// Shared behaviour for every page: translations, header menus, account menu, one-click install,
// live card previews, consent banner, copy buttons. No third-party code.

const dictEl = document.getElementById("mwp-i18n");
const DICT = dictEl ? JSON.parse(dictEl.textContent || "{}") : {};
export const LANG = document.documentElement.lang || "en";

export function t(key, vars) {
  let s = DICT[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const canHover = matchMedia("(hover: hover) and (pointer: fine)");

const ICONS = {
  install: '<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><rect x="3" y="15" width="18" height="5" rx="2"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
};
export function icon(name, cls = "icon") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}

const compact = (() => {
  try {
    return new Intl.NumberFormat(LANG, { notation: "compact", maximumFractionDigits: 1 });
  } catch {
    return { format: String };
  }
})();
export const fmtCount = (n) => compact.format(n);

export async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  } catch {
    const e = new Error(t("err.network"));
    e.code = "network";
    throw e;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body?.error?.message || t("err.generic"));
    e.code = body?.error?.code || String(res.status);
    e.status = res.status;
    throw e;
  }
  return body;
}

/** Same markup as the server-rendered card (src/views/components.ts). */
export function renderCard(w) {
  return `<article class="card" data-card data-id="${esc(w.id)}">
  <div class="card__media">
    <img src="${esc(w.thumbUrl)}" alt="" width="1600" height="1000" loading="lazy" decoding="async">
    <span class="card__live" aria-hidden="true"><span class="dot"></span>${esc(t("card.previewing"))}</span>
  </div>
  <div class="card__body">
    <div class="card__text">
      <h3 class="card__title"><a class="card__link" href="/community/w/${esc(w.id)}">${esc(w.title)}</a></h3>
      <p class="card__meta"><span class="card__author">${esc(t("card.by", { name: w.author?.name ?? "" }))}</span>${w.downloads > 0 ? `<span class="card__dl" title="${esc(t("card.downloads"))}">${icon("download", "icon icon--xs")}<span class="sr">${esc(t("card.downloads"))}: </span>${esc(fmtCount(w.downloads))}</span>` : ""}</p>
    </div>
    <button type="button" class="btn btn--install" data-install="${esc(w.id)}" data-title="${esc(w.title)}">${icon("install")}<span>${esc(t("card.install"))}</span></button>
  </div>
</article>`;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = 0;
export function toast(msg) {
  let el = document.querySelector("[data-toast]");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.dataset.toast = "";
    document.body.append(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Header: scrolled state, one open menu at a time, Escape / outside click closes
// ---------------------------------------------------------------------------
const bar = document.querySelector("[data-bar]");
if (bar && document.body.classList.contains("is-landing")) {
  const onScroll = () => bar.classList.toggle("is-scrolled", scrollY > 24);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}
function closeMenus(except) {
  for (const d of document.querySelectorAll("details.lang[open], details.mnav[open], details.acct[open]")) if (d !== except) d.open = false;
}
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d instanceof HTMLDetailsElement && d.open && d.matches(".lang, .mnav, .acct")) closeMenus(d);
}, true);
document.addEventListener("click", (e) => {
  if (!e.target.closest("details.lang, details.mnav, details.acct")) closeMenus();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = document.querySelector("details.lang[open], details.mnav[open], details.acct[open]");
  if (open) {
    open.open = false;
    open.querySelector("summary")?.focus();
  }
});

// ---------------------------------------------------------------------------
// Account menu (only when the sign-in hint cookie exists, so visitors never hit /api/me)
// ---------------------------------------------------------------------------
export let me = null;
export const meReady = (async () => {
  if (!/(?:^|;\s*)mwp_user=1/.test(document.cookie)) return null;
  try {
    me = await api("/api/me");
  } catch {
    return null;
  }
  const slot = document.querySelector("[data-account]");
  if (slot && me) {
    const initial = esc([...(me.displayName || "?")][0].toUpperCase());
    const avatar = me.avatarUrl ? `<img src="${esc(me.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : initial;
    slot.innerHTML = `<details class="acct"><summary class="acct__btn" aria-label="${esc(t("nav.account"))}">${avatar}</summary>
<div class="acct__panel">
  <div class="acct__who"><strong>${esc(me.displayName)}</strong><span>${esc(me.email)}</span></div>
  <a href="/community/upload">${icon("upload")}<span>${esc(t("nav.upload"))}</span></a>
  <a href="/community/mine">${icon("inbox")}<span>${esc(t("nav.myUploads"))}</span></a>
  ${me.role === "admin" ? `<a href="/community/admin">${icon("shield")}<span>${esc(t("nav.admin"))}</span></a>` : ""}
  <button type="button" data-signout>${icon("logout")}<span>${esc(t("nav.signout"))}</span></button>
</div></details>`;
    slot.hidden = false;
    slot.querySelector("[data-signout]").addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" }).catch(() => {});
      location.href = "/";
    });
  }
  return me;
})();

// ---------------------------------------------------------------------------
// One-click install: fire the deep link, then detect whether the app took over.
// ---------------------------------------------------------------------------
const modal = document.querySelector("[data-install-modal]");
let lastInstall = null;

function fireDeepLink(url) {
  // Firefox shows an error page for unknown schemes on top-level navigation; an invisible frame avoids it.
  if (/Firefox\//.test(navigator.userAgent)) {
    const f = document.createElement("iframe");
    f.hidden = true;
    f.src = url;
    document.body.append(f);
    setTimeout(() => f.remove(), 4000);
  } else {
    location.href = url;
  }
}

export function install(id, title) {
  const url = `macwallpaperpro://install?id=${encodeURIComponent(id)}`;
  lastInstall = { id, title, url };
  let left = false;
  const mark = () => {
    left = true;
    // The app came to the front after all: close the "not installed" dialog if it already showed.
    if (modal?.open) modal.close();
  };
  const onVis = () => document.hidden && mark();
  addEventListener("blur", mark);
  addEventListener("pagehide", mark);
  document.addEventListener("visibilitychange", onVis);

  const pill = document.createElement("div");
  pill.className = "opening";
  pill.setAttribute("role", "status");
  pill.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(t("install.opening"))}</span>`;
  document.body.append(pill);

  fireDeepLink(url);

  setTimeout(() => {
    pill.remove();
    if (!left && !document.hidden && document.hasFocus()) showMissing(url);
  }, 1500);
  // Keep listening a while: browsers that ask "Open MacWallpaperPro?" only blur after the user confirms.
  setTimeout(() => {
    removeEventListener("blur", mark);
    removeEventListener("pagehide", mark);
    document.removeEventListener("visibilitychange", onVis);
  }, 20000);
}

function showMissing(url) {
  if (!modal) return;
  const input = modal.querySelector("[data-install-link]");
  if (input) input.value = url;
  if (!modal.open) modal.showModal();
  modal.querySelector(".btn--light")?.focus();
}

if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) modal.close();
  });
  modal.querySelector("[data-install-retry]")?.addEventListener("click", () => {
    modal.close();
    if (lastInstall) install(lastInstall.id, lastInstall.title);
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-install]");
  if (btn && !btn.disabled) {
    e.preventDefault();
    install(btn.dataset.install, btn.dataset.title || "");
    return;
  }
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    const input = document.querySelector(cp.dataset.copy);
    if (input) {
      input.select();
      copyText(input.value).then((ok) => {
        if (!ok) document.execCommand?.("copy");
        const label = cp.querySelector("span");
        if (label) {
          const prev = label.textContent;
          label.textContent = t("install.copied");
          setTimeout(() => (label.textContent = prev), 1600);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Live card previews: hover (mouse only) creates ONE sandboxed iframe at a time, lazily, and removes
// it again on leave. Wallpapers are responsive, so they render at the card's own size (cheap on GPU).
// ---------------------------------------------------------------------------
let liveCard = null;
let hoverTimer = 0;

function activate(cardEl) {
  if (liveCard === cardEl) return;
  if (liveCard) deactivate(liveCard);
  liveCard = cardEl;
  const media = cardEl.querySelector(".card__media");
  if (!media) return;
  let frame = media.querySelector("iframe");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.className = "card__frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("aria-hidden", "true");
    frame.title = "";
    frame.addEventListener("load", () => frame.classList.add("is-ready"), { once: true });
    frame.src = `/preview/${encodeURIComponent(cardEl.dataset.id)}`;
    media.append(frame);
  }
  cardEl.classList.add("is-live");
}

function deactivate(cardEl) {
  cardEl.classList.remove("is-live");
  if (liveCard === cardEl) liveCard = null;
  const frame = cardEl.querySelector(".card__frame");
  if (frame) setTimeout(() => !cardEl.classList.contains("is-live") && frame.remove(), 450);
}

if (canHover.matches && !reduceMotion.matches) {
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const c = e.target.closest?.("[data-card]");
    if (!c || c === liveCard) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => activate(c), 140);
  });
  document.addEventListener("pointerout", (e) => {
    const c = e.target.closest?.("[data-card]");
    if (!c || (e.relatedTarget && c.contains(e.relatedTarget))) return;
    clearTimeout(hoverTimer);
    deactivate(c);
  });
  // Keyboard users get the same preview when a card's link is focused.
  document.addEventListener("focusin", (e) => {
    const c = e.target.closest?.("[data-card]");
    if (c) activate(c);
    else if (liveCard) deactivate(liveCard);
  });
  document.addEventListener("visibilitychange", () => document.hidden && liveCard && deactivate(liveCard));
}

// ---------------------------------------------------------------------------
// Consent (Google Consent Mode v2: everything denied until the visitor accepts)
// ---------------------------------------------------------------------------
const consent = document.querySelector("[data-consent]");
if (consent) {
  for (const b of consent.querySelectorAll("[data-consent-choice]")) {
    b.addEventListener("click", () => {
      const v = b.dataset.consentChoice === "granted" ? "granted" : "denied";
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `mwp_consent=${v}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
      consent.hidden = true;
      dispatchEvent(new CustomEvent("mwp:consent", { detail: v }));
      toast(t("consent.saved"));
    });
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-consent-open]")) {
      consent.hidden = false;
      consent.querySelector("[data-consent-choice]")?.focus();
    }
  });
}
