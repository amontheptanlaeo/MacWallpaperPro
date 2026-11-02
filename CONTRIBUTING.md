# Contributing to MacWallpaperPro

Thanks for helping. You can contribute code, wallpapers, translations, bug reports and ideas.
Please read and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

- **Security problems:** never in a public issue. Use [private vulnerability reporting](SECURITY.md).
- **A harmful or infringing Community wallpaper:** use the "Report a Community wallpaper" issue form.
- **All Markdown, code comments and script messages are in English.** Translations live only in the
  JSON translation files.

## Licensing of contributions

MacWallpaperPro is licensed under the [GNU General Public License v3.0](LICENSE). By opening a pull
request you agree that your contribution is released under GPL-3.0, and you confirm that you have the
right to submit it (it is your own work, or compatible with GPL-3.0 and credited). Wallpapers you
submit to the Community website stay yours; see the upload page for the terms there. The
MacWallpaperPro name and logo are not covered by the GPL ([TRADEMARKS.md](TRADEMARKS.md)).

## Repository layout

| Path | What it is |
|---|---|
| `Sources/MacWallpaperPro/` | The macOS app (Swift 6, SwiftUI + AppKit) |
| `Localization/<code>.json` | App translations (English key → translation), 17 languages |
| `Wallpapers/<slug>/` | Built-in and launch Community wallpapers (`index.html`, `thumb.jpg`, `wallpaper.json`) |
| `web/` | Website, Community store and API: a Cloudflare Worker + D1 + R2 ([web/README.md](web/README.md)) |
| `docs/ARCHITECTURE.md` | App ↔ server contract, manifest signing, security model |
| `scripts/` | Repo tools (`check-localization.py`, `make-icon.swift`) |

## The macOS app

Requirements: macOS 15 or later and Xcode 16 or later (Swift 6 toolchain).

```sh
swift build                      # quick compile check (what CI runs)
./build.sh                       # builds build/MacWallpaperPro.app (signed ad-hoc without a Developer ID)
open build/MacWallpaperPro.app
python3 scripts/check-localization.py   # every tr("…") string exists in all 17 Localization/*.json
```

- Every user-facing string goes through `tr("English text")` (or `tr("Installed “%@”.", value)` with
  `%@` / `%d` placeholders). Keys must be plain string literals (no `\(…)` interpolation).
- Use the components and tokens in `DesignSystem.swift` (see `design-system/MASTER.md`); don't
  hard-code colors or spacing in views. Give icon-only buttons an accessibility label.
- Never add network access for installed wallpapers, and keep `Process` calls to fixed paths with
  fixed arguments.
- Point the app at a local website with `MWP_COMMUNITY_URL=http://localhost:8787`.

## The website (`web/`)

Requirements: Node.js 22.

```sh
cd web
npm ci
npm run check:i18n               # every language has every key with the same {placeholders}
npm run typecheck
npm test                         # i18n check + vitest in the Workers runtime (local D1/R2, mocked OAuth)
```

The tests sign manifests with `secrets/signing-private-pkcs8.b64` when it exists (maintainers only)
and otherwise generate an ephemeral Ed25519 key, so they run anywhere without secrets. For a local
site, see "Local development" in [web/README.md](web/README.md) (`npm run setup`, `npm run dev`).

Rules for web changes:

- Every SQL statement uses `?` binds. Every HTML template escapes its values (`escapeHtml` on the
  server, `esc()` in browser JS).
- Every state-changing route is non-GET (the router checks `Origin` for all of them).
- Keep the CPU cost per request tiny (Workers free plan): no heavy crypto or per-request parsing of
  large data; put background writes in `ctx.waitUntil`.
- New tables or columns go in a **new** migration file (`web/migrations/000N_*.sql`). Never edit a
  migration that is already deployed, and keep changes additive so the running Worker keeps working.
- Stay backward compatible with installed app versions (`docs/ARCHITECTURE.md` is the contract).

## Making a wallpaper

A wallpaper is a single self-contained `index.html`:

- At most **10 MB**, UTF-8, with an `<html>` tag. Inline everything (scripts, styles, images as
  `data:` URLs). **No external requests**: the app blocks all network access, and the moderation
  scanner flags `fetch`, `XMLHttpRequest`, `WebSocket`, external URLs, `eval`, `Function`, `import()`,
  `atob`, `location` changes and similar APIs.
- It receives real `mousemove`, `mousedown`, `mouseup` and `click` events from the cursor (clicks
  only when they land on the desktop). Optionally define `window.setP = ({ speed }) => …` to follow
  the app's speed setting.
- It should look good at any 16:10 to 21:9 size, run smoothly on battery (respect
  `prefers-reduced-motion`, avoid busy loops) and contain only work you have the rights to.
- Thumbnail: PNG, JPEG or WebP, at most 2 MB, ideally 1600 × 1000.
- Categories: `cute`, `nature`, `cartoon`, `space`, `scifi`, `abstract`.

Video wallpapers are MP4/MOV files (≤ 60 MB, H.264/HEVC, no audio needed) with a credit, a license
and an optional source link; you must own the video or it must be public domain / CC0.

Submit wallpapers at <https://macwallpaper.elizos.com/community/upload>. Every upload is reviewed by
a moderator before it is published. To propose a **built-in** wallpaper by pull request, add
`Wallpapers/<slug>/index.html`, `thumb.jpg` and `wallpaper.json`
(`{ "id", "title", "description", "tags": [], "category" }`).

## Translations

The app and the website support 17 languages: en, th, zh-Hans, zh-Hant, ja, ko, es, fr, de, it,
pt-BR, ru, tr, id, vi, hi, ar (right-to-left).

- App: `Localization/<code>.json`. The key is the exact English string from `tr("…")`; the value is
  the translation. Keep placeholders (`%@`, `%d`, `%1$@`) identical. Check with
  `python3 scripts/check-localization.py`.
- Website: `web/public/i18n/<code>.json`, keyed like `nav.upload`. Keep `{placeholders}` identical.
  Check with `cd web && npm run check:i18n`.
- When you add a string, add it to **all 17 files** in the same pull request (CI fails otherwise).
  If you can't translate a language, say so in the PR and a maintainer will help; don't leave the
  English text in another language's file without saying so.
- To fix a translation, edit only that language's file.

## Pull requests

1. Fork, create a branch from `main`, and keep the change focused.
2. Run the checks for what you touched (see above). CI runs them too.
3. Fill in the pull request template. Include screenshots for UI changes.
4. A maintainer (see `.github/CODEOWNERS`) reviews it.

Checklist:

- [ ] `swift build` passes and `python3 scripts/check-localization.py` is clean (app changes)
- [ ] `npm run check:i18n`, `npm run typecheck` and `npm test` pass in `web/` (website changes)
- [ ] New user-facing strings are translated in all 17 languages
- [ ] New database changes are in a new migration and are additive
- [ ] Still compatible with installed app versions and `docs/ARCHITECTURE.md`
- [ ] Docs and `CHANGELOG.md` (Unreleased) are updated when behavior changes
- [ ] No secrets, personal data or third-party content you can't license under GPL-3.0
