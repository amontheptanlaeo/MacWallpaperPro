import { escapeHtml as e } from "../lib/http";
import type { ProviderId } from "../lib/oauth";
import { CATEGORIES, MAX_DESCRIPTION, MAX_TITLE } from "../lib/validate";
import type { WallpaperDetail, WallpaperSummary } from "../lib/wallpapers";
import { ad, card, catLabel, chips, fmtCount, fmtDate } from "./components";
import { GITHUB_LOGO, GOOGLE_LOGO, icon } from "./icons";
import { jsonBlock, page, REPO_URL, type Ctx } from "./layout";

const installModal = (ctx: Ctx) => {
  const { t } = ctx;
  return `<dialog class="modal" data-install-modal aria-labelledby="im-title">
  <div class="modal__art" aria-hidden="true"><div class="modal__screen"><span></span></div></div>
  <h2 id="im-title">${e(t("install.missingTitle"))}</h2>
  <p>${e(t("install.missingBody"))}</p>
  <div class="modal__actions">
    <a class="btn btn--light btn--block" href="/download">${icon("download")}<span>${e(t("install.download"))}</span></a>
    <button type="button" class="btn btn--ghost btn--block" data-install-retry>${e(t("install.retry"))}</button>
  </div>
  <p class="modal__fine">${e(t("install.requirements"))}</p>
  <div class="modal__manual">
    <label for="im-link">${e(t("install.manual"))}</label>
    <div class="copyfield"><input id="im-link" readonly data-install-link value=""><button type="button" class="btn btn--ghost btn--sm" data-copy="#im-link">${icon("copy")}<span>${e(t("install.copy"))}</span></button></div>
  </div>
  <button type="button" class="iconbtn modal__close" data-close aria-label="${e(t("install.close"))}">${icon("close")}</button>
</dialog>
<div class="toast" data-toast role="status" aria-live="polite" hidden></div>`;
};

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------
export function landingPage(
  ctx: Ctx,
  data: { showcase: WallpaperSummary[]; cute: WallpaperSummary[]; tops: Record<string, WallpaperSummary | undefined>; counts: Record<string, number> },
): Response {
  const { t } = ctx;
  const showcase = data.showcase.length
    ? `<div class="showcase">${data.showcase.map((w, i) => card(ctx, w, { featured: i === 0, eager: i === 0 })).join("\n")}</div>`
    : `<div class="emptybox"><p>${e(t("show.empty"))}</p><a class="btn btn--glass" href="/community/upload">${e(t("make.cta"))}</a></div>`;

  const moods = CATEGORIES.map((c) => {
    const top = data.tops[c];
    return `<a class="mood mood--${c}" href="/community?category=${c}">
  ${top ? `<img src="${e(top.thumbUrl)}" alt="" loading="lazy" decoding="async" width="1600" height="1000">` : ""}
  <span class="mood__shade" aria-hidden="true"></span>
  <span class="mood__text"><span class="mood__name">${e(catLabel(ctx, c))}</span><span class="mood__desc">${e(t(`catd.${c}` as never))}</span></span>
  ${data.counts[c] ? `<span class="mood__count" aria-hidden="true">${e(fmtCount(ctx, data.counts[c]))}</span>` : ""}
</a>`;
  }).join("\n");

  const features = (
    [
      ["cursor", "live"],
      ["displays", "displays"],
      ["leaf", "power"],
      ["shield", "safe"],
      ["layers", "extras"],
      ["heart", "free"],
    ] as const
  )
    .map(
      ([ic, k]) => `<li class="feat">
  <span class="feat__icon">${icon(ic)}</span>
  <div><h3>${e(t(`feat.${k}.title` as never))}</h3><p>${e(t(`feat.${k}.body` as never))}</p></div>
</li>`,
    )
    .join("\n");

  const faqs = [1, 2, 3, 4, 5, 6]
    .map(
      (n) => `<details class="faq__item"${n === 1 ? " open" : ""}>
  <summary><span>${e(t(`faq.q${n}` as never))}</span>${icon("chevron", "icon faq__chev")}</summary>
  <p>${e(t(`faq.a${n}` as never))}</p>
</details>`,
    )
    .join("\n");

  const body = `
<section class="hero" data-hero>
  <div class="hero__poster" aria-hidden="true"></div>
  <canvas class="hero__canvas" data-hero-canvas aria-hidden="true"></canvas>
  <div class="hero__veil" aria-hidden="true"></div>
  <div class="hero__content wrap" data-parallax>
    <h1 class="hero__title">${e(t("hero.title"))}</h1>
    <p class="hero__lede">${e(t("hero.lede"))}</p>
    <div class="hero__actions">
      <a class="btn btn--light btn--lg" href="/download">${icon("download")}<span>${e(t("hero.cta"))}</span></a>
      <a class="btn btn--glass btn--lg" href="/community">${e(t("hero.browse"))}</a>
    </div>
    <p class="hero__note">${e(t("hero.ctaNote"))}</p>
  </div>
  <div class="hero__widget wrap">
    <p class="hero__hint">${icon("cursor", "icon icon--sm")}<span>${e(t("hero.hint"))}</span></p>
    <button type="button" class="iconbtn iconbtn--glass" data-hero-toggle aria-pressed="false" aria-label="${e(t("hero.pause"))}" data-label-pause="${e(t("hero.pause"))}" data-label-play="${e(t("hero.play"))}">${icon("pause", "icon i-pause")}${icon("play", "icon i-play")}</button>
  </div>
</section>

<section class="section wrap" aria-labelledby="show-h">
  <div class="section__head">
    <div><h2 id="show-h" class="h2">${e(t("show.title"))}</h2><p class="lede">${e(t("show.lede"))}</p></div>
    <a class="btn btn--glass" href="/community">${e(t("show.all"))}</a>
  </div>
  ${showcase}
</section>

<section class="cute" aria-labelledby="cute-h">
  <div class="cute__sky" aria-hidden="true"><span class="cloud c1"></span><span class="cloud c2"></span><span class="cloud c3"></span><span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span></div>
  <div class="wrap cute__inner">
    <div class="cute__head">
      <h2 id="cute-h" class="cute__title">${e(t("cat.cute"))}</h2>
      <p class="cute__lede">${e(t("cute.lede"))}</p>
      <a class="btn btn--candy" href="/community?category=cute">${e(t("cute.cta"))}</a>
    </div>
    ${data.cute.length ? `<div class="cute__grid">${data.cute.map((w) => card(ctx, w)).join("\n")}</div>` : ""}
  </div>
</section>

<section class="section wrap" aria-labelledby="moods-h">
  <div class="section__head"><h2 id="moods-h" class="h2">${e(t("cats.title"))}</h2></div>
  <div class="moods">${moods}</div>
</section>

<section class="section wrap features" aria-labelledby="feat-h">
  <h2 id="feat-h" class="h2 features__title">${e(t("feat.title"))}</h2>
  <ul class="features__list">${features}</ul>
</section>

<section class="section wrap" aria-labelledby="steps-h">
  <h2 id="steps-h" class="h2">${e(t("steps.title"))}</h2>
  <ol class="steps">
    ${[1, 2, 3]
      .map(
        (n) => `<li class="step"><span class="step__n" aria-hidden="true">${n}</span><h3>${e(t(`steps.${n}.title` as never))}</h3><p>${e(t(`steps.${n}.body` as never))}</p></li>`,
      )
      .join("\n")}
  </ol>
  <div class="steps__cta"><a class="btn btn--light btn--lg" href="/download">${icon("download")}<span>${e(t("hero.cta"))}</span></a><span class="muted">${e(t("hero.ctaNote"))}</span></div>
</section>

<section class="section wrap duo">
  <div class="duo__item duo__item--oss">
    ${GITHUB_LOGO.replace('class="icon"', 'class="duo__mark"')}
    <h2 class="h3">${e(t("oss.title"))}</h2>
    <p>${e(t("oss.body"))}</p>
    <a class="btn btn--glass" href="${REPO_URL}" rel="noopener">${e(t("oss.cta"))}</a>
  </div>
  <div class="duo__item duo__item--make">
    ${icon("code", "duo__mark")}
    <h2 class="h3">${e(t("make.title"))}</h2>
    <p>${e(t("make.body"))}</p>
    <a class="btn btn--glass" href="/community/upload">${e(t("make.cta"))}</a>
  </div>
</section>

<section class="section wrap faq" aria-labelledby="faq-h">
  <h2 id="faq-h" class="h2">${e(t("faq.title"))}</h2>
  <div class="faq__list">${faqs}</div>
</section>
${installModal(ctx)}`;

  const footAd = ad(ctx, "footer");
  return page(
    ctx,
    { title: "", path: "/", body, scripts: ["/assets/js/hero.js"], adSlots: ["footer"], nav: "home", bodyClass: "is-landing" },
    footAd ? `<div class="wrap ad-wrap">${footAd}</div>` : "",
  );
}

