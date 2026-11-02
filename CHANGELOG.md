# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
App versions are tagged `vX.Y.Z`; the website is deployed continuously and its changes are listed
in the same sections.

## [Unreleased]

### Added
- **Video wallpapers**: MP4/MOV Community wallpapers (up to 60 MB) with credit and license, signed
  with manifest v2 (the kind is part of the signature), streamed to disk while hashing, played muted
  and looping with AVPlayer. Two-step uploads that stream straight into R2 with server-side SHA-256
  verification. Installed app builds that predate video never see video items.
- **Download statistics** for moderators at `/community/admin/stats` and `GET /api/admin/stats`
  (7/30/90 days): app downloads, wallpaper installs and page views by day, country, referrer host
  and `utm_source`, top wallpapers, plus GitHub's own release download count (cached 10 minutes).
  Aggregates only: no IP address, user agent or per-person row is stored.
- **Delete my account** on "My uploads": removes the account, its sessions and every upload
  (database rows and stored files) after a confirmation step.
- The app asks for confirmation (title, author, thumbnail, Install / Cancel) before installing from a
  `macwallpaperpro://install` link. In-app Get buttons stay one-click.
- More advisory scanner rules for moderators: API names built from string pieces, bare `Function(`,
  bracket access on `window`/`globalThis`/`self`, `atob(`, `location` changes,
  `<meta http-equiv="refresh">` and `<base>`. The moderation queue states that a clean scan is not
  proof of safety.
- `Strict-Transport-Security: max-age=31536000` on every Worker response and static asset
  (without `includeSubDomains`, so other `*.elizos.com` services are not affected).
- CI on every push and pull request (website: i18n check, typecheck, tests; app: `swift build` and
  the localization key check), with actions pinned to commit SHAs and read-only permissions.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), issue forms (bug, feature,
  Community wallpaper report), a pull request template, `CODEOWNERS`, this changelog,
  `scripts/check-localization.py` and README screenshots and install steps.
- Database migration `0003_stats.sql` (additive).
- Optional support links (GitHub Sponsors and Ko-fi): `.github/FUNDING.yml` (the repo's Sponsor
  button), a "Support MacWallpaperPro" card in the app's Settings › About, a "Support" link in the
  website footer and a "Support the project" section on the landing page, and a README section.
  No popups or prompts.

### Changed
- Download counts are deduplicated: one per IP, wallpaper and UTC day, using a salted SHA-256 that
  is kept for at most two days (optional `DOWNLOAD_SALT` secret).
- Admin rights follow `ADMIN_EMAILS` on every request and sign-in, so removing an address demotes
  that account immediately. `ADMIN_EMAILS` is documented as a secret, never a `wrangler.jsonc` var.
- `/preview/:id` and `/preview-sandbox` send `frame-ancestors 'self'`; the upload preview shell only
  accepts HTML from its own parent frame on the site's origin.
- The privacy page describes the anonymous statistics and points to self-service deletion and a
  private GitHub contact instead of public issues.
- `release.sh` reads `TEAM_ID`, `SIGN_IDENTITY`, `ASC_KEY_ID`, `ASC_ISSUER` and `ASC_KEY_PATH` from
  the environment (the maintainer's values are only defaults) and writes `dist/MacWallpaperPro.zip`,
  the asset name GitHub Releases needs, with a `gh release create` hint.
- Web tests generate an ephemeral Ed25519 key when the signing secret is absent.
- All code comments and script messages are in English.
- Documentation: the site is live, root-domain forwarding and AdSense setup, deploy order.

### Fixed
- Open redirect on the root-domain forwarding (`https://elizos.com//evil.example`).
- `limit`, `cursor` and `days` values that are not valid numbers return 400 instead of 500.

### Security
- See [docs/security-review-2026-11-02.md](docs/security-review-2026-11-02.md) for the review these
  fixes come from.

## [1.0.0] - 2026-11-02

### Added
- First public release of the macOS app: interactive live wallpapers (WebGL/Canvas scenes that react
  to the cursor), video and web-page wallpapers, desktop clock, focused-window border, keyboard
  window snapping, menu bar icon hiding and a custom menu bar, auto-quit, lock-screen image, and
  17 languages with live switching (including right-to-left Arabic).
- Free Community store: browse, preview and install wallpapers with no account; every file is
  reviewed, Ed25519-signed and SHA-256 verified, and installed wallpapers run offline with all
  network access blocked.
- Website at <https://macwallpaper.elizos.com> (Cloudflare Worker + D1 + R2): gallery, uploads for
  signed-in creators (Google or GitHub), moderation queue, privacy policy, 17 languages, AdSense.
- 18 new Community wallpapers, GPL-3.0 license, security and trademark policies.

[Unreleased]: https://github.com/amontheptanlaeo/MacWallpaperPro/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/amontheptanlaeo/MacWallpaperPro/releases/tag/v1.0.0
