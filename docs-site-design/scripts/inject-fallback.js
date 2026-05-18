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
/* VitePress fallback: wait 50ms, if Vue didn't change state, handle ourselves */
(function () {
  function sbOpen(sb, btn) {
    sb.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
  function sbClose(sb, btn) {
    sb.classList.remove('open');
    document.body.style.overflow = '';
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('click', function (e) {
    var t = e.target;

    /* ── ② 菜单按钮 ──
       return 阻止同一次点击到达 ④，50ms 后检查 Vue 是否已响应 */
    var menuBtn = t.closest && t.closest('.VPLocalNav button.menu');
    if (menuBtn) {
      var sb2 = document.querySelector('.VPSidebar');
      if (sb2) {
        var was2 = sb2.classList.contains('open');
        setTimeout(function () {
          if (sb2.classList.contains('open') === was2) {
            if (was2) sbClose(sb2, menuBtn); else sbOpen(sb2, menuBtn);
          }
        }, 50);
      }
      return;
    }

    /* ── ① 侧边栏折叠组 ── */
    var hdr = t.closest && t.closest('.VPSidebarItem.collapsible > .item');
    if (hdr && !t.closest('a')) {
      var grp = hdr.closest('.VPSidebarItem.collapsible');
      var wasC = grp.classList.contains('collapsed');
      setTimeout(function () {
        if (grp.classList.contains('collapsed') === wasC) grp.classList.toggle('collapsed');
      }, 50);
      return;
    }

    /* ── ③ 回到顶部 ── */
    var topBtn = t.closest && t.closest('.VPLocalNavOutlineDropdown > button');
    if (topBtn) {
      var dd = topBtn.closest('.VPLocalNavOutlineDropdown');
      setTimeout(function () {
        if (!dd || !dd.classList.contains('open')) window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
      return;
    }

    /* ── ⑤ 点击侧边栏内的导航链接 → 关闭侧边栏 ── */
    var sb = document.querySelector('.VPSidebar');
    var sidebarLink = t.closest && t.closest('.VPSidebar a.link');
    if (sidebarLink && sb && sb.classList.contains('open')) {
      setTimeout(function () {
        sbClose(sb, document.querySelector('.VPLocalNav button.menu'));
      }, 150);
      return;
    }

    /* ── ④ 点击侧边栏外部关闭 ── */
    if (sb && sb.classList.contains('open') && !sb.contains(t)) {
      setTimeout(function () {
        if (sb.classList.contains('open')) {
          sbClose(sb, document.querySelector('.VPLocalNav button.menu'));
        }
      }, 50);
    }
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
