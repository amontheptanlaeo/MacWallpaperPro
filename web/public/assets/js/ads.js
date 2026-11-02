// Google AdSense loader. Only included on pages that render an ad slot AND only when the server has
// ADSENSE_CLIENT configured. Consent Mode v2 defaults are set before Google's script loads:
// everything is denied until the visitor accepts in the consent banner.
(function () {
  "use strict";
  var meta = document.querySelector('meta[name="mwp-adsense"]');
  var client = meta && meta.content;
  if (!client || !/^ca-pub-\d{10,20}$/.test(client)) return;

  var w = window;
  w.dataLayer = w.dataLayer || [];
  function gtag() { w.dataLayer.push(arguments); }
  w.gtag = w.gtag || gtag;

  function choice() {
    var m = /(?:^|;\s*)mwp_consent=(granted|denied)/.exec(document.cookie);
    return m ? m[1] : null;
  }
  function state(v) {
    return { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v };
  }

  var d = state("denied");
  d.wait_for_update = 500;
  gtag("consent", "default", d);
  var granted = choice() === "granted";
  if (granted) gtag("consent", "update", state("granted"));

  w.adsbygoogle = w.adsbygoogle || [];
  // Belt and braces for older AdSense code paths: non-personalized until accepted.
  w.adsbygoogle.requestNonPersonalizedAds = granted ? 0 : 1;

  w.addEventListener("mwp:consent", function (e) {
    var v = e.detail === "granted" ? "granted" : "denied";
    gtag("consent", "update", state(v));
    w.adsbygoogle.requestNonPersonalizedAds = v === "granted" ? 0 : 1;
  });

  var s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(client);
  document.head.appendChild(s);

  var units = document.querySelectorAll("ins.adsbygoogle");
  for (var i = 0; i < units.length; i++) {
    try { w.adsbygoogle.push({}); } catch (err) { /* ignore */ }
    watch(units[i]);
  }

  // Collapse the slot (and its label) when AdSense reports no ad, so no empty box remains.
  function watch(ins) {
    var box = ins.closest("[data-ad]");
    if (!box || !w.MutationObserver) return;
    new MutationObserver(function () {
      if (ins.getAttribute("data-ad-status") === "unfilled") box.classList.add("is-unfilled");
    }).observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
  }
})();
