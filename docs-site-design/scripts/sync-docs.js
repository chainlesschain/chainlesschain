/**
 * 同步设计文档到 VitePress docs 目录
 * 从 docs/design/ 复制所有 .md 文件（保持目录结构）
 * 对 markdown 中的裸 <tag> 占位符进行转义，避免 Vue 模板解析错误
 * 中文文件名转为 ASCII，避免服务器解压乱码
 * index.md 和 .vitepress/ 不会被覆盖
 *
 * 文件名映射来自单源 `docs/design/_filename-map.json`（两 site 共享）。
 * 加新中文文件名 → 改 JSON。详见 CLAUDE.md "Doc-site source-of-truth"。
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const sourceDir = resolve(projectRoot, "..", "docs", "design");
const targetDir = resolve(projectRoot, "docs");
const SITE_KEY = "docs-site-design";

// 不覆盖的文件/目录
const EXCLUDE = new Set(["index.md", ".vitepress"]);

// ── 共享 single-source filename map ──
const sharedMap = JSON.parse(
  readFileSync(resolve(sourceDir, "_filename-map.json"), "utf-8"),
);

function resolveForSite(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return value[SITE_KEY] ?? null;
}

function buildSectionMap(section) {
  const out = {};
  for (const [src, value] of Object.entries(section)) {
    const target = resolveForSite(value);
    if (target != null) out[src] = target;
  }
  return out;
}

const ROOT_FILE_MAP = buildSectionMap(sharedMap.root);
const MODULE_FILE_MAP = buildSectionMap(sharedMap.modules);

/**
 * 获取目标文件名（中文 → ASCII）
 * @param {string} filename 源文件名
 * @param {boolean} isModule 是否在 modules/ 目录
 * @returns {string} ASCII 安全的文件名
 */
function getTargetFilename(filename, isModule) {
  const map = isModule ? MODULE_FILE_MAP : ROOT_FILE_MAP;
  if (map[filename]) return map[filename];

  // 未映射的文件：若已是 ASCII 则保留同名
  if (/^[\x20-\x7e]+$/.test(filename)) return filename;

  // 含 CJK 字符且未映射 → 硬失败。之前 fall-through 返回 "unknown-unmapped.md"
  // 会让多个未映射文件 silently 互相覆盖（见 memory
  // docs_site_sync_unmapped_fallthrough）。强制要求显式映射。
  const section = isModule ? "modules" : "root";
  const srcRel = `docs/design/${isModule ? "modules/" : ""}${filename}`;
  throw new Error(
    `[sync-docs] 未映射的非 ASCII 文件名: ${filename}\n` +
      `  源文件: ${srcRel}\n` +
      `  请在 docs/design/_filename-map.json 的 "${section}" 节下添加映射，\n` +
      `  或将源文件重命名为纯 ASCII（regex /^[\\x20-\\x7e]+$/）。`,
  );
}

/**
 * 转义 markdown 中不在代码块/行内代码中的裸 <tag> 占位符
 */
