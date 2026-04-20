import type { BubbleMessage } from "../../stores/conversation-preview";

export interface BridgeChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type BridgeResult =
  | { ok: true; reply: string }
  | { ok: false; reason: string };

interface LlmApi {
  checkStatus: () => Promise<{ available?: boolean; error?: string } | boolean>;
  chat: (params: {
    messages: BridgeChatMessage[];
    enableRAG?: boolean;
    enableCache?: boolean;
    enableCompression?: boolean;
    enableSessionTracking?: boolean;
    enableManusOptimization?: boolean;
    enableMultiAgent?: boolean;
    enableErrorPrecheck?: boolean;
  }) => Promise<unknown>;
}

function getLlmApi(): LlmApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: { llm?: LlmApi } })
    .electronAPI;
  return api?.llm ?? null;
}

export async function isAvailable(): Promise<boolean> {
  const llm = getLlmApi();
  if (!llm) return false;
  try {
    const status = await llm.checkStatus();
    if (typeof status === "boolean") return status;
    return !!status?.available;
  } catch {
    return false;
  }
}

function extractReply(raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    return typeof raw === "string" ? raw : "";
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.content === "string") return r.content;
  const msg = r.message as Record<string, unknown> | undefined;
  if (msg && typeof msg.content === "string") return msg.content;
  if (typeof r.reply === "string") return r.reply;
  return "";
}

export function toBridgeMessages(
  history: BubbleMessage[],
  nextUser?: string,
): BridgeChatMessage[] {
  const out: BridgeChatMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (nextUser && nextUser.trim()) {
    out.push({ role: "user", content: nextUser.trim() });
  }
  return out;
}

export async function sendChat(
  messages: BridgeChatMessage[],
): Promise<BridgeResult> {
  const llm = getLlmApi();
  if (!llm) {
    return { ok: false, reason: "LLM 服务不可用：electronAPI 未就绪" };
  }
  try {
    const raw = await llm.chat({
      messages,
      enableRAG: false,
      enableCache: false,
      enableCompression: false,
      enableSessionTracking: false,
      enableManusOptimization: false,
      enableMultiAgent: false,
      enableErrorPrecheck: false,
    });
    const reply = extractReply(raw);
    if (!reply) {
      return { ok: false, reason: "LLM 返回为空" };
    }
    return { ok: true, reply };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

export const __testing = { extractReply, getLlmApi };
