import { defineStore } from "pinia";

export type BubbleRole = "user" | "assistant";
export type PreviewStepStatus = "done" | "running" | "pending";
export type PreviewFileKind = "file" | "folder";

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

export interface PreviewActionItem {
  id: string;
  label: string;
  detail?: string;
  status: PreviewStepStatus;
}

export interface PreviewTaskStep {
  id: string;
  label: string;
  detail?: string;
  status: PreviewStepStatus;
}

export interface PreviewFileNode {
  id: string;
  name: string;
  kind: PreviewFileKind;
  children?: PreviewFileNode[];
}

export interface PreviewRuntimeStatus {
  progress: number;
  agentLabel: string;
  modelLabel: string;
  skillLabel: string;
  toolLabel: string;
  terminalLabel: string;
}

export interface PreviewConversation {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  projectId: string | null;
  projectName: string;
  relativeTime: string;
  workspaceLabel: string;
  promptLabel: string;
  messages: BubbleMessage[];
  actionItems: PreviewActionItem[];
  taskSteps: PreviewTaskStep[];
  files: PreviewFileNode[];
  runtimeStatus: PreviewRuntimeStatus;
  artifact?: PreviewArtifact;
}

interface PersistState {
  version: number;
  conversations: PreviewConversation[];
  activeId: string | null;
}

const STORAGE_KEY = "cc.preview.conversations";
const SCHEMA_VERSION = 3;
const MAX_PREVIEW_CHARS = 56;
const MAX_TITLE_CHARS = 28;
const DEFAULT_NEW_TITLE = "新会话";
const DEFAULT_PROJECT_NAME = "未命名项目";

function now(): number {
  return Date.now();
}

function makeId(prefix: string): string {
  return `${prefix}-${now()}-${Math.floor(Math.random() * 1000)}`;
}

function createBlankFiles(): PreviewFileNode[] {
  return [];
}

function isAccidentalEmpty(conversation: PreviewConversation): boolean {
  return (
    conversation.messages.length === 0 &&
    conversation.title === DEFAULT_NEW_TITLE &&
    !conversation.projectId &&
    !conversation.preview
  );
}

function createDefaultRuntimeStatus(
  progress = 0,
  overrides: Partial<PreviewRuntimeStatus> = {},
): PreviewRuntimeStatus {
  return {
    progress,
    agentLabel: "ChainlessChain",
    modelLabel: "opus-4.7 / Max",
    skillLabel: "4 技能",
    toolLabel: "8 工具",
    terminalLabel: "终端",
    ...overrides,
  };
}

function isStepStatus(value: unknown): value is PreviewStepStatus {
  return value === "done" || value === "running" || value === "pending";
}

function isBubbleMessage(value: unknown): value is BubbleMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.createdAt === "number"
  );
}

function normalizeActionItems(value: unknown): PreviewActionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const source = item as Record<string, unknown>;
      return {
        id:
          typeof source.id === "string"
            ? source.id
            : `action-${index}-${Math.random().toString(16).slice(2, 6)}`,
        label: typeof source.label === "string" ? source.label : "未命名动作",
        detail: typeof source.detail === "string" ? source.detail : undefined,
        status: isStepStatus(source.status) ? source.status : "pending",
      };
    });
}

function normalizeTaskSteps(value: unknown): PreviewTaskStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const source = item as Record<string, unknown>;
      return {
        id:
          typeof source.id === "string"
            ? source.id
            : `task-${index}-${Math.random().toString(16).slice(2, 6)}`,
        label: typeof source.label === "string" ? source.label : "未命名任务",
        detail: typeof source.detail === "string" ? source.detail : undefined,
        status: isStepStatus(source.status) ? source.status : "pending",
      };
    });
}

function normalizeRuntimeStatus(value: unknown): PreviewRuntimeStatus {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return createDefaultRuntimeStatus(
    typeof source.progress === "number" ? source.progress : 0,
    {
      agentLabel:
        typeof source.agentLabel === "string" ? source.agentLabel : undefined,
      modelLabel:
        typeof source.modelLabel === "string" ? source.modelLabel : undefined,
      skillLabel:
        typeof source.skillLabel === "string" ? source.skillLabel : undefined,
      toolLabel:
        typeof source.toolLabel === "string" ? source.toolLabel : undefined,
      terminalLabel:
        typeof source.terminalLabel === "string"
          ? source.terminalLabel
          : undefined,
    },
  );
}

