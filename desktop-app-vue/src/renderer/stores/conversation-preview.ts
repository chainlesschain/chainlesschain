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
  version: 2;
  conversations: PreviewConversation[];
  activeId: string | null;
}

const STORAGE_KEY = "cc.preview.conversations";
const SCHEMA_VERSION = 2;
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

function cloneFiles(files: PreviewFileNode[]): PreviewFileNode[] {
  return files.map((file) => ({
    ...file,
    children: file.children ? cloneFiles(file.children) : undefined,
  }));
}

function createDemoFiles(projectFolder: string): PreviewFileNode[] {
  return [
    {
      id: `${projectFolder}-folder`,
      name: projectFolder,
      kind: "folder",
      children: [
        {
          id: `${projectFolder}-breakout`,
          name: "breakout.html",
          kind: "file",
        },
        { id: `${projectFolder}-index`, name: "index.html", kind: "file" },
        { id: `${projectFolder}-novel`, name: "novel.md", kind: "file" },
        { id: `${projectFolder}-snow`, name: "snow.html", kind: "file" },
        { id: `${projectFolder}-test`, name: "test.html", kind: "file" },
        {
          id: `${projectFolder}-png`,
          name: "tetris-gameplay.png",
          kind: "file",
        },
        { id: `${projectFolder}-tetris`, name: "tetris.html", kind: "file" },
      ],
    },
  ];
}

function createBlankFiles(): PreviewFileNode[] {
  return [
    {
      id: "workspace-root",
      name: "workspace",
      kind: "folder",
      children: [
        {
          id: "workspace-src",
          name: "src",
          kind: "folder",
          children: [
            { id: "workspace-app", name: "App.vue", kind: "file" },
            { id: "workspace-main", name: "main.ts", kind: "file" },
          ],
        },
        { id: "workspace-package", name: "package.json", kind: "file" },
        { id: "workspace-readme", name: "README.md", kind: "file" },
      ],
    },
  ];
}

function createDefaultRuntimeStatus(
  progress = 0,
  overrides: Partial<PreviewRuntimeStatus> = {},
): PreviewRuntimeStatus {
  return {
    progress,
    agentLabel: "Claude Code",
    modelLabel: "opus-4.7 / Max",
    skillLabel: "4 技能",
    toolLabel: "8 工具",
    terminalLabel: "终端",
    ...overrides,
  };
}

function createConversation(seed: {
  title: string;
  preview: string;
  projectName: string;
  relativeTime: string;
  workspaceLabel: string;
  promptLabel: string;
  messages: Array<Pick<BubbleMessage, "role" | "content">>;
  actionItems?: PreviewActionItem[];
  taskSteps?: PreviewTaskStep[];
  files?: PreviewFileNode[];
  runtimeStatus?: Partial<PreviewRuntimeStatus>;
  artifact?: PreviewArtifact;
}): PreviewConversation {
  const ts = now();
  return {
    id: makeId("conv"),
    title: seed.title,
    preview: seed.preview,
    createdAt: ts,
    updatedAt: ts,
    projectName: seed.projectName,
    relativeTime: seed.relativeTime,
    workspaceLabel: seed.workspaceLabel,
    promptLabel: seed.promptLabel,
    messages: seed.messages.map((message) => ({
      ...message,
      id: makeId("m"),
      createdAt: ts,
    })),
    actionItems: seed.actionItems ?? [],
    taskSteps: seed.taskSteps ?? [],
    files: cloneFiles(seed.files ?? createBlankFiles()),
    runtimeStatus: createDefaultRuntimeStatus(
      seed.runtimeStatus?.progress ?? 0,
      seed.runtimeStatus,
    ),
    artifact: seed.artifact,
  };
}

