import { defineStore } from "pinia";

export type BubbleRole = "user" | "assistant";

export interface BubbleMessage {
  id: string;
  role: BubbleRole;
  content: string;
  createdAt: number;
}

export interface PreviewArtifact {
  title: string;
  content: string;
}

export interface PreviewConversation {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  messages: BubbleMessage[];
  artifact?: PreviewArtifact;
}

interface PersistState {
  version: 1;
  conversations: PreviewConversation[];
  activeId: string | null;
}

const STORAGE_KEY = "cc.preview.conversations";
const SCHEMA_VERSION = 1;
const MAX_PREVIEW_CHARS = 40;
const MAX_TITLE_CHARS = 20;

function now(): number {
  return Date.now();
}

function makeId(prefix: string): string {
  return `${prefix}-${now()}-${Math.floor(Math.random() * 1000)}`;
}

function isConversation(value: unknown): value is PreviewConversation {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.preview === "string" &&
    typeof c.createdAt === "number" &&
    typeof c.updatedAt === "number" &&
    Array.isArray(c.messages)
  );
}

function loadFromStorage(): PersistState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistState>;
    if (parsed.version !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.conversations)) return null;
    const conversations = parsed.conversations.filter(isConversation);
    const activeId =
      typeof parsed.activeId === "string" &&
      conversations.some((c) => c.id === parsed.activeId)
        ? parsed.activeId
        : (conversations[0]?.id ?? null);
    return { version: SCHEMA_VERSION, conversations, activeId };
  } catch {
    return null;
  }
}

function saveToStorage(state: PersistState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or SSR */
  }
}

function seedWelcomeConversation(): PreviewConversation {
  const ts = now();
  return {
    id: makeId("conv"),
    title: "欢迎使用 v6 预览",
    preview: "Chat-First 个人办公壳",
    createdAt: ts,
    updatedAt: ts,
    messages: [
      {
        id: makeId("m"),
        role: "assistant",
        content:
          "欢迎使用 ChainlessChain 桌面版 v6 预览壳。左侧是会话历史，底部 4 颗按钮是去中心化入口（P2P / 交易 / 社交 / U-Key）。",
        createdAt: ts,
      },
    ],
    artifact: {
      title: "预览说明",
      content:
        "该壳处于 /v6-preview 路由，不影响既有 /v2 壳。数据留在本机，支持 4 种主题，会话持久化到 localStorage。",
    },
  };
}

export const useConversationPreviewStore = defineStore("conversation-preview", {
  state: () => ({
    conversations: [] as PreviewConversation[],
    activeId: null as string | null,
    restored: false,
    isGenerating: false,
  }),

  getters: {
    active(state): PreviewConversation | undefined {
      return state.conversations.find((c) => c.id === state.activeId);
    },
  },

  actions: {
    _persist() {
      saveToStorage({
        version: SCHEMA_VERSION,
        conversations: this.conversations,
        activeId: this.activeId,
      });
    },

    restore() {
      const loaded = loadFromStorage();
      if (loaded && loaded.conversations.length > 0) {
        this.conversations = loaded.conversations;
        this.activeId = loaded.activeId;
      } else {
        const welcome = seedWelcomeConversation();
        this.conversations = [welcome];
        this.activeId = welcome.id;
        this._persist();
      }
      this.restored = true;
    },

    select(id: string) {
      if (this.conversations.some((c) => c.id === id)) {
        this.activeId = id;
        this._persist();
      }
    },

    createBlank(): string {
      const ts = now();
      const conv: PreviewConversation = {
        id: makeId("conv"),
        title: "新会话",
        preview: "",
        createdAt: ts,
        updatedAt: ts,
        messages: [],
      };
      this.conversations.unshift(conv);
      this.activeId = conv.id;
      this._persist();
      return conv.id;
    },

    appendMessage(role: BubbleRole, content: string) {
      const text = content.trim();
      if (!text) return;
      if (!this.active) this.createBlank();
      const conv = this.active!;
      const ts = now();
      conv.messages.push({
        id: makeId("m"),
        role,
        content: text,
        createdAt: ts,
      });
      conv.preview = text.slice(0, MAX_PREVIEW_CHARS);
      conv.updatedAt = ts;
      if (role === "user" && conv.title === "新会话") {
        conv.title = text.slice(0, MAX_TITLE_CHARS) || "新会话";
      }
      this._persist();
    },

    appendAssistantMessage(content: string) {
      this.appendMessage("assistant", content);
    },

    setGenerating(flag: boolean) {
      this.isGenerating = flag;
    },

    beginStreamingAssistant(): string | null {
      if (!this.active) this.createBlank();
      const conv = this.active!;
      const ts = now();
      const id = makeId("m");
      conv.messages.push({
        id,
        role: "assistant",
        content: "",
        createdAt: ts,
      });
      conv.updatedAt = ts;
      this._persist();
      return id;
    },

    updateAssistantContent(messageId: string, content: string) {
      const conv = this.active;
      if (!conv) return;
      const msg = conv.messages.find((m) => m.id === messageId);
      if (!msg || msg.role !== "assistant") return;
      msg.content = content;
      conv.preview = content.slice(0, MAX_PREVIEW_CHARS);
      conv.updatedAt = now();
    },

    finalizeStreamingAssistant(messageId: string, content: string) {
      this.updateAssistantContent(messageId, content);
      this._persist();
    },

    removeMessage(messageId: string) {
      const conv = this.active;
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      conv.messages.splice(idx, 1);
      this._persist();
    },

    remove(id: string) {
      const idx = this.conversations.findIndex((c) => c.id === id);
      if (idx < 0) return;
      this.conversations.splice(idx, 1);
      if (this.activeId === id) {
        this.activeId = this.conversations[0]?.id ?? null;
      }
      this._persist();
    },

    clearAll() {
      this.conversations = [];
      this.activeId = null;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    },
  },
});

export const __testing = {
  STORAGE_KEY,
  SCHEMA_VERSION,
  seedWelcomeConversation,
};