function normalizeArtifact(value: unknown): PreviewArtifact | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const artifact = value as Record<string, unknown>;
  if (
    typeof artifact.title !== "string" ||
    typeof artifact.content !== "string"
  ) {
    return undefined;
  }
  return {
    title: artifact.title,
    content: artifact.content,
  };
}

function normalizeConversation(value: unknown): PreviewConversation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const conversation = value as Record<string, unknown>;
  if (
    typeof conversation.id !== "string" ||
    typeof conversation.title !== "string" ||
    typeof conversation.preview !== "string" ||
    typeof conversation.createdAt !== "number" ||
    typeof conversation.updatedAt !== "number" ||
    !Array.isArray(conversation.messages) ||
    !conversation.messages.every(isBubbleMessage)
  ) {
    return null;
  }

  // Drop any persisted `files` payload — V6 preview now loads files live
  // from the bound project's real directory via `project:get-files`.
  // Older v2/v3 storage carried demo seed file trees that pollute the UI.
  const files = createBlankFiles();

  return {
    id: conversation.id,
    title: conversation.title,
    preview: conversation.preview,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    projectId:
      typeof conversation.projectId === "string" && conversation.projectId
        ? conversation.projectId
        : null,
    projectName:
      typeof conversation.projectName === "string"
        ? conversation.projectName
        : DEFAULT_PROJECT_NAME,
    relativeTime:
      typeof conversation.relativeTime === "string"
        ? conversation.relativeTime
        : "just now",
    workspaceLabel:
      typeof conversation.workspaceLabel === "string"
        ? conversation.workspaceLabel
        : "workspace",
    promptLabel:
      typeof conversation.promptLabel === "string"
        ? conversation.promptLabel
        : "",
    messages: conversation.messages,
    actionItems: normalizeActionItems(conversation.actionItems),
    taskSteps: normalizeTaskSteps(conversation.taskSteps),
    files,
    runtimeStatus: normalizeRuntimeStatus(conversation.runtimeStatus),
    artifact: normalizeArtifact(conversation.artifact),
  };
}

interface LoadResult {
  state: PersistState;
  migrated: boolean;
}

function loadFromStorage(): LoadResult | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistState>;
    const isV2 = parsed.version === 2;
    const isCurrent = parsed.version === SCHEMA_VERSION;
    if ((!isV2 && !isCurrent) || !Array.isArray(parsed.conversations)) {
      return null;
    }

    let conversations = parsed.conversations
      .map(normalizeConversation)
      .filter((item): item is PreviewConversation => item !== null);

    if (isV2) {
      conversations = conversations.map(migrateLegacyAgentLabel);
    }

    const activeId =
      typeof parsed.activeId === "string" &&
      conversations.some((conversation) => conversation.id === parsed.activeId)
        ? parsed.activeId
        : (conversations[0]?.id ?? null);

    return {
      state: {
        version: SCHEMA_VERSION,
        conversations,
        activeId,
      },
      migrated: isV2,
    };
  } catch {
    return null;
  }
}

const LEGACY_AGENT_LABEL = "Claude Code";

function migrateLegacyAgentLabel(
  conversation: PreviewConversation,
): PreviewConversation {
  if (conversation.runtimeStatus.agentLabel !== LEGACY_AGENT_LABEL) {
    return conversation;
  }
  return {
    ...conversation,
    runtimeStatus: {
      ...conversation.runtimeStatus,
      agentLabel: "ChainlessChain",
    },
  };
}

