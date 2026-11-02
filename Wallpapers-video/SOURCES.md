# Video wallpaper sources

This file records where each Community video wallpaper came from and how it was made, so anyone can re-create the set. The `video.mp4` files are git-ignored. `wallpaper.json` and `thumb.jpg` are committed.

## Shared method

- **Seamless loop (crossfade):** take an input window of `L + X` seconds. The first `X` seconds of the output are an `xfade` from the window's last `X` seconds into its first `X` seconds, and the rest of the window follows unchanged. The last output frame is therefore source frame `L - 1/fps` and the first is source frame `L`, so playback across the loop point is continuous.
- **Encoding:** audio is stripped (`-an`) and nothing is letterboxed. Output is 16:10 full-bleed 2560x1600 where the source is 4K or larger, otherwise native 1920x1080. Codec is H.264 (`libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart`), or HEVC (`libx265 -tag:v hvc1`) where H.264 would exceed the size budget. The encodes ran with `-threads 2`, which does not change the output.
- **Thumbnails:** `thumb.jpg` is 1600x1000, scaled and center-cropped from one frame of the final video. They contain no logos or text.
- **Seam check:** for every clip, the last 3 and first 3 frames were extracted and viewed side by side. The PSNR between the last and first frames was compared with the PSNR between ordinary neighbouring frames. Every clip was also scanned for frame-to-frame luma jumps (`signalstats` YAVG) to catch cuts, glitches and flicker.
- **Commands:** `<src>` below is the original file URL, or the locally fetched segment where noted.

## iss-aurora-north-america

- **Source page:** https://svs.gsfc.nasa.gov/31375/
- **Original file:** https://svs.gsfc.nasa.gov/vis/a030000/a031300/a031375/ISS_20251112_071350-20251112_073549_2160p30.mp4
- **License evidence:** SVS FAQ (https://svs.gsfc.nasa.gov/help/): "All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit." Some SVS pages list licensed music; audio is stripped (`-an`), and the FAQ states the visuals stay public domain without it. Dataset credit on the page: "Earth Science and Remote Sensing Unit, NASA Johnson Space Center" (ISS crew photos ISS073-E-1249495 to -1253256 from https://eol.jsc.nasa.gov/). No third-party credit.
- **Time range used:** 57.0 s – 80.0 s of the source (23 s input), giving a 20 s loop. Crop `3264x2040+288+0` removes the burned-in UTC timestamp at the bottom-left.
- **ffmpeg command:**

```sh
ffmpeg -ss 57 -t 23 -i <src> -filter_complex "[0:v]fps=30,crop=3264:2040:288:0,scale=2560:1600:flags=lanczos,setsar=1,format=yuv420p,split=3[a][b][c];[a]trim=start=0:end=3,setpts=PTS-STARTPTS[head];[b]trim=start=3:end=20,setpts=PTS-STARTPTS[body];[c]trim=start=20:end=23,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=3:offset=0[xf];[xf][body]concat=n=2:v=1:a=0[out]" -map [out] -an -threads 2 -c:v libx265 -preset slow -tag:v hvc1 -x265-params log-level=error:pools=2:frame-threads=1 -crf 22 -pix_fmt yuv420p -movflags +faststart video.mp4
```

## earth-from-iss-4k

- **Source page:** https://images.nasa.gov/details/jsc2023m000111_Earth_in_4K_Space_Station_Expedition_67_68_Edition
- **Original file:** https://images-assets.nasa.gov/video/jsc2023m000111_Earth_in_4K_Space_Station_Expedition_67_68_Edition/jsc2023m000111_Earth_in_4K_Space_Station_Expedition_67_68_Edition~orig.mp4 (4176x2784, 42 GB; only a segment was fetched)
- **License evidence:** NASA Images and Media Usage Guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/): NASA content is generally not subject to copyright in the United States. The item metadata (center: JSC, no photographer/secondary_creator field, no ©/"courtesy" text) names no non-NASA rights holder.
- **Time range used:** Segment fetched with `ffmpeg -ss 335 -i <orig> -t 50 -map 0:v -c copy seg.mp4`. Used 345.0 s – 370.0 s of the original (local 10–35 s), giving a 22 s loop at 29.97 fps. The cloud field moves continuously with no scene cut.
- **ffmpeg command:**

```sh
ffmpeg -ss 10 -t 25 -i <src> -filter_complex "[0:v]fps=30000/1001,crop=4176:2610:0:0,scale=2560:1600:flags=lanczos,setsar=1,format=yuv420p,split=3[a][b][c];[a]trim=start=0:end=3,setpts=PTS-STARTPTS[head];[b]trim=start=3:end=22,setpts=PTS-STARTPTS[body];[c]trim=start=22:end=25,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=3:offset=0[xf];[xf][body]concat=n=2:v=1:a=0[out]" -map [out] -an -threads 2 -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart video.mp4
```

## galaxy-flythrough

