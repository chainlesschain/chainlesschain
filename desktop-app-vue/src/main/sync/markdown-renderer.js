/**
 * 知识库 item → Markdown 文件名 / 内容渲染（Phase 3c.2）
 *
 * 从 git/markdown-exporter.js 提炼出的 *纯函数*，让 git 同步、WebDAV 同步、
 * S3/OSS 同步等不同传输层共用同一渲染规则。
 *
 * 设计：
 *   - 渲染规则与 markdown-exporter.js 兼容（YAML front-matter +
 *     "# title" + 内容 + "## 元数据"），保证两个 provider 同时启用时
 *     远端文件不发生格式抖动
 *   - 不依赖 fs / database — 输入是 plain item object，输出是 string
 *   - 文件名 50 字符上限沿用 markdown-exporter，避免 Windows path 限制
 */

const FILENAME_TITLE_MAX = 50;
const FILENAME_INVALID_RE = /[<>:"/\\|?*]/g;
const FILENAME_WHITESPACE_RE = /\s+/g;

/**
 * 把 item 转成形如 `${id}-${cleanTitle}.md` 的扁平文件名。
 * 与 markdown-exporter.generateFilename 完全一致。
 *
 * @param {{id: string, title: string}} item
 * @returns {string}
 */
function generateFilename(item) {
  const rawTitle = typeof item?.title === "string" ? item.title : "";
  const cleanTitle = rawTitle
    .replace(FILENAME_INVALID_RE, "-")
    .replace(FILENAME_WHITESPACE_RE, "-")
    .substring(0, FILENAME_TITLE_MAX);
  return `${item.id}-${cleanTitle}.md`;
}

/**
 * 渲染单个 item 的完整 Markdown 文档（含 YAML front-matter）。
 * 与 markdown-exporter.generateMarkdown 行为一致。
 *
 * @param {Object} item — knowledge_items 行 + tags（如有）
 * @returns {string}
 */
function generateMarkdown(item) {
  const lines = [];

  // 前置元数据（YAML front matter）
  lines.push("---");
  lines.push(`id: ${item.id}`);
  lines.push(`title: ${item.title}`);
  lines.push(`type: ${item.type}`);

  if (Array.isArray(item.tags) && item.tags.length > 0) {
    lines.push(`tags: [${item.tags.join(", ")}]`);
  }

  lines.push(`created_at: ${item.created_at}`);
  lines.push(`updated_at: ${item.updated_at}`);

  if (item.source_url) {
    lines.push(`source_url: ${item.source_url}`);
  }

  lines.push("---");
  lines.push("");

  // 正文标题
  lines.push(`# ${item.title}`);
  lines.push("");

  if (item.content) {
    lines.push(item.content);
    lines.push("");
  }

  // 元数据部分
  lines.push("---");
  lines.push("");
  lines.push("## 元数据");
  lines.push("");
  lines.push(`- **类型**: ${item.type}`);
  lines.push(`- **创建时间**: ${item.created_at}`);
  lines.push(`- **更新时间**: ${item.updated_at}`);

  if (Array.isArray(item.tags) && item.tags.length > 0) {
    lines.push(`- **标签**: ${item.tags.join(", ")}`);
  }

  if (item.source_url) {
    lines.push(`- **来源**: [${item.source_url}](${item.source_url})`);
  }

  return lines.join("\n");
}

module.exports = {
  generateFilename,
  generateMarkdown,
  FILENAME_TITLE_MAX,
};