function saveToStorage(state: PersistState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota or private mode */
  }
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
      return state.conversations.find(
        (conversation) => conversation.id === state.activeId,
      );
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
      if (loaded && loaded.state.conversations.length > 0) {
        this.conversations = loaded.state.conversations;
        this.activeId = loaded.state.activeId;
        const pruned = this.pruneEmpty();
        if (loaded.migrated || pruned > 0) {
          this._persist();
        }
      } else {
        this.conversations = [];
        this.activeId = null;
        this._persist();
      }
      this.restored = true;
    },

    /**
     * Drops conversations that look like accidental empty shells (no messages,
     * default title, no project binding, no preview). The currently active
     * conversation is kept regardless so the user's in-flight blank stays.
     * Returns the number of conversations removed.
     */
    pruneEmpty(): number {
      const before = this.conversations.length;
      this.conversations = this.conversations.filter(
        (conversation) =>
          conversation.id === this.activeId || !isAccidentalEmpty(conversation),
      );
      if (
        this.activeId &&
        !this.conversations.some(
          (conversation) => conversation.id === this.activeId,
        )
      ) {
        this.activeId = this.conversations[0]?.id ?? null;
      }
      return before - this.conversations.length;
    },

    select(id: string) {
      if (this.conversations.some((conversation) => conversation.id === id)) {
        this.activeId = id;
        this._persist();
      }
    },

    createBlank(): string {
      // Reuse the active conversation if it's still pristine — avoids the
      // pile of "新会话" entries when users tap "+" repeatedly without ever
      // sending a message.
      const current = this.active;
      if (current && isAccidentalEmpty(current)) {
        return current.id;
      }

      const ts = now();
      const conversation: PreviewConversation = {
        id: makeId("conv"),
        title: DEFAULT_NEW_TITLE,
        preview: "",
        createdAt: ts,
        updatedAt: ts,
        projectId: null,
        projectName: DEFAULT_PROJECT_NAME,
        relativeTime: "just now",
        workspaceLabel: "workspace",
        promptLabel: "",
        messages: [],
        actionItems: [],
        taskSteps: [],
        files: createBlankFiles(),
        runtimeStatus: createDefaultRuntimeStatus(),
      };

      this.conversations.unshift(conversation);
      this.activeId = conversation.id;
      this._persist();
      return conversation.id;
    },

    appendMessage(role: BubbleRole, content: string) {
      const text = content.trim();
      if (!text) {
        return;
      }

      if (!this.active) {
        this.createBlank();
      }

      const conversation = this.active!;
      const ts = now();
      conversation.messages.push({
        id: makeId("m"),
        role,
        content: text,
        createdAt: ts,
      });
      conversation.preview = text.slice(0, MAX_PREVIEW_CHARS);
      conversation.updatedAt = ts;
      conversation.relativeTime = "just now";

      if (role === "user") {
        conversation.promptLabel = text;
        if (conversation.title === DEFAULT_NEW_TITLE) {
          conversation.title =
            text.slice(0, MAX_TITLE_CHARS) || DEFAULT_NEW_TITLE;
        }
      }

      this._persist();
    },

    appendAssistantMessage(content: string) {
      this.appendMessage("assistant", content);
    },

    setGenerating(flag: boolean) {
      this.isGenerating = flag;
    },

    bindProject(projectId: string | null, projectName?: string) {
      const conversation = this.active;
      if (!conversation) {
        return;
      }
      conversation.projectId = projectId;
      if (typeof projectName === "string") {
        const trimmed = projectName.trim();
        conversation.projectName = trimmed || DEFAULT_PROJECT_NAME;
      } else if (!projectId) {
        conversation.projectName = DEFAULT_PROJECT_NAME;
      }
      conversation.updatedAt = now();
      this._persist();
    },

    setModelLabel(label: string) {
      const conversation = this.active;
      if (!conversation) {
        return;
      }
      const next = label.trim();
      if (!next) {
        return;
      }
      conversation.runtimeStatus.modelLabel = next;
      this._persist();
    },

    beginStreamingAssistant(): string | null {
      if (!this.active) {
        this.createBlank();
      }

      const conversation = this.active!;
      const ts = now();
      const id = makeId("m");

      conversation.messages.push({
        id,
        role: "assistant",
        content: "",
        createdAt: ts,
      });
      conversation.updatedAt = ts;
      conversation.relativeTime = "just now";
      this._persist();
      return id;
    },

    updateAssistantContent(messageId: string, content: string) {
      const conversation = this.active;
      if (!conversation) {
        return;
      }

      const message = conversation.messages.find(
        (candidate) => candidate.id === messageId,
      );
      if (!message || message.role !== "assistant") {
        return;
      }

      message.content = content;
      conversation.preview = content.slice(0, MAX_PREVIEW_CHARS);
      conversation.updatedAt = now();
      conversation.relativeTime = "just now";
    },

    finalizeStreamingAssistant(messageId: string, content: string) {
      this.updateAssistantContent(messageId, content);
      this._persist();
    },

    removeMessage(messageId: string) {
      const conversation = this.active;
      if (!conversation) {
        return;
      }

      const index = conversation.messages.findIndex(
        (message) => message.id === messageId,
      );
      if (index < 0) {
        return;
      }

      conversation.messages.splice(index, 1);
      this._persist();
    },

    remove(id: string) {
      const index = this.conversations.findIndex(
        (conversation) => conversation.id === id,
      );
      if (index < 0) {
        return;
      }

      this.conversations.splice(index, 1);
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
};