function escapeVueTags(content) {
  const lines = content.split("\n");
  let inCodeBlock = false;
  const result = [];

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      // 代码块内也需要转义 {{ }} — VitePress 仍会解析 Vue mustache
      result.push(line.replace(/\{\{([^}]+)\}\}/g, "\\{\\{$1\\}\\}"));
      continue;
    }

    const htmlTags = new Set([
      "div",
      "span",
      "p",
      "a",
      "br",
      "hr",
      "img",
      "table",
      "tr",
      "td",
      "th",
      "thead",
      "tbody",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "pre",
      "code",
      "em",
      "strong",
      "b",
      "i",
      "u",
      "s",
      "sub",
      "sup",
      "details",
      "summary",
      "blockquote",
      "figure",
      "figcaption",
      "section",
      "article",
      "header",
      "footer",
      "nav",
      "main",
      "aside",
      "input",
      "button",
      "form",
      "label",
      "select",
      "option",
      "textarea",
      "style",
      "script",
      "link",
      "meta",
    ]);

    // 先把行内代码 `...` 替换为占位符，避免误转义行内代码中的 <tag>
    const inlineCodeSpans = [];
    const lineWithPlaceholders = line.replace(/`[^`]+`/g, (match) => {
      inlineCodeSpans.push(match);
      return `\x00INLINE${inlineCodeSpans.length - 1}\x00`;
    });

    let escapedLine = lineWithPlaceholders.replace(
      /<([a-zA-Z][a-zA-Z0-9_-]*)>/g,
      (match, tag) => {
        if (htmlTags.has(tag.toLowerCase())) return match;
        return "`" + match + "`";
      },
    );

    escapedLine = escapedLine.replace(
      /<\/([a-zA-Z][a-zA-Z0-9_-]*)>/g,
      (match, tag) => {
        if (htmlTags.has(tag.toLowerCase())) return match;
        return "`" + match + "`";
      },
    );

    // 转义 {{ }} mustache 插值（Vue 模板语法）— 包裹为行内代码
    escapedLine = escapedLine.replace(/\{\{([^}]+)\}\}/g, (match) => {
      return "`" + match + "`";
    });

    // 恢复行内代码占位符
    escapedLine = escapedLine.replace(/\x00INLINE(\d+)\x00/g, (_, idx) => {
      return inlineCodeSpans[parseInt(idx)];
    });

    result.push(escapedLine);
  }

  return result.join("\n");
}

/**
 * 替换 markdown 内容中的内部链接（中文路径 → ASCII 路径）
 */
function rewriteInternalLinks(content) {
  // 替换内部 markdown 链接的目标文件名（中文 → ASCII slug）。
  // 支持任意相对前缀（./ ../ modules/ ../modules/ 等）+ 末尾 #anchor，跳过
  // 外部 http(s)/mailto 链接。旧正则只匹配裸 `modules/` 或无前缀，导致 ./ ../
  // 与带锚点的链接漏掉、在部署站点以中文文件名 404（如 ../系统设计_主文档.md）。
  return content.replace(
    /\]\(([^)\s]+?\.md)((?:#[^)\s]*)?)\)/g,
    (match, linkPath, anchor) => {
      if (/^(https?:|\/\/|mailto:)/i.test(linkPath)) return match;
      const slash = linkPath.lastIndexOf("/");
      const dir = slash >= 0 ? linkPath.slice(0, slash + 1) : "";
      const base = linkPath.slice(slash + 1);
      const mapped = dir.includes("modules/")
        ? MODULE_FILE_MAP[base] || ROOT_FILE_MAP[base]
        : ROOT_FILE_MAP[base] || MODULE_FILE_MAP[base];
      if (!mapped) return match;
      return `](${dir}${mapped}${anchor})`;
    },
  );
}

function syncDir(src, dest, isRoot = false, isModuleDir = false) {
  if (!existsSync(src)) {
    console.error(`源目录不存在: ${src}`);
    process.exit(1);
  }

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);
  let count = 0;

  for (const entry of entries) {
    if (isRoot && EXCLUDE.has(entry)) continue;
    if (isRoot && entry === "_filename-map.json") continue;

    const srcPath = join(src, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      const isModule = entry === "modules";
      const destSubdir = join(dest, entry);
      count += syncDir(srcPath, destSubdir, false, isModule);
    } else if (entry.endsWith(".md")) {
      const targetName = getTargetFilename(entry, isModuleDir);
      const destPath = join(dest, targetName);

      if (!existsSync(dirname(destPath))) {
        mkdirSync(dirname(destPath), { recursive: true });
      }

      let content = readFileSync(srcPath, "utf-8");
      content = escapeVueTags(content);
      content = rewriteInternalLinks(content);
      // Avoid touching byte-identical mirrors. Besides reducing rebuild churn,
      // this lets Windows builds proceed when a preview/indexer holds an
      // unchanged file open without write sharing.
      if (
        !existsSync(destPath) ||
        readFileSync(destPath, "utf-8") !== content
      ) {
        writeFileSync(destPath, content, "utf-8");
      }
      if (entry !== targetName) {
        console.log(`  ${entry} → ${targetName}`);
      }
      count++;
    }
  }

  return count;
}

console.log(`同步设计文档: ${sourceDir} → ${targetDir}`);
console.log("文件名映射: 中文 → ASCII (避免服务器乱码)\n");
const fileCount = syncDir(sourceDir, targetDir, true);
console.log(`\n完成: 同步了 ${fileCount} 个文件`);