function seedConversations(): PreviewConversation[] {
  const demoConversation = createConversation({
    title: "demo04",
    preview: "在 test 目录创建 dashboard 基础结构",
    projectName: "demo04",
    relativeTime: "1m ago",
    workspaceLabel: "workspace",
    promptLabel: "/dm-dashboard 在 test 目录创建一个 dashboard 的基础结构",
    messages: [
      {
        role: "assistant",
        content:
          "先看看当前目录状况。这是个多步骤任务，我会先列目录、建立结构，再逐步生成配置和入口文件。",
      },
    ],
    actionItems: [
      {
        id: "demo-action-1",
        label: "List current directory",
        detail: "已完成",
        status: "done",
      },
      {
        id: "demo-action-2",
        label: "TodoWrite",
        detail: "任务拆解完成",
        status: "done",
      },
      {
        id: "demo-action-3",
        label: "Create test project directory structure",
        detail: "目录已建立",
        status: "done",
      },
      {
        id: "demo-action-4",
        label: "Write package.json / tsconfig / vite.config.ts",
        detail: "4 个文件已输出",
        status: "done",
      },
    ],
    taskSteps: [
      {
        id: "demo-task-1",
        label: "Create project config files",
        detail: "package.json, tsconfig, vite, tailwind",
        status: "done",
      },
      {
        id: "demo-task-2",
        label: "Create entry files",
        detail: "index.html, main.tsx, App.tsx, index.css",
        status: "running",
      },
      {
        id: "demo-task-3",
        label: "Create lib, types, api base layer",
        status: "pending",
      },
      {
        id: "demo-task-4",
        label: "Create shadcn/ui primitives",
        detail: "button, card, badge, input, dialog, toast, spinner",
        status: "pending",
      },
      {
        id: "demo-task-5",
        label: "Create hooks",
        detail: "use-auth, use-theme, use-toast",
        status: "pending",
      },
    ],
    files: createDemoFiles("test"),
    runtimeStatus: {
      progress: 6,
      toolLabel: "工具 (8)",
    },
    artifact: {
      title: "运行说明",
      content:
        "这是一个 Claude Box 风格的桌面工作台预览。左侧是项目列表，中间是执行流和任务清单，右侧是文件面板，底部显示模型与工具状态。",
    },
  });

  const workspaceConversation = createConversation({
    title: "workspace",
    preview: "整理本地知识库和项目索引",
    projectName: "workspace",
    relativeTime: "12h ago",
    workspaceLabel: "notes",
    promptLabel: "整理本地知识库并输出索引摘要",
    messages: [
      {
        role: "assistant",
        content:
          "知识库扫描已经完成。接下来可以继续补充标签、清洗重复文档，或者直接生成新的索引结构。",
      },
    ],
    taskSteps: [
      {
        id: "workspace-task-1",
        label: "Scan markdown notes",
        status: "done",
      },
      {
        id: "workspace-task-2",
        label: "Merge duplicated tags",
        status: "pending",
      },
    ],
    runtimeStatus: {
      progress: 42,
      modelLabel: "sonnet / Balanced",
      skillLabel: "2 技能",
      toolLabel: "工具 (3)",
    },
    artifact: {
      title: "索引建议",
      content:
        "建议把 notes、imports、projects 分成三个一级目录，并为每个目录生成独立的 embedding 索引。",
    },
  });

  const releaseConversation = createConversation({
    title: "ClaudeBox",
    preview: "整理新版桌面端视觉方向",
    projectName: "ClaudeBox",
    relativeTime: "12h ago",
    workspaceLabel: "design",
    promptLabel: "整理新版桌面端视觉方向",
    messages: [
      {
        role: "assistant",
        content:
          "视觉方向建议保持 macOS 风格的浅色窗体、细边框和柔和阴影，同时让对话流和任务进度处于同一视线层级。",
      },
    ],
    taskSteps: [
      {
        id: "release-task-1",
        label: "Collect reference screenshots",
        status: "done",
      },
      {
        id: "release-task-2",
        label: "Unify desktop shell spacing",
        status: "pending",
      },
    ],
    runtimeStatus: {
      progress: 18,
      modelLabel: "design preview",
      skillLabel: "1 技能",
      toolLabel: "工具 (2)",
    },
  });

  return [demoConversation, workspaceConversation, releaseConversation];
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

function isPreviewFileNode(value: unknown): value is PreviewFileNode {
  if (!value || typeof value !== "object") {
    return false;
  }
  const node = value as Record<string, unknown>;
  if (
    typeof node.id !== "string" ||
    typeof node.name !== "string" ||
    (node.kind !== "file" && node.kind !== "folder")
  ) {
    return false;
  }
  if (node.children == null) {
    return true;
  }
  return Array.isArray(node.children) && node.children.every(isPreviewFileNode);
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

  const files = Array.isArray(conversation.files)
    ? conversation.files.filter(isPreviewFileNode)
    : createBlankFiles();

  return {
    id: conversation.id,
    title: conversation.title,
    preview: conversation.preview,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
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

function loadFromStorage(): PersistState | null {
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
    if (
      parsed.version !== SCHEMA_VERSION ||
      !Array.isArray(parsed.conversations)
    ) {
      return null;
    }

    const conversations = parsed.conversations
      .map(normalizeConversation)
      .filter((item): item is PreviewConversation => item !== null);

    const activeId =
      typeof parsed.activeId === "string" &&
      conversations.some((conversation) => conversation.id === parsed.activeId)
        ? parsed.activeId
        : (conversations[0]?.id ?? null);

    return {
      version: SCHEMA_VERSION,
      conversations,
      activeId,
    };
  } catch {
    return null;
  }
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
      if (loaded && loaded.conversations.length > 0) {
        this.conversations = loaded.conversations;
        this.activeId = loaded.activeId;
      } else {
        const seeded = seedConversations();
        this.conversations = seeded;
        this.activeId = seeded[0]?.id ?? null;
        this._persist();
      }
      this.restored = true;
    },

    select(id: string) {
      if (this.conversations.some((conversation) => conversation.id === id)) {
        this.activeId = id;
        this._persist();
      }
    },

    createBlank(): string {
      const ts = now();
      const conversation: PreviewConversation = {
        id: makeId("conv"),
        title: DEFAULT_NEW_TITLE,
        preview: "",
        createdAt: ts,
        updatedAt: ts,
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
  seedConversations,
};
