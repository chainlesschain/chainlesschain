/**
 * 向所有 dist HTML 文件的 <head> 中注入移动端/PC交互 fallback 脚本
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "docs", ".vitepress", "dist");

// 匹配旧版注入的脚本（用于清除）
const OLD_SCRIPT_RE =
  /<script[^>]*>\s*\/\*\s*VitePress interactive[\s\S]*?<\/script>\n?/g;
const OLD_SCRIPT_RE2 =
  /<script>;?\(function\(\)\{[\s\S]*?\}\)\(\);<\/script>\n?/g;

const FALLBACK_SCRIPT = `<script>
/* VitePress interactive fallback — only activates when Vue is not hydrated */
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var WAIT = 3000, CHECK = 200, elapsed = 0;

    function setupFallback() {
      var menuBtn = document.querySelector('.VPLocalNav button.menu');

      /* ── ① Sidebar collapsible groups ── */
      document.querySelectorAll('.VPSidebarItem.collapsible > .item').forEach(function (hdr) {
        if (hdr._vei) return;
        hdr.addEventListener('click', function (e) {
          if (e.target.closest('a')) return;
          hdr.closest('.VPSidebarItem.collapsible').classList.toggle('collapsed');
        });
      });

      /* ── ② Mobile menu button ── */
      if (menuBtn && !menuBtn._vei) {
        menuBtn.addEventListener('click', function () {
          var sb = document.querySelector('.VPSidebar');
          if (!sb) return;
          var open = sb.classList.toggle('open');
          menuBtn.setAttribute('aria-expanded', String(open));
          document.body.style.overflow = open ? 'hidden' : '';
        });
      }

      /* ── ③ Back-to-top button ── */
      var outlineBtn = document.querySelector('.VPLocalNavOutlineDropdown > button');
      if (outlineBtn && !outlineBtn._vei) {
        outlineBtn.addEventListener('click', function () {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }

      /* ── ④ Click outside sidebar to close ──
         关键：必须排除菜单按钮本身，否则 ② 刚打开，④ 立即关闭 */
      document.addEventListener('click', function (e) {
        var sb = document.querySelector('.VPSidebar');
        if (!sb || !sb.classList.contains('open')) return;
        /* 如果点击的是菜单按钮，由 ② 处理 toggle，④ 不干预 */
        var btn = document.querySelector('.VPLocalNav button.menu');
        if (btn && btn.contains(e.target)) return;
        /* 点击侧边栏内部，不关闭 */
        if (sb.contains(e.target)) return;
        sb.classList.remove('open');
        document.body.style.overflow = '';
        if (btn) btn.setAttribute('aria-expanded', 'false');
      });
    }

    function poll() {
      if (elapsed >= WAIT) { setupFallback(); return; }
      elapsed += CHECK;
      setTimeout(function () {
        var item = document.querySelector('.VPSidebarItem.collapsible > .item');
        if (item && item._vei) return; /* Vue already hydrated — skip */
        poll();
      }, CHECK);
    }

    setTimeout(poll, CHECK);
  });
})();
</script>`;

function processHTML(filePath) {
  let content = readFileSync(filePath, "utf-8");
  content = content.replace(OLD_SCRIPT_RE, "");
  content = content.replace(OLD_SCRIPT_RE2, "");
  content = content.replace("</head>", FALLBACK_SCRIPT + "\n</head>");
  writeFileSync(filePath, content, "utf-8");
  return true;
}

function walkDir(dir) {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      count += walkDir(fullPath);
    } else if (entry.endsWith(".html")) {
      if (processHTML(fullPath)) count++;
    }
  }
  return count;
}

console.log("注入修复版 fallback 脚本...");
const count = walkDir(distDir);
console.log(`完成: 处理了 ${count} 个 HTML 文件`);