- **Source page:** https://svs.gsfc.nasa.gov/14950/
- **Original file:** https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014950/14950_Galaxies_FlyThrough_4k.mp4
- **License evidence:** SVS FAQ (https://svs.gsfc.nasa.gov/help/): "All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit." Some SVS pages list licensed music; audio is stripped (`-an`), and the FAQ states the visuals stay public domain without it. The page is an artist's concept animation in the NASA Goddard "Astrophysics Animations" series (Nancy Grace Roman Space Telescope). Its credits list only NASA Goddard/eMITS contract staff and no outside rights holder.
- **Time range used:** 5.0 s – 32.0 s of the source (27 s input), giving a 24 s loop.
- **ffmpeg command:**

```sh
ffmpeg -ss 5 -t 27 -i <src> -filter_complex "[0:v]fps=30,crop=3456:2160:192:0,scale=2560:1600:flags=lanczos,setsar=1,format=yuv420p,split=3[a][b][c];[a]trim=start=0:end=3,setpts=PTS-STARTPTS[head];[b]trim=start=3:end=24,setpts=PTS-STARTPTS[body];[c]trim=start=24:end=27,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=3:offset=0[xf];[xf][body]concat=n=2:v=1:a=0[out]" -map [out] -an -threads 2 -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart video.mp4
```

## sun-active-region-171

- **Source page:** https://svs.gsfc.nasa.gov/4966/
- **Original file:** https://svs.gsfc.nasa.gov/vis/a000000/a004900/a004966/AR12938_AIA171_PSF_4096p30_h265.mp4 (unstamped, PSF-corrected 4096x4096)
- **License evidence:** SVS FAQ (https://svs.gsfc.nasa.gov/help/): "All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit." Some SVS pages list licensed music; audio is stripped (`-an`), and the FAQ states the visuals stay public domain without it. The data is SDO/AIA 171 Å. Visualization credits list only NASA GSFC contract staff.
- **Time range used:** 24.0 s – 52.0 s of the source (28 s input), giving a 24.97 s loop. Source frames about 632–668 (21.1–22.3 s) contain a spacecraft off-pointing glitch, so the window starts after it. Crop `4096x2560+0+768` gives a full-width 16:10 view.
- **ffmpeg command:**

```sh
ffmpeg -ss 24 -t 28 -i <src> -filter_complex "[0:v]fps=30,crop=4096:2560:0:768,scale=2560:1600:flags=lanczos,setsar=1,format=yuv420p,split=3[a][b][c];[a]trim=start=0:end=3,setpts=PTS-STARTPTS[head];[b]trim=start=3:end=25,setpts=PTS-STARTPTS[body];[c]trim=start=25:end=28,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=3:offset=0[xf];[xf][body]concat=n=2:v=1:a=0[out]" -map [out] -an -threads 2 -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart video.mp4
```

## perpetual-ocean-gulf-stream

- **Source page:** https://svs.gsfc.nasa.gov/5425/
- **Original file:** https://svs.gsfc.nasa.gov/vis/a000000/a005400/a005425/perpetual_ocean2_CLOSE_093_clean_noDate_2160p60.mp4 (the "clean, no date" beauty version; 5.4 GB, only a segment was fetched)
- **License evidence:** SVS FAQ (https://svs.gsfc.nasa.gov/help/): "All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit." Some SVS pages list licensed music; audio is stripped (`-an`), and the FAQ states the visuals stay public domain without it. Visualization by Greg Shirah (NASA/GSFC). Blue Marble land data is credited as "courtesy of Reto Stockli (NASA/GSFC)", which is a NASA employee, not a third party.
- **Time range used:** Segment fetched with `ffmpeg -ss 230 -i <src> -t 36 -map 0:v -c copy seg.mp4`. Used 236.0 s – 261.0 s of the original (local 6–31 s), giving a 22 s loop. The camera holds nearly still over the Gulf Stream. Encoded with HEVC at 15 Mb/s average because the dense flow lines reach 263 MB with CRF 20 H.264.
- **ffmpeg command:**

```sh
ffmpeg -ss 6 -t 25 -i <src> -filter_complex "[0:v]fps=30,crop=3456:2160:192:0,scale=2560:1600:flags=lanczos,setsar=1,format=yuv420p,split=3[a][b][c];[a]trim=start=0:end=3,setpts=PTS-STARTPTS[head];[b]trim=start=3:end=22,setpts=PTS-STARTPTS[body];[c]trim=start=22:end=25,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=3:offset=0[xf];[xf][body]concat=n=2:v=1:a=0[out]" -map [out] -an -threads 2 -c:v libx265 -preset slow -tag:v hvc1 -b:v 15M -maxrate 18M -bufsize 30M -pix_fmt yuv420p -movflags +faststart video.mp4
```

## ocean-surface-waves

- **Source page:** https://commons.wikimedia.org/wiki/File:Ocean_surface_waves.ogv
- **Original file:** https://upload.wikimedia.org/wikipedia/commons/8/8a/Ocean_surface_waves.ogv
- **License evidence:** Wikimedia Commons API `prop=imageinfo&iiprop=extmetadata` for `File:Ocean_surface_waves.ogv`: LicenseShortName = "CC0", UsageTerms = "Creative Commons Zero, Public Domain Dedication", Credit = "Own work", Artist = "Mostafameraji", categories include "CC-Zero" and "Self-published work" (DateTimeOriginal 2020-07-05).
- **Time range used:** 0.5 s – 21.0 s of the source (20.5 s input), giving an 18 s loop at native 1920x1080 (1080p source, so no 16:10 crop; cropping would drop it below 1920 px).
- **ffmpeg command:**

```sh
ffmpeg -ss 0.5 -t 20.5 -i <src> -filter_complex "[0:v]fps=25,null,setsar=1,format=yuv420p,split=3[a][b][c];[a]trim=start=0:end=2.5,setpts=PTS-STARTPTS[head];[b]trim=start=2.5:end=18,setpts=PTS-STARTPTS[body];[c]trim=start=18:end=20.5,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=2.5:offset=0[xf];[xf][body]concat=n=2:v=1:a=0[out]" -map [out] -an -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart video.mp4
```

## misty-river

- **Source page:** https://commons.wikimedia.org/wiki/File:Misty_river_47_seconds.webm
- **Original file:** https://upload.wikimedia.org/wikipedia/commons/9/9e/Misty_river_47_seconds.webm
- **License evidence:** Wikimedia Commons API `prop=imageinfo&iiprop=extmetadata` for `File:Misty_river_47_seconds.webm`: LicenseShortName = "CC0", UsageTerms = "Creative Commons Zero, Public Domain Dedication", Credit = "Own work", Artist = "Digitura", categories include "CC-Zero" and "Self-published work" (DateTimeOriginal 2024-11-13).
- **Time range used:** 5.0 s – 32.0 s of the source (27 s input), giving a 24 s loop at native 1920x1080, resampled from 50 to 25 fps.
- **ffmpeg command:**

```sh
ffmpeg -ss 5 -t 27 -i <src> -filter_complex "[0:v]fps=25,null,setsar=1,format=yuv420p,split=3[a][b][c];[a]trim=start=0:end=3,setpts=PTS-STARTPTS[head];[b]trim=start=3:end=24,setpts=PTS-STARTPTS[body];[c]trim=start=24:end=27,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=3:offset=0[xf];[xf][body]concat=n=2:v=1:a=0[out]" -map [out] -an -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart video.mp4
```

## clouds-bellevue-canyon

- **Source page:** https://commons.wikimedia.org/wiki/File:Timelapse_of_Clouds_over_Bellevue_Canyon.webm
- **Original file:** https://upload.wikimedia.org/wikipedia/commons/d/d5/Timelapse_of_Clouds_over_Bellevue_Canyon.webm
- **License evidence:** Wikimedia Commons API `prop=imageinfo&iiprop=extmetadata` for `File:Timelapse_of_Clouds_over_Bellevue_Canyon.webm`: LicenseShortName = "CC0", UsageTerms = "Creative Commons Zero, Public Domain Dedication", Credit = "Own work", Artist = "Extemporalist", categories include "CC-Zero" and "Self-published work" (DateTimeOriginal 2017-07-04).
- **Time range used:** 1.0 s – 29.0 s of the source (28 s input), giving a 25 s loop at native 1920x1080. A `deflicker` pass removes the timelapse exposure flicker.
- **ffmpeg command:**

```sh
ffmpeg -ss 1 -t 28 -i <src> -filter_complex "[0:v]fps=30,deflicker=mode=pm:size=9,setsar=1,format=yuv420p,split=3[a][b][c];[a]trim=start=0:end=3,setpts=PTS-STARTPTS[head];[b]trim=start=3:end=25,setpts=PTS-STARTPTS[body];[c]trim=start=25:end=28,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=3:offset=0[xf];[xf][body]concat=n=2:v=1:a=0[out]" -map [out] -an -threads 2 -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart video.mp4
```

## Rejected candidates

- **Delaneys Falls** (Commons, CC0, 4K): rejected after encoding because the handheld framing sways frame to frame (camera shake).
- **Running Stream Of Water** (Commons, tagged CC0): the file's Credit field is a pixabay.com URL. That is a Pixabay re-upload, which this store does not allow.
- **Rain in Sonoma** (Commons, CC0): has cars, a stop sign and camera moves.
- **Snow crystals over Bear Creek** (Commons, CC0): weak as a background.
- **Alaskan Aurora Time Lapse** (SVS 15077): credited "NASA/Mike Toillion", a named contractor videographer. Skipped as an individual photographer credit that could not be verified with certainty.
- **High-Resolution True Color Earth (GEOS) during the 2026 eclipse** (SVS 5670): burned-in text, eclipse-path graphics and a NASA meatball logo.
- **Spinning Earth with clouds and night lights** (SVS 5570): the 100 s rotation is not cyclic (clouds evolve), and a crossfade on a rotating globe ghosts visibly.
- **Lunar Near and Far Side Phases** (SVS 14992): only 15 s long, with a scene cut in the middle.
- **Pexels, Pixabay, Mixkit, Coverr, Videvo, YouTube and Vimeo:** not searched (not allowed).
