// Async logo loader for the page-loading splash. Extracted from
// index.html's inline <script> so the strict CSP (no 'unsafe-inline')
// can stay. Tries a few relative paths; if all fail, hides the <img>
// so the CSS-only ring + brand text remain.
(function () {
  const img = document.getElementById("pl-logo-img");
  if (!img) {
    return;
  }
  const paths = [
    "../main/splash/logo.png",
    "../../main/splash/logo.png",
    "./assets/logo.png",
  ];
  let idx = 0;
  function tryNext() {
    if (idx >= paths.length) {
      img.style.display = "none";
      return;
    }
    img.src = paths[idx++];
    img.onerror = tryNext;
  }
  tryNext();
})();