// ---------------------------------------------------------------------------
// Community browse
// ---------------------------------------------------------------------------
const FIRST_ROWS = 8;

export function browsePage(ctx: Ctx, data: { items: WallpaperSummary[]; next: string | null; sort: string; q: string; category: string }): Response {
  const { t } = ctx;
  const a = data.items.slice(0, FIRST_ROWS);
  const b = data.items.slice(FIRST_ROWS);
  const extra = new URLSearchParams();
  if (data.q) extra.set("q", data.q);
  if (data.sort === "popular") extra.set("sort", "popular");
  const title = data.category !== "all" ? catLabel(ctx, data.category) : t("browse.title");
  const body = `
<section class="pagehead wrap">
  <div class="pagehead__glow" aria-hidden="true"></div>
  <h1 class="h1">${e(title)}</h1>
  <p class="lede">${e(t("browse.lede"))}</p>
  <form class="filters" role="search" action="/community" method="get" data-filters>
    <label class="search">
      <span class="sr">${e(t("browse.search"))}</span>
      ${icon("search")}
      <input type="search" name="q" value="${e(data.q)}" placeholder="${e(t("browse.searchPlaceholder"))}" maxlength="100" autocomplete="off" enterkeyhint="search">
    </label>
    ${data.category !== "all" ? `<input type="hidden" name="category" value="${e(data.category)}">` : ""}
    <label class="select">
      <span class="sr">${e(t("browse.sort"))}</span>
      <select name="sort" data-sort>
        <option value="new"${data.sort !== "popular" ? " selected" : ""}>${e(t("browse.sortNew"))}</option>
        <option value="popular"${data.sort === "popular" ? " selected" : ""}>${e(t("browse.sortPopular"))}</option>
      </select>
      ${icon("chevron", "icon icon--sm")}
    </label>
    <noscript><button class="btn btn--glass" type="submit">${e(t("browse.search"))}</button></noscript>
  </form>
  ${chips(ctx, data.category, "/community", extra)}
</section>

<section class="wrap gallery" data-gallery data-next="${e(data.next ?? "")}" aria-live="polite" aria-busy="false">
  <h2 class="sr">${e(title)}</h2>
  <div class="grid" data-grid-a>${a.map((w, i) => card(ctx, w, { eager: i < 3 })).join("\n")}</div>
  ${ad(ctx, "browse")}
  <div class="grid" data-grid-b>${b.map((w) => card(ctx, w)).join("\n")}</div>
  <div class="emptybox" data-empty${data.items.length ? " hidden" : ""}>
    ${icon("search", "icon icon--lg")}
    <h3>${e(t("browse.emptyTitle"))}</h3>
    <p>${e(t("browse.emptyBody"))}</p>
    <a class="btn btn--glass" href="/community/upload">${e(t("make.cta"))}</a>
  </div>
  <div class="gallery__foot">
    <button type="button" class="btn btn--glass" data-more${data.next ? "" : " hidden"}>${e(t("browse.loadMore"))}</button>
    <p class="muted" data-end${!data.next && data.items.length ? "" : " hidden"}>${e(t("browse.end"))}</p>
    <p class="error" data-error role="alert" hidden>${e(t("browse.error"))} <button type="button" class="linkbtn" data-retry>${e(t("browse.retry"))}</button></p>
  </div>
  <div class="sentinel" data-sentinel aria-hidden="true"></div>
</section>
${installModal(ctx)}`;
  return page(ctx, {
    title,
    description: t("browse.lede"),
    path: "/community",
    body,
    scripts: ["/assets/js/browse.js"],
    adSlots: ["browse"],
    nav: "community",
  });
}

