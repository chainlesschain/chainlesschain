// Async logo loader for the page-loading splash. Extracted from
// index.html's inline <script> so the strict CSP (no 'unsafe-inline')
// can stay. Tries a few relative paths; if all fail, hides the entire
// .pl-logo-wrap so the empty rings don't keep spinning around nothing.
(function () {
  const img = document.getElementById("pl-logo-img");
  if (!img) {
    return;
  }
  // `/logo.png` matches `public/logo.png` (Vite dev + packaged Electron file://).
  // The `../main/splash/...` legacy paths stay as fallbacks for an older
  // packaged layout, but they're unlikely to resolve today.
  const paths = [
    "/logo.png",
    "./logo.png",
    "../main/splash/logo.png",
    "../../main/splash/logo.png",
    "./assets/logo.png",
  ];
  let idx = 0;
  function tryNext() {
    if (idx >= paths.length) {
      // All paths failed — hide the whole wrap (img + rings + shadow) so
      // we don't show empty rings spinning around a missing center. The
      // brand text + bouncing dots below stay visible.
      const wrap = img.closest(".pl-logo-wrap");
      if (wrap) {
        wrap.style.display = "none";
      } else {
        img.style.display = "none";
      }
      return;
    }
    img.src = paths[idx++];
    img.onerror = tryNext;
  }
  tryNext();
})();
