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
