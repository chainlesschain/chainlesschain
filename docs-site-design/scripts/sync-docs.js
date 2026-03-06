/**
 * 同步设计文档到 VitePress docs 目录
 * 从 docs/design/ 复制所有 .md 文件（保持目录结构）
 * 对 markdown 中的裸 <tag> 占位符进行转义，避免 Vue 模板解析错误
 * index.md 和 .vitepress/ 不会被覆盖
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

// 不覆盖的文件/目录
const EXCLUDE = new Set(["index.md", ".vitepress"]);

/**
 * 转义 markdown 中不在代码块/行内代码中的裸 <tag> 占位符
 * 例如 <path> → `<path>`, <email> → `<email>`
 * 但不影响已在 `` 中的内容和 HTML 标签如 <div>, <table> 等
 */
function escapeVueTags(content) {
  const lines = content.split("\n");
  let inCodeBlock = false;
  const result = [];

  for (const line of lines) {
    // 检测代码块边界
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // 在非代码块行中，转义裸 <word> 占位符（不在反引号内）
    // 匹配 <word>, <word-word>, <word_word> 等（不是已知 HTML 标签）
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

    let escapedLine = line.replace(
      /(?<!`)(<([a-zA-Z][a-zA-Z0-9_-]*)>)(?!`)/g,
      (match, full, tag) => {
        // 保留已知 HTML 标签和关闭标签
        if (htmlTags.has(tag.toLowerCase())) return match;
        // 转义为行内代码
        return "`" + full + "`";
      },
    );

    // 也处理 </tag> 关闭标签形式的占位符
    escapedLine = escapedLine.replace(
      /(?<!`)(<\/([a-zA-Z][a-zA-Z0-9_-]*)>)(?!`)/g,
      (match, full, tag) => {
        if (htmlTags.has(tag.toLowerCase())) return match;
        return "`" + full + "`";
      },
    );

    result.push(escapedLine);
  }

  return result.join("\n");
}

function syncDir(src, dest, isRoot = false) {
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

    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      count += syncDir(srcPath, destPath);
    } else if (entry.endsWith(".md")) {
      if (!existsSync(dirname(destPath))) {
        mkdirSync(dirname(destPath), { recursive: true });
      }
      // 读取、转义、写入
      const content = readFileSync(srcPath, "utf-8");
      const escaped = escapeVueTags(content);
      writeFileSync(destPath, escaped, "utf-8");
      count++;
    }
  }

  return count;
}

console.log(`同步设计文档: ${sourceDir} → ${targetDir}`);
const fileCount = syncDir(sourceDir, targetDir, true);
console.log(`完成: 同步了 ${fileCount} 个文件`);
