// Wallpaper detail: reveal the live preview once it has loaded, full screen, copy link.
import { toast } from "./site.js";

const frame = document.querySelector("[data-live-frame]");
if (frame) {
  const ready = () => frame.classList.add("is-ready");
  frame.addEventListener("load", ready, { once: true });
  // The frame may finish before this module runs.
  setTimeout(ready, 2500);
}

const video = document.querySelector("[data-live-video]");
if (video) {
  const ready = () => video.classList.add("is-ready");
  if (video.readyState >= 2) ready();
  else video.addEventListener("loadeddata", ready, { once: true });
  // Autoplay can be refused (e.g. reduced data); the poster stays visible then.
  video.play?.().catch(() => {});
}

const fsBtn = document.querySelector("[data-fullscreen]");
const screen = document.querySelector(".display__screen");
if (fsBtn && screen) {
  if (!screen.requestFullscreen) fsBtn.hidden = true;
  fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else screen.requestFullscreen().catch(() => {});
  });
}

const share = document.querySelector("[data-share]");
share?.addEventListener("click", async () => {
  const url = location.origin + location.pathname;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: document.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast(share.dataset.copied);
  } catch {
    /* cancelled */
  }
});
