/**
 * Chat panel helpers — pure functions extracted for unit testing.
 * Used by `shell/AIChatPanel.vue` (and reusable for the project-level
 * chat panel port that lands later).
 */

/**
 * Map an error from `llmStore.query` / `llmStore.queryStream` to a
 * Chinese user-facing message. The V5 ChatPanel inlined this in its
 * catch block; extracting it lets us cover the substring matching with
 * unit tests instead of a panel-render harness.
 */
export function chatErrorMessage(error: unknown): string {
  const m =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!m) {
    return "发送失败";
  }
  if (m.includes("timeout")) {
    return "请求超时，请检查网络连接或 LLM 服务状态";
  }
  if (m.includes("network")) {
    return "网络错误，请检查网络连接";
  }
  if (m.includes("unauthorized") || m.includes("401")) {
    return "API 密钥无效或已过期，请检查配置";
  }
  if (m.includes("rate limit")) {
    return "API 调用频率超限，请稍后再试";
  }
  return `发送失败: ${m}`;
}

/**
 * Format a Unix-millis or ISO timestamp as HH:MM. Returns "" for
 * undefined / NaN inputs so the message header never shows "Invalid Date".
 */
export function formatChatTime(timestamp: number | string | undefined): string {
  if (timestamp === undefined || timestamp === null) {
    return "";
  }
  const ms =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (Number.isNaN(ms)) {
    return "";
  }
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export interface ChatExportMessage {
  role?: "user" | "assistant" | string;
  content?: string;
  timestamp?: number | string;
}

/**
 * Serialize a conversation's messages to a flat text export.
 * Mirrors V5 ChatPanel.handleExport's format so users get the same file shape.
 */
export function buildExportText(
  messages: ChatExportMessage[],
  title?: string,
): string {
  const header = title ? `# ${title}\n\n` : "";
  if (!Array.isArray(messages) || messages.length === 0) {
    return `${header}(empty)`;
  }
  const body = messages
    .map((msg) => {
      const role = msg.role === "user" ? "我" : "AI";
      const time =
        msg.timestamp !== undefined && msg.timestamp !== null
          ? new Date(
              typeof msg.timestamp === "number"
                ? msg.timestamp
                : new Date(msg.timestamp).getTime(),
            ).toLocaleString("zh-CN")
          : "";
      const stamp = time ? `[${role}] ${time}` : `[${role}]`;
      return `${stamp}\n${msg.content ?? ""}\n`;
    })
    .join("\n---\n\n");
  return `${header}${body}`;
}

export interface ActiveFileContext {
  file_name?: string;
  file_path?: string;
  content?: string;
}

/** Hard cap on inlined active-file content (chars) — keep the prompt bounded. */
export const ACTIVE_FILE_CONTENT_CAP = 12000;

/**
 * Build an `<active-file>` context block for the LLM prompt from the currently
 * open project file — the desktop analogue of Claude Code's "the agent sees
 * what you're looking at" (IDE selection sharing). Returns null when there is
 * no file or it has no content, so the caller injects nothing. Content is
 * capped and the path attribute is escaped. Pure; the caller decides where to
 * splice it (ephemeral — into the LLM-bound prompt, not the stored message).
 */
export function buildActiveFileContext(
  file: ActiveFileContext | null | undefined,
): string | null {
  if (!file || typeof file.content !== "string" || file.content.trim() === "") {
    return null;
  }
  const label = file.file_path || file.file_name || "current file";
  const safeLabel = label.replace(/"/g, "&quot;");
  const content =
    file.content.length > ACTIVE_FILE_CONTENT_CAP
      ? `${file.content.slice(0, ACTIVE_FILE_CONTENT_CAP)}\n…(truncated)`
      : file.content;
  return `<active-file path="${safeLabel}">\n${content}\n</active-file>`;
}

export interface ChatExportMeta {
  title?: string;
  model?: string;
  provider?: string;
  totalTokens?: number;
  exportedAt?: string;
}

export interface ChatMarkdownMessage {
  role?: string;
  content?: string;
  timestamp?: number | string;
  tokens?: number;
  model?: string;
}

/**
 * Serialize a conversation to a structured Markdown transcript — parity with
 * the `cc` CLI `/export`. Richer than buildExportText: role-headed sections
 * (👤/🤖/⚙), per-message model + token counts (which the flat text export
 * drops), a meta header, and a turn/token summary footer. Pure; the caller
 * does the file I/O.
 */
export function buildExportMarkdown(
  messages: ChatMarkdownMessage[],
  meta: ChatExportMeta = {},
): string {
  const L: string[] = [`# ${meta.title || "ChainlessChain 对话导出"}`, ""];
  const bits: string[] = [];
  if (meta.provider) bits.push(`provider: ${meta.provider}`);
  if (meta.model) bits.push(`model: ${meta.model}`);
  if (typeof meta.totalTokens === "number" && meta.totalTokens > 0) {
    bits.push(`tokens: ${meta.totalTokens}`);
  }
  if (meta.exportedAt) bits.push(`exported: ${meta.exportedAt}`);
  if (bits.length) L.push(`> ${bits.join(" · ")}`, "");

  if (!Array.isArray(messages) || messages.length === 0) {
    L.push("(empty)", "");
    return L.join("\n");
  }

  let users = 0;
  let assistants = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role;
    if (role === "user") users += 1;
    else if (role === "assistant") assistants += 1;
    const heading =
      role === "user"
        ? "## 👤 User"
        : role === "assistant"
          ? "## 🤖 Assistant"
          : role === "system"
            ? "## ⚙ System"
            : `## ${role || "?"}`;
    L.push(heading);
    const mbits: string[] = [];
    if (m.model) mbits.push(m.model);
    if (typeof m.tokens === "number" && m.tokens > 0) {
      mbits.push(`${m.tokens} tok`);
    }
    const t = formatChatTime(m.timestamp);
    if (t) mbits.push(t);
    if (mbits.length) L.push(`_${mbits.join(" · ")}_`);
    L.push("", m.content ?? "", "");
  }

  const footer = [`${users} user / ${assistants} assistant turns`];
  if (typeof meta.totalTokens === "number" && meta.totalTokens > 0) {
    footer.push(`${meta.totalTokens} tokens`);
  }
  L.push("---", `_${footer.join(" · ")}_`, "");
  return L.join("\n");
}

export interface RagEnhanceResult {
  context?: string;
  retrievedDocs?: Array<{ id: string; title?: string; score?: number }>;
}

/**
 * Normalize the optional `window.electronAPI.rag.enhanceQuery` envelope so
 * the chat panel's send path doesn't need to know its exact shape. Returns
 * the original query when RAG is unavailable / errored / empty.
 */
export function extractRagContext(
  rag: RagEnhanceResult | null | undefined,
  fallback: string,
): {
  prompt: string;
  retrievedDocs: Array<{ id: string; title?: string; score?: number }>;
} {
  if (
    !rag ||
    typeof rag.context !== "string" ||
    rag.context.trim().length === 0
  ) {
    return { prompt: fallback, retrievedDocs: [] };
  }
  return {
    prompt: rag.context,
    retrievedDocs: Array.isArray(rag.retrievedDocs) ? rag.retrievedDocs : [],
  };
}
