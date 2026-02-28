/**
 * 构建后处理：将 <head> 中的绝对资源路径转为相对路径
 * 使静态站点可通过 file:// 协议直接打开（无需 Web 服务器）
 *
 * 只处理 <head> 内的 JS/CSS/字体/图标路径，
 * 绝对不改动 <body> 内容（Vue SSR 水合依赖 body 与虚拟 DOM 完全一致）
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "docs", ".vitepress", "dist");

/**
 * 根据文件位置计算相对于 dist 根目录的前缀
 * dist/index.html          → "./"
 * dist/modules/01_xxx.html → "../"
 */
function getRelativePrefix(filePath) {
  const rel = relative(distDir, dirname(filePath));
  if (!rel) return "./";
  const depth = rel.split(/[\\/]/).filter(Boolean).length;
  return "../".repeat(depth);
}

/**
 * 提取 <head>...</head> 区域，只对该区域做路径替换，body 原样保留
 */
function processHTML(filePath) {
  let content = readFileSync(filePath, "utf-8");
  const prefix = getRelativePrefix(filePath);

  // 只替换 <head> 区域
  content = content.replace(/(<head[\s\S]*?<\/head>)/i, (head) => {
    // 1. <script src="/assets/...">
    head = head.replace(
      /(<script[^>]+\bsrc=")\/assets\//g,
      `$1${prefix}assets/`,
    );

    // 2. <link href="/assets/..."> (preload / modulepreload / stylesheet)
    head = head.replace(
      /(<link[^>]+\bhref=")\/assets\//g,
      `$1${prefix}assets/`,
    );

    // 3. <link href="/vp-icons.css">
    head = head.replace(
      /(<link[^>]+\bhref=")\/vp-icons\.css"/g,
      `$1${prefix}vp-icons.css"`,
    );

    // 4. <link href="/favicon.ico"> 等根级图标
    head = head.replace(
      /(<link[^>]+\bhref=")\/(favicon\.[^"]+)"/g,
      `$1${prefix}$2"`,
    );

    // 5. 字体 preload <link href="/assets/...woff2">（已被规则2覆盖，保留注释）

    return head;
  });

  writeFileSync(filePath, content, "utf-8");
}

function walkDir(dir) {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      count += walkDir(fullPath);
    } else if (entry.endsWith(".html")) {
      processHTML(fullPath);
      count++;
    }
  }
  return count;
}

console.log("后处理: 转换 <head> 资源路径为相对路径（body 不变）...");
const count = walkDir(distDir);
console.log(`完成: 处理了 ${count} 个 HTML 文件`);
