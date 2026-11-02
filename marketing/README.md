# MacWallpaperPro launch kit

Social media assets for the MacWallpaperPro launch (v1.1.0). Every frame is rendered offscreen from the real wallpapers in `Wallpapers/` and `Wallpapers-video/`, using headless Chrome with a scripted cursor. Nothing in the kit is a screen recording. All post copy, in four languages, and the voiceover scripts are in [`CAPTIONS.md`](CAPTIONS.md).

The style throughout is a dark cinematic base, the brand gradient `#7C3AED → #DB2777`, SF Pro type, and real wallpaper imagery as the hero. The kit uses no Apple logos, and "Not affiliated with Apple" appears where there is room.

> The `.mp4` files are git-ignored (`marketing/*.mp4`). The images and markdown can be committed. Keep the videos somewhere else, such as a release asset or a shared drive.

## Videos

All videos are H.264 High at 30 fps with `yuv420p` and `+faststart`.

| File | Size | Length | Audio | For |
|---|---|---|---|---|
| `teaser-9x16.mp4` | 1080×1920, 35 MB | 23.9 s | English voiceover, −16 LUFS | TikTok, Instagram Reels, YouTube Shorts |
| `teaser-9x16-th.mp4` | 1080×1920, 35 MB | 24.4 s | Thai voiceover, −16 LUFS | Thai TikTok, Reels, Facebook |
| `showcase-16x9.mp4` | 1920×1080, 27 MB | 42.4 s | English voiceover, −16 LUFS | X, YouTube, LinkedIn, Product Hunt |
| `square-1x1.mp4` | 1080×1080, 6.9 MB | 13.6 s (seamless loop) | none | Instagram / Facebook feed |

- **Teaser:** quick eased cuts across 8 wallpapers: Sakura Breeze, Koi Pond, Pixel Town (click fireworks), Moon Rabbit Night (shooting stars), Perpetual Ocean (video wallpaper), Neon Skyline (lightning), Event Horizon (shockwave) and Bunny Meadow. It ends on an icon / name / URL card. Captions match the voiceover. All text stays above the bottom 20% of the frame.
- **Showcase:** a macOS-style desktop with a menu bar, a dock silhouette and the desktop clock. It moves through the interactive wallpapers, then the app window slides in and a video wallpaper (Golden Sun in 171 Å) is installed in one click and applied. A feature-card section follows (the privacy cards get highlighted), then a CTA card.
- **Square:** a loop of four interactive scenes under a fixed headline, with one caption per scene. It has no audio, so you can add music in the app you post from.
- Burned-in captions match the voiceover, so the videos work on mute.

## Images

Each image has a PNG and a JPG version. Every JPG is under 1 MB.

| File | Size (px) | PNG / JPG | For |
|---|---|---|---|
| `hero-16x9` | 1920×1080 | 1.8 MB / 411 KB | Website hero, YouTube banner art, press |
| `og-1200x630` | 1200×630 | 744 KB / 184 KB | Link preview (`og:image`, `twitter:image`) |
| `github-social-1280x640` | 1280×640 | 738 KB / 167 KB | GitHub repo → Settings → Social preview |
| `post-1x1-grid` | 1080×1080 | 912 KB / 303 KB | Instagram / Facebook / X: "19 free wallpapers" grid |
| `post-1x1-cute` | 1080×1080 | 665 KB / 210 KB | Instagram / Facebook: the cute pastel set |
| `post-1x1-features` | 1080×1080 | 488 KB / 200 KB | Instagram / LinkedIn: feature list |
| `story-9x16-1` | 1080×1920 | 1.8 MB / 429 KB | Instagram / Facebook Story: "Your Mac, but alive." |
| `story-9x16-2` | 1080×1920 | 1.2 MB / 360 KB | Story: "Pick your vibe" categories |
| `producthunt-gallery-1` | 1270×760 | 938 KB / 228 KB | Product Hunt gallery 1: hero |
| `producthunt-gallery-2` | 1270×760 | 627 KB / 204 KB | Product Hunt gallery 2: one-click install (Discover UI) |
| `producthunt-gallery-3` | 1270×760 | 417 KB / 165 KB | Product Hunt gallery 3: features and privacy |

The stories keep their text out of the top 250 px and the bottom 340 px, where the platform UI sits.

## Other files

- `CAPTIONS.md`: the post copy for X/Threads, Instagram/TikTok, LinkedIn/Facebook, Product Hunt, Reddit r/macapps and YouTube, in English, Thai, Japanese and Spanish. It also has the UTM link table and a "Voiceover scripts" section.
- `make-voiceover.mjs`: regenerates the voiceover with Gemini TTS. Run `node marketing/make-voiceover.mjs --voice Sulafat`. It reads `secrets/gemini.key`, never prints the key, and caches its output in the git-ignored `.build/vo-cache/`. The free tier allows about 10 requests per day for `gemini-3.8-flash-tts`.

## Re-rendering the videos (separate from the voiceover)

`make-voiceover.mjs` **only writes WAV files**, to `.build/vo-cache/` by default. It never changes the `.mp4` files in this folder. Running it on its own changes nothing in the videos.

The videos were built by a render pipeline that lives outside the repo, in the session scratchpad (`mk/`: `capture.mjs`, `vo.mjs`, `build.mjs`, `render.mjs` and the `teaser/showcase/square.html` compositions). Updating a video takes three steps:

