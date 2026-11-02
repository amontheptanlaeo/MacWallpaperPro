# Security Policy

Thank you for helping keep MacWallpaperPro and its users safe.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:
**[Report a vulnerability](https://github.com/amontheptanlaeo/MacWallpaperPro/security/advisories/new)**
(Security tab → "Report a vulnerability")

Include what you found, steps to reproduce, and the impact you expect. We aim to reply within 3 days and to ship a fix for confirmed issues as soon as possible. We'll credit you in the release notes unless you prefer to stay anonymous.

## Scope

In scope:
- The macOS app (`Sources/`): wallpaper sandbox (network blocking), signature and hash verification of Community downloads, deep links (`macwallpaperpro://`), Accessibility-based features
- The website and API (`web/`, https://macwallpaper.elizos.com): authentication, uploads, moderation, downloads, previews
- Community wallpapers that escape the sandbox or bypass review

Out of scope: denial of service by volume, social engineering, issues in third-party services (Cloudflare, GitHub, Google), and findings that need a compromised Mac.

## Supported versions

Only the latest release receives security fixes.

---

# นโยบายความปลอดภัย (ภาษาไทย)

**อย่าเปิด issue สาธารณะสำหรับปัญหาความปลอดภัย** แจ้งแบบส่วนตัวผ่านปุ่ม
[Report a vulnerability](https://github.com/amontheptanlaeo/MacWallpaperPro/security/advisories/new)
ในแท็บ Security ของ repo นี้ เราจะตอบกลับภายใน 3 วัน และให้เครดิตผู้แจ้งในบันทึกการอัปเดต
