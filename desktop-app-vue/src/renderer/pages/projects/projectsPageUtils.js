/**
 * Pure helpers for ProjectsPage.vue. All deterministic — input → output —
 * with no Vue reactivity or component state. Same pattern as the other
 * *Utils.js modules across the codebase.
 */

/**
 * Format a timestamp as a friendly relative-or-absolute label.
 *  < 1m   → "刚刚"
 *  < 1h   → "N分钟前"
 *  < 1d   → "N小时前"
 *  else   → "MM-DD HH:mm" (zh-CN)
 */
export const formatTime = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) {
    return "刚刚";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`;
  }
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const STAGE_COLORS = {
  intent: "blue",
  engine: "cyan",
  spec: "purple",
  html: "orange",
  css: "green",
  js: "volcano",
  complete: "success",
};

export const getStageColor = (stage) => STAGE_COLORS[stage] || "default";

const CHAT_INTENT_KEYWORDS = [
  "logo",
  "标志",
  "图标",
  "什么是",
  "如何",
  "怎么",
  "为什么",
  "能不能",
  "可以吗",
  "告诉我",
  "聊聊",
  "咨询",
  "问一下",
];

const DESIGN_NEGATIVE_KEYWORDS = ["网页", "网站", "页面"];

const PROJECT_CREATION_KEYWORDS = [
  "创建项目",
  "新建项目",
  "创建网页",
  "做个网站",
  "建个网站",
  "创建网站",
  "做个应用",
  "创建应用",
  "写个网页",
  "生成网页",
  "创建文件",
  "新建文件",
  "生成文件",
];

/**
 * Classify a user prompt as chat-style consultation vs explicit project
 * creation. Both flags can be true (we treat creation as winning at the call
 * site). Both can be false (no clear signal — usually means proceed with
 * creation as the default).
 *
 * @param {string} text  Raw user prompt.
 * @returns {{ isChatIntent: boolean, isProjectCreationIntent: boolean }}
 */
export const detectCreateIntent = (text) => {
  const lower = (text || "").toLowerCase();

  // 设计/绘图类咨询：含 "设计" 但不含 "网页/网站/页面" 视为咨询
  const designIsConsult =
    lower.includes("设计") &&
    !DESIGN_NEGATIVE_KEYWORDS.some((kw) => lower.includes(kw));

  // "做个 [图/画]" — 偏咨询
  const doDrawing =
    lower.includes("做个") && (lower.includes("图") || lower.includes("画"));

  const keywordMatch = CHAT_INTENT_KEYWORDS.some((kw) => lower.includes(kw));

  const isChatIntent = keywordMatch || designIsConsult || doDrawing;

  const isProjectCreationIntent = PROJECT_CREATION_KEYWORDS.some((kw) =>
    lower.includes(kw),
  );

  return { isChatIntent, isProjectCreationIntent };
};