1. **Capture clips.** Headless Chrome renders each wallpaper with a scripted cursor and writes JPG frames plus a cursor path (`node capture.mjs jobs.json`). Video wallpapers are extracted with ffmpeg instead.
2. **Mix the voiceover.** `vo.mjs` splits the WAV into lines with `silencedetect`, places each line at its cue time with a light `atempo`, and loudness-normalizes the result to −16 LUFS (two-pass `loudnorm`). The caption timings come from the same placement.
3. **Render and mux.** `node build.mjs teaser-en|teaser-th|showcase-en` runs the mix, renders the frames in Chrome, closes Chrome, encodes with one ffmpeg process (`-threads 2`), and muxes in the audio.

To change a voiceover line, edit `SCRIPTS` in `make-voiceover.mjs`, generate the WAV, update the matching caption text in `build.mjs`, and run step 3. Step 1 is needed only if the frame dumps were deleted. If that pipeline isn't available, ask for it to be rebuilt. Swapping the audio into an existing mp4 by hand will leave the burned-in captions out of sync.

## Tracking links

Use the UTM link for each platform: `https://macwallpaper.elizos.com/?utm_source=<tiktok|instagram|x|youtube|reddit|facebook|linkedin|producthunt>`. Use `/download?utm_source=…` where a direct download makes sense. The full table is in `CAPTIONS.md`.

## Posting plan for the first week

Times are suggestions for a global, English-first audience. Post in your audience's morning, local time. Reply to comments during the first two hours of every post.

| Day | Main post | Assets | Notes |
|---|---|---|---|
| **Mon: launch** | Product Hunt launch at 00:01 PT, and an X thread | `producthunt-gallery-1…3`, `showcase-16x9.mp4`, PH tagline and first comment | Put the showcase video first in the PH gallery. Pin the X post. Set `og-1200x630` as the site's link preview beforehand, and `github-social-1280x640` as the repo preview. |
| **Tue** | TikTok, Reels and Shorts | `teaser-9x16.mp4` with the IG/TikTok caption | Put the link in your bio (`utm_source=tiktok` / `instagram`). Add a trending sound at low volume under the voiceover if you want, or keep only the voiceover. |
| **Wed** | Reddit r/macapps (and r/macOS if its rules allow) | the Reddit post, plus a gallery of `post-1x1-grid` and `hero-16x9` | Say up front that you're the developer, don't hype, and mention it's free and open source. Stay in the comments. |
| **Thu** | LinkedIn and Facebook | `showcase-16x9.mp4`, or `post-1x1-features` as a still | Use the long post. Facebook gets `square-1x1.mp4` as a feed loop. |
| **Fri** | Instagram feed carousel | `post-1x1-grid` → `post-1x1-cute` → `post-1x1-features`, then `story-9x16-1`/`-2` as Stories with a link sticker | The pastel set usually does well on Instagram and TikTok. |
| **Sat** | Thai channels: Thai TikTok, Facebook groups, Pantip / X Thailand | `teaser-9x16-th.mp4`, Thai captions | The Thai voiceover version. |
| **Sun** | YouTube upload and recap | `showcase-16x9.mp4` with the YouTube description and chapters, plus a short thank-you post on X | Share any early numbers from the stats page and ask which wallpaper people want next. |

After the first week, re-cut posts around single wallpapers (for example koi, sakura or the black hole). Each sequence in the teaser works as its own 6–8 s clip.

## Credits and notes

- **Video wallpaper footage** appears in the teaser (Perpetual Ocean: Gulf Stream), the showcase (Golden Sun in 171 Å) and the images (the "+8 video" tile, the story card and the app screenshots):
  - *Perpetual Ocean 2: Gulf Stream*: NASA/Goddard Space Flight Center Scientific Visualization Studio (svs.gsfc.nasa.gov/5425). Public domain.
  - *Golden Sun in 171 Å*: NASA/SDO, with the visualization by the NASA Goddard Scientific Visualization Studio (svs.gsfc.nasa.gov/4966). Public domain.
  - The other video wallpapers shown as thumbnails in the app screenshot: NASA JSC / Goddard SVS (public domain), and Wikimedia Commons uploads by Extemporalist, Digitura and Mostafameraji (CC0 1.0). Full sources are in `Wallpapers-video/SOURCES.md`.
  - Following NASA's media guidelines, the kit doesn't use the NASA logo or suggest that NASA endorses the app.
- The interactive wallpapers, the app icon and the UI screenshots are the project's own.
- **Voiceover:** AI-generated with Google Gemini TTS (voice "Sulafat"). The kit uses no music. Any music you add on a platform is up to you.
- Not affiliated with Apple. Mac and macOS are trademarks of Apple Inc. Wallpaper Engine is named only as a comparison in some captions, never in the visuals.

## Known limitations

- The teaser voiceovers come from `gemini-3.8-flash-tts`. The showcase voiceover comes from the fallback `gemini-2.5-flash-preview-tts`, with the same voice name (Sulafat), so its timbre may differ slightly between the videos.
- The app window in the showcase is a still screenshot. The Get → spinner → "In library" button states are drawn on top of it, so they're a faithful mock of the real flow rather than a capture of it.
- The clock in the desktop mockup reads a fixed "9:41 AM".
