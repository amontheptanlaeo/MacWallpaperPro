# MacWallpaperPro — Design System (macOS app)

Generated with ui-ux-pro-max (`--design-system "desktop app media gallery wallpaper personalization modern clean dark minimal content-first"`), adapted for a native macOS app.

## Principle: content-first, calm chrome, one obvious action

The wallpapers are the star. The UI is quiet, dark, modern, and gets out of the way. **Nothing weird, nothing gimmicky, nothing that can glitch.** If a decision is in doubt, choose the simpler one.

## Navigation (simplest possible)

- **3 top-level destinations only:** `Library` · `Discover` · `Settings`.
  - The previous 9-item sidebar was an overloaded nav (`nav-hierarchy`, `bottom-nav-limit`).
- **Settings** is one page with grouped sections: Clock, Window borders, Window snapping, Menu bar (icon hiding + custom bar), Auto-quit, Lock screen, About.
  - Use a compact left list *inside* the Settings page, or a single scroll with section anchors.
- **Navigation control:** a slim custom top segmented tab bar centered in the titlebar area, or a slim left rail with icon and label. Pick one and keep it identical on every page (`navigation-consistency`).
  - The active state is clearly highlighted (`nav-state-active`).
- **Language picker:** flag + native name, in Settings › General and in the window's top-right corner.
- **Chrome:** no system NSToolbar items, no `NavigationSplitView`, no `.inspector`. Use a custom header with fixed, non-overlapping layout that adapts to width.

## Primary action per screen (`primary-action`)

| Screen | The one primary action |
|---|---|
| Library | Click a tile = set as wallpaper (instant). Selected tile shows a details panel with a clear **Set as wallpaper** / **In use** state. |
| Discover | **Get** on every tile (one click installs and applies). |
| Settings | None. Toggles apply instantly; no Save buttons. |

## Layout

- **Library and Discover:**
  - A "Now playing" strip at the top: current wallpaper thumbnail, name, and pause/play. Keep it compact, not a giant hero.
  - Below it, a responsive grid of 16:10 tiles with min width 220 and a 16 pt gap.
  - Details panel: a fixed 320 pt right column that slides in with an ease-out of about 250 ms, and closes with Esc or ✕.
  - Never let the panel cover tiles; the grid reflows.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Page padding 24.
- **Radius scale:** 8 (controls) / 12 (cards) / 16 (tiles, panels).
- **Elevation:** two levels only. Card: subtle 1 px border plus a soft shadow. Floating panel: a stronger shadow.

## Color (dark only, semantic tokens)

| Token | Value |
|---|---|
| background | `#0E0E12` |
| surface | `#17171D` |
| surfaceRaised | `#1F1F27` |
| border | `white @ 8%` |
| textPrimary | `#F5F5F7` (≥ 7:1) |
| textSecondary | `#A1A1AA` (≥ 4.5:1 on surface) |
| primary (accent) | `#7C3AED` → `#EC4899` gradient, used only for the selection pill, primary buttons and the Get button |
| success | `#22C55E` + icon |
| destructive | `#EF4444` + icon, separated from primary actions |

- Don't use raw hex inside views; define these as `Color` tokens in one file.

## Typography

- SF Pro (system). Headings use SF Pro Rounded semibold.
- Scale: 28 page title / 17 section / 15 body / 13 secondary / 11 badges. No body text under 13.
- Labels must wrap, not truncate, for de/ru/ar. Use tabular digits for the clock and numbers.

## Motion (`duration-timing`, `motion-meaning`)

- 150–250 ms springs.
- Used for: tile hover (scale 1.02 + border highlight, no tilt), panel slide, page crossfade, and Get → spinner → "In library".
- Respect Reduce Motion (no scale/slide, use fades) and Reduce Transparency (solid surfaces).
- **No** parallax tilt and no decorative infinite animations in the chrome.

## Interaction and feedback

- Hover is never the only way to reach an action. The Get button is always visible on Discover tiles.
- Async actions show inline progress on the same control. Success and failure use a toast that disappears after 3–5 s, plus the tile state change.
- Empty, loading (skeleton tiles) and offline states are designed, each with one recovery action.
- Hit targets ≥ 28 pt for pointer use, with visible keyboard focus. Every icon-only button has an accessibility label.

## Anti-patterns (banned)

Overlapping toolbar items · overflow `>>` menus for core actions · gray slabs from mixed chrome · 9-item sidebars · emoji icons (flags in the language picker are the only exception) · Save buttons for instant settings · tiny gray-on-gray text · rebuilding the root view with `.id()` (crashes on macOS 27).