// ---------------------------------------------------------------------------
// Wallpaper detail
// ---------------------------------------------------------------------------
export function detailPage(ctx: Ctx, w: WallpaperDetail, more: WallpaperSummary[], rejectReason: string | null): Response {
  const { t } = ctx;
  const notice =
    w.status === "pending"
      ? `<p class="notice notice--warn">${icon("clock")}<span>${e(t("detail.pending"))}</span></p>`
      : w.status === "rejected"
        ? `<p class="notice notice--bad">${icon("alert")}<span>${e(t("detail.rejected", { reason: rejectReason || "-" }))}</span></p>`
        : "";
  const tags = w.tags.length
    ? `<ul class="tags">${w.tags.map((tg) => `<li><a href="/community?q=${encodeURIComponent(tg)}">#${e(tg)}</a></li>`).join("")}</ul>`
    : "";
  const size = w.sizeBytes >= 1024 * 1024 ? `${(w.sizeBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(w.sizeBytes / 1024))} KB`;
  const body = `
<div class="detail wrap" data-detail data-id="${e(w.id)}">
  <a class="back" href="/community">${icon("arrowLeft", "icon icon--sm")}<span>${e(t("detail.back"))}</span></a>
  <div class="detail__grid">
    <div class="detail__stage">
      <div class="display" data-display>
        <div class="display__screen">
          <img class="display__poster" src="${e(w.thumbUrl)}" alt="" width="1600" height="1000" fetchpriority="high">
          <iframe class="display__frame" data-live-frame title="${e(t("card.previewing"))}: ${e(w.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="eager" src="/preview/${e(w.id)}"></iframe>
        </div>
        <div class="display__bar">
          <p class="display__note">${icon("cursor", "icon icon--sm")}<span>${e(t("detail.previewNote"))}</span></p>
          <button type="button" class="btn btn--ghost btn--sm" data-fullscreen>${icon("expand")}<span>${e(t("detail.fullscreen"))}</span></button>
        </div>
      </div>
    </div>
    <aside class="detail__side">
      ${notice}
      <p class="detail__cat"><a class="chip chip--${e(w.category)}" href="/community?category=${e(w.category)}"><span class="chip__dot" aria-hidden="true"></span>${e(catLabel(ctx, w.category))}</a></p>
      <h1 class="detail__title">${e(w.title)}</h1>
      <p class="detail__author">${e(t("card.by", { name: w.author.name }))}</p>
      <div class="detail__cta">
        <button type="button" class="btn btn--light btn--lg btn--block" data-install="${e(w.id)}" data-title="${e(w.title)}"${w.status !== "approved" ? " disabled" : ""}>${icon("install")}<span>${e(t("detail.install"))}</span></button>
        <p class="detail__noapp">${e(t("detail.noApp"))} <a href="/download">${e(t("detail.noAppLink"))}</a></p>
      </div>
      <p class="detail__safe">${icon("shield", "icon icon--sm")}<span>${e(t("detail.safe"))}</span></p>
      <dl class="facts">
        <div><dt>${e(t("detail.downloads"))}</dt><dd>${e(fmtCount(ctx, w.downloads))}</dd></div>
        <div><dt>${e(t("detail.published"))}</dt><dd><time datetime="${e(w.createdAt)}">${e(fmtDate(ctx, w.createdAt))}</time></dd></div>
        <div><dt>${e(t("detail.size"))}</dt><dd>${e(size)}</dd></div>
        <div><dt>${e(t("detail.version"))}</dt><dd>${w.version}</dd></div>
      </dl>
      ${tags ? `<div class="detail__tags"><h2 class="sr">${e(t("detail.tags"))}</h2>${tags}</div>` : ""}
      <button type="button" class="btn btn--ghost btn--sm" data-share data-copied="${e(t("detail.copied"))}">${icon("link")}<span>${e(t("detail.share"))}</span></button>
    </aside>
  </div>
  ${
    w.description
      ? `<section class="about" aria-labelledby="about-h"><h2 id="about-h" class="h3">${e(t("detail.about"))}</h2><p class="about__text" dir="auto">${e(w.description)}</p></section>`
      : ""
  }
  ${
    more.length
      ? `<section class="section more" aria-labelledby="more-h"><div class="section__head"><h2 id="more-h" class="h2">${e(t("detail.more"))}</h2><a class="btn btn--glass" href="/community?category=${e(w.category)}">${e(catLabel(ctx, w.category))}</a></div><div class="grid grid--4">${more.map((m) => card(ctx, m)).join("\n")}</div></section>`
      : ""
  }
  ${ad(ctx, "detail")}
</div>
${installModal(ctx)}`;
  return page(ctx, {
    title: w.title,
    description: (w.description || t("meta.description")).slice(0, 180),
    path: `/community/w/${w.id}`,
    body,
    scripts: ["/assets/js/detail.js"],
    adSlots: w.status === "approved" ? ["detail"] : [],
    ogImage: w.thumbUrl,
    noindex: w.status !== "approved",
    nav: "community",
  });
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------
export function signinPanel(ctx: Ctx, providers: ProviderId[], dev: boolean, next: string, heading: "signin" | "upload"): string {
  const { t } = ctx;
  const q = `?next=${encodeURIComponent(next)}`;
  const buttons = [
    providers.includes("google") ? `<a class="btn btn--provider" href="/auth/google/start${q}">${GOOGLE_LOGO}<span>${e(t("signin.google"))}</span></a>` : "",
    providers.includes("github") ? `<a class="btn btn--provider" href="/auth/github/start${q}">${GITHUB_LOGO}<span>${e(t("signin.github"))}</span></a>` : "",
  ].join("");
  const devForm = dev
    ? `<form class="devlogin" method="post" action="/auth/dev">
  <p class="devlogin__title">${icon("code", "icon icon--sm")}<span>${e(t("signin.dev"))}</span></p>
  <p class="muted small">${e(t("signin.devNote"))}</p>
  <input type="hidden" name="next" value="${e(next)}">
  <label class="field"><span>${e(t("signin.devEmail"))}</span><input type="email" name="email" required maxlength="254" value="admin@example.com" autocomplete="email"></label>
  <label class="field"><span>${e(t("signin.devName"))}</span><input type="text" name="name" required maxlength="40" value="Dev Creator" autocomplete="nickname"></label>
  <button class="btn btn--glass btn--block" type="submit">${e(t("signin.devSubmit"))}</button>
</form>`
    : "";
  const none = !buttons && !dev ? `<p class="notice notice--warn">${icon("alert")}<span>${e(t("signin.none"))}</span></p>` : "";
  const error = ctx.url.searchParams.get("error") ? `<p class="notice notice--bad" role="alert">${icon("alert")}<span>${e(t("signin.error"))}</span></p>` : "";
  return `<div class="signin">
  <div class="signin__orb" aria-hidden="true"></div>
  <h1 class="h2">${e(heading === "upload" ? t("up.signinTitle") : t("signin.title"))}</h1>
  <p class="lede">${e(heading === "upload" ? t("up.signinBody") : t("signin.lede"))}</p>
  ${error}
  <div class="signin__buttons">${buttons}</div>
  ${none}
  ${devForm}
  <p class="muted small">${e(t("signin.privacy"))} <a href="/privacy">${e(t("foot.privacy"))}</a></p>
</div>`;
}

export function signinPage(ctx: Ctx, providers: ProviderId[], dev: boolean, next: string): Response {
  return page(ctx, {
    title: ctx.t("meta.signinTitle"),
    path: "/signin",
    noindex: true,
    body: `<section class="wrap narrow pad">${signinPanel(ctx, providers, dev, next, "signin")}</section>`,
  });
}

// ---------------------------------------------------------------------------
// Upload (creators)
// ---------------------------------------------------------------------------
export function uploadPage(ctx: Ctx, signedIn: boolean, providers: ProviderId[], dev: boolean): Response {
  const { t } = ctx;
  if (!signedIn) {
    return page(ctx, {
      title: t("meta.uploadTitle"),
      path: "/community/upload",
      body: `<section class="wrap narrow pad">${signinPanel(ctx, providers, dev, "/community/upload", "upload")}</section>`,
      nav: "upload",
    });
  }
  const options = CATEGORIES.map((c) => `<option value="${c}">${e(catLabel(ctx, c))}</option>`).join("");
  const body = `
<section class="pagehead wrap">
  <div class="pagehead__glow" aria-hidden="true"></div>
  <h1 class="h1">${e(t("up.title"))}</h1>
  <p class="lede">${e(t("up.lede"))}</p>
</section>
<div class="wrap upload" data-upload>
  <form class="upload__form" data-upload-form novalidate>
    <div class="drop" data-drop="file">
      <input class="drop__input" id="f-file" type="file" name="file" accept=".html,.htm,text/html" required>
      <label class="drop__zone" for="f-file">
        ${icon("file", "icon icon--lg")}
        <span class="drop__label">${e(t("up.fileLabel"))}</span>
        <span class="drop__cta" data-drop-text>${e(t("up.fileDrop"))}</span>
      </label>
      <p class="hint" id="f-file-hint">${e(t("up.fileHint"))}</p>
      <p class="fielderr" data-err-for="file" role="alert"></p>
    </div>
    <div class="drop drop--thumb" data-drop="thumb">
      <input class="drop__input" id="f-thumb" type="file" name="thumb" accept="image/png,image/jpeg,image/webp" required>
      <label class="drop__zone" for="f-thumb">
        <img class="drop__img" alt="" data-thumb-preview hidden>
        ${icon("image", "icon icon--lg")}
        <span class="drop__label">${e(t("up.thumbLabel"))}</span>
        <span class="drop__cta" data-drop-text>${e(t("up.thumbDrop"))}</span>
      </label>
      <p class="hint">${e(t("up.thumbHint"))}</p>
      <p class="fielderr" data-err-for="thumb" role="alert"></p>
    </div>
    <label class="field"><span>${e(t("up.titleLabel"))} <b aria-hidden="true">*</b></span><input name="title" required maxlength="${MAX_TITLE}" autocomplete="off"><em class="fielderr" data-err-for="title" role="alert"></em></label>
    <label class="field"><span>${e(t("up.categoryLabel"))} <b aria-hidden="true">*</b></span>
      <span class="select select--field"><select name="category" required><option value="">${e(t("up.categoryChoose"))}</option>${options}</select>${icon("chevron", "icon icon--sm")}</span>
      <em class="fielderr" data-err-for="category" role="alert"></em></label>
    <label class="field"><span>${e(t("up.descLabel"))}</span><textarea name="description" rows="4" maxlength="${MAX_DESCRIPTION}"></textarea><small class="hint">${e(t("up.descHint"))}</small><em class="fielderr" data-err-for="description" role="alert"></em></label>
    <label class="field"><span>${e(t("up.tagsLabel"))}</span><input name="tags" maxlength="220" placeholder="cozy, rain, lofi" autocomplete="off"><small class="hint">${e(t("up.tagsHint"))}</small><em class="fielderr" data-err-for="tags" role="alert"></em></label>
    <div class="rules">
      <h2 class="h4">${e(t("up.rulesTitle"))}</h2>
      <ul><li>${e(t("up.rule1"))}</li><li>${e(t("up.rule2"))}</li><li>${e(t("up.rule3"))}</li></ul>
    </div>
    <p class="formerr" data-form-error role="alert" hidden></p>
    <button class="btn btn--light btn--lg btn--block" type="submit" data-submit>${icon("upload")}<span>${e(t("up.submit"))}</span></button>
  </form>
  <aside class="upload__preview">
    <div class="display display--small">
      <div class="display__screen" data-local-preview>
        <div class="display__empty">${icon("sparkle", "icon icon--lg")}<p>${e(t("up.previewEmpty"))}</p></div>
      </div>
      <div class="display__bar"><p class="display__note">${icon("shield", "icon icon--sm")}<span>${e(t("up.previewNote"))}</span></p></div>
    </div>
  </aside>
  <section class="upload__done" data-upload-done hidden tabindex="-1">
    ${icon("check", "icon icon--xl")}
    <h2 class="h2">${e(t("up.successTitle"))}</h2>
    <p class="lede">${e(t("up.successBody"))}</p>
    <div class="row"><a class="btn btn--light" href="/community/mine">${e(t("up.successCta"))}</a><a class="btn btn--glass" href="/community/upload">${e(t("up.another"))}</a></div>
  </section>
</div>`;
  return page(ctx, { title: t("meta.uploadTitle"), path: "/community/upload", body, scripts: ["/assets/js/upload.js"], nav: "upload", noindex: true });
}

export function minePage(ctx: Ctx): Response {
  const { t } = ctx;
  return page(ctx, {
    title: t("mine.title"),
    path: "/community/mine",
    noindex: true,
    nav: "upload",
    scripts: ["/assets/js/mine.js"],
    body: `<section class="pagehead wrap"><div class="pagehead__glow" aria-hidden="true"></div><h1 class="h1">${e(t("mine.title"))}</h1><p class="lede">${e(t("mine.lede"))}</p>
  <a class="btn btn--light" href="/community/upload">${icon("upload")}<span>${e(t("nav.upload"))}</span></a></section>
<section class="wrap"><ul class="rows" data-mine aria-busy="true"><li class="rows__loading">${e(t("browse.loading"))}</li></ul></section>`,
  });
}

export function adminPage(ctx: Ctx): Response {
  const { t } = ctx;
  return page(ctx, {
    title: t("admin.title"),
    path: "/community/admin",
    noindex: true,
    scripts: ["/assets/js/admin.js"],
    body: `<section class="pagehead wrap"><div class="pagehead__glow" aria-hidden="true"></div><h1 class="h1">${e(t("admin.title"))}</h1><p class="lede">${e(t("admin.lede"))}</p></section>
<section class="wrap"><div class="queue" data-queue aria-busy="true"><p class="muted">${e(t("browse.loading"))}</p></div></section>`,
  });
}

export function forbiddenPage(ctx: Ctx): Response {
  const { t } = ctx;
  return page(ctx, {
    title: t("admin.title"),
    path: "/community/admin",
    noindex: true,
    status: 403,
    body: `<section class="empty-hero"><div class="empty-hero__glow" aria-hidden="true"></div><h1>${e(t("admin.forbidden"))}</h1><a class="btn btn--light" href="/">${e(t("nf.home"))}</a></section>`,
  });
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------
export const PRIVACY_UPDATED = "2026-11-02";

export function privacyPage(ctx: Ctx): Response {
  const { t } = ctx;
  const sec = (k: string) => `<section><h2 class="h3">${e(t(`privacy.${k}Title` as never))}</h2><p>${e(t(`privacy.${k}Body` as never))}</p></section>`;
  const body = `<article class="wrap narrow pad prose">
  <h1 class="h1">${e(t("privacy.title"))}</h1>
  <p class="muted">${e(t("privacy.updated", { date: fmtDate(ctx, PRIVACY_UPDATED + "T00:00:00Z") }))}</p>
  <p class="lede">${e(t("privacy.intro"))}</p>
  ${sec("collect")}
  ${sec("cookies")}
  <section><h2 class="h3">${e(t("privacy.adsTitle"))}</h2><p>${e(t("privacy.adsBody"))}</p>
    <ul><li><a href="https://adssettings.google.com/" rel="noopener">${e(t("privacy.adsSettings"))}</a></li><li><a href="https://policies.google.com/technologies/partner-sites" rel="noopener">${e(t("privacy.adsPartner"))}</a></li></ul>
  </section>
  ${sec("app")}
  <section><h2 class="h3">${e(t("privacy.choicesTitle"))}</h2><p>${e(t("privacy.choicesBody"))}</p>
    ${ctx.ads ? `<p><button type="button" class="btn btn--glass" data-consent-open>${e(t("foot.cookies"))}</button></p>` : ""}
  </section>
  <section><h2 class="h3">${e(t("privacy.contactTitle"))}</h2><p>${e(t("privacy.contactBody"))} <a href="${REPO_URL}/issues" rel="noopener">GitHub</a></p></section>
</article>`;
  return page(ctx, { title: t("meta.privacyTitle"), path: "/privacy", body });
}

export function downloadSoonPage(ctx: Ctx): Response {
  const { t } = ctx;
  return page(ctx, {
    title: t("dl.soonTitle"),
    path: "/download",
    status: 404,
    noindex: true,
    body: `<section class="empty-hero"><div class="empty-hero__glow" aria-hidden="true"></div>${icon("download", "icon icon--xl")}<h1>${e(t("dl.soonTitle"))}</h1><p class="lede">${e(t("dl.soonBody"))}</p><p class="muted">${e(t("install.requirements"))}</p><a class="btn btn--light" href="/community">${e(t("dl.soonCta"))}</a></section>`,
  });
}

export { jsonBlock };
