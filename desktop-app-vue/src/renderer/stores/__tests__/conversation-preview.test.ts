import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  useConversationPreviewStore,
  __testing,
} from "../conversation-preview";

const { STORAGE_KEY, SCHEMA_VERSION } = __testing;

function rawState() {
  return localStorage.getItem(STORAGE_KEY);
}

describe("useConversationPreviewStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("starts empty when storage is empty and persists the empty state", () => {
    const store = useConversationPreviewStore();
    store.restore();
    expect(store.conversations).toHaveLength(0);
    expect(store.activeId).toBeNull();
    expect(store.restored).toBe(true);
    expect(rawState()).toBeTruthy();
  });

  it("hydrates from previously persisted state", () => {
    const first = useConversationPreviewStore();
    first.restore();
    first.appendMessage("user", "hello world");
    const firstId = first.activeId;

    setActivePinia(createPinia());
    const second = useConversationPreviewStore();
    second.restore();
    expect(second.activeId).toBe(firstId);
    expect(second.active?.messages.at(-1)?.content).toBe("hello world");
  });

  it("rejects an invalid schema version and starts empty", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 999, conversations: [] }),
    );
    const store = useConversationPreviewStore();
    store.restore();
    expect(store.conversations).toHaveLength(0);
    expect(store.activeId).toBeNull();
  });

  it("rejects malformed JSON without throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const store = useConversationPreviewStore();
    expect(() => store.restore()).not.toThrow();
    expect(store.conversations).toHaveLength(0);
  });

  it("migrates v2 storage by rewriting legacy agentLabel and re-persisting as v3", () => {
    const ts = Date.now();
    const v2Payload = {
      version: 2,
      activeId: "conv-legacy",
      conversations: [
        {
          id: "conv-legacy",
          title: "legacy",
          preview: "preview",
          createdAt: ts,
          updatedAt: ts,
          projectName: "legacy",
          relativeTime: "1m ago",
          workspaceLabel: "workspace",
          promptLabel: "",
          messages: [
            {
              id: "m-legacy",
              role: "user",
              content: "hello",
              createdAt: ts,
            },
          ],
          actionItems: [],
          taskSteps: [],
          files: [],
          runtimeStatus: {
            progress: 0,
            agentLabel: "Claude Code",
            modelLabel: "opus-4.7 / Max",
            skillLabel: "4 技能",
            toolLabel: "8 工具",
            terminalLabel: "终端",
          },
        },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v2Payload));

    const store = useConversationPreviewStore();
    store.restore();

    expect(store.conversations).toHaveLength(1);
    expect(store.activeId).toBe("conv-legacy");
    expect(store.active?.runtimeStatus.agentLabel).toBe("ChainlessChain");

    const persisted = JSON.parse(rawState()!);
    expect(persisted.version).toBe(SCHEMA_VERSION);
    expect(persisted.conversations[0].runtimeStatus.agentLabel).toBe(
      "ChainlessChain",
    );
  });

  it("preserves a customized v2 agentLabel during migration", () => {
    const ts = Date.now();
    const v2Payload = {
      version: 2,
      activeId: "conv-custom",
      conversations: [
        {
          id: "conv-custom",
          title: "custom",
          preview: "",
          createdAt: ts,
          updatedAt: ts,
          projectName: "custom",
          relativeTime: "1m ago",
          workspaceLabel: "workspace",
          promptLabel: "",
          messages: [],
          actionItems: [],
          taskSteps: [],
          files: [],
          runtimeStatus: {
            progress: 0,
            agentLabel: "MyCustomAgent",
            modelLabel: "x",
            skillLabel: "x",
            toolLabel: "x",
            terminalLabel: "x",
          },
        },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v2Payload));

    const store = useConversationPreviewStore();
    store.restore();
    expect(store.active?.runtimeStatus.agentLabel).toBe("MyCustomAgent");
  });

  it("createBlank() prepends and becomes active", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const previousId = store.activeId;
    const newId = store.createBlank();
    expect(store.conversations[0].id).toBe(newId);
    expect(store.activeId).toBe(newId);
    expect(store.activeId).not.toBe(previousId);
    expect(store.active?.projectName).toBe("未命名项目");
  });

  it("appendMessage() updates preview, title on first user message, prompt label, and persists", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const before = store.active!.updatedAt;
    store.appendMessage("user", "the quick brown fox jumps over the lazy dog");
    const conversation = store.active!;
    expect(conversation.messages.at(-1)?.content).toBe(
      "the quick brown fox jumps over the lazy dog",
    );
    expect(conversation.title).toBe("the quick brown fox jumps ov");
    expect(conversation.promptLabel).toBe(
      "the quick brown fox jumps over the lazy dog",
    );
    expect(conversation.preview.length).toBeLessThanOrEqual(56);
    expect(conversation.updatedAt).toBeGreaterThanOrEqual(before);
    expect(rawState()).toContain("the quick brown fox");
  });

  it("appendMessage() ignores empty input", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const beforeLength = store.active!.messages.length;
    store.appendMessage("user", "");
    store.appendMessage("user", "   \t\n ");
    expect(store.active!.messages.length).toBe(beforeLength);
  });

  it("select() only accepts known ids", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const firstId = store.createBlank();
    const secondId = store.createBlank();
    store.select(firstId);
    expect(store.activeId).toBe(firstId);
    store.select("unknown-id");
    expect(store.activeId).toBe(firstId);
    expect(secondId).not.toBe(firstId);
  });

  it("remove() drops a conversation and picks a new active one", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const firstId = store.createBlank();
    const secondId = store.createBlank();
    store.remove(secondId);
    expect(
      store.conversations.some((conversation) => conversation.id === secondId),
    ).toBe(false);
    expect(store.activeId).toBe(firstId);
  });

  it("clearAll() wipes state and storage", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.clearAll();
    expect(store.conversations).toHaveLength(0);
    expect(store.activeId).toBeNull();
    expect(rawState()).toBeNull();
  });

  it("persisted state uses the declared schema version", () => {
    const store = useConversationPreviewStore();
    store.restore();
    const raw = JSON.parse(rawState()!);
    expect(raw.version).toBe(SCHEMA_VERSION);
    expect(Array.isArray(raw.conversations)).toBe(true);
  });

  it("appendMessage() on empty store auto-creates a conversation", () => {
    const store = useConversationPreviewStore();
    store.appendMessage("user", "first ever");
    expect(store.conversations.length).toBe(1);
    expect(store.active?.messages.at(-1)?.content).toBe("first ever");
  });

  it("appendAssistantMessage() appends without overwriting the default title", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    expect(store.active!.title).toBe("新会话");
    store.appendAssistantMessage("assistant says hi from a brand new chat");
    expect(store.active!.title).toBe("新会话");
    expect(store.active!.messages.at(-1)?.role).toBe("assistant");
  });

  it("setGenerating() toggles the generating flag", () => {
    const store = useConversationPreviewStore();
    expect(store.isGenerating).toBe(false);
    store.setGenerating(true);
    expect(store.isGenerating).toBe(true);
    store.setGenerating(false);
    expect(store.isGenerating).toBe(false);
  });

  it("setModelLabel() updates the active conversation model label and persists", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    store.setModelLabel("gpt-4o-mini");
    expect(store.active!.runtimeStatus.modelLabel).toBe("gpt-4o-mini");
    const persisted = JSON.parse(rawState()!);
    const conversation = persisted.conversations.find(
      (item: { id: string }) => item.id === store.activeId,
    );
    expect(conversation.runtimeStatus.modelLabel).toBe("gpt-4o-mini");
  });

  it("setModelLabel() ignores empty input and missing active conversation", () => {
    const store = useConversationPreviewStore();
    store.restore();
    expect(() => store.setModelLabel("anything")).not.toThrow();
    expect(store.active).toBeUndefined();
    store.createBlank();
    const before = store.active!.runtimeStatus.modelLabel;
    store.setModelLabel("   ");
    expect(store.active!.runtimeStatus.modelLabel).toBe(before);
  });

  it("beginStreamingAssistant() seeds an empty assistant bubble", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const id = store.beginStreamingAssistant();
    expect(id).toBeTruthy();
    const lastMessage = store.active!.messages.at(-1)!;
    expect(lastMessage.id).toBe(id);
    expect(lastMessage.role).toBe("assistant");
    expect(lastMessage.content).toBe("");
  });

  it("updateAssistantContent() updates the target bubble", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const id = store.beginStreamingAssistant()!;
    store.updateAssistantContent(id, "partial");
    expect(
      store.active!.messages.find((message) => message.id === id)?.content,
    ).toBe("partial");
    expect(store.active!.preview).toBe("partial");
  });

  it("updateAssistantContent() is a no-op for invalid ids", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    store.appendMessage("user", "hello");
    const userMessageId = store.active!.messages.at(-1)!.id;
    store.updateAssistantContent(userMessageId, "hijacked");
    expect(
      store.active!.messages.find((message) => message.id === userMessageId)
        ?.content,
    ).toBe("hello");
  });

  it("finalizeStreamingAssistant() sets final content and persists", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    const id = store.beginStreamingAssistant()!;
    store.finalizeStreamingAssistant(id, "Hello world");
    expect(
      store.active!.messages.find((message) => message.id === id)?.content,
    ).toBe("Hello world");
    const persisted = JSON.parse(rawState()!);
    const conversation = persisted.conversations.find(
      (item: { id: string }) => item.id === store.activeId,
    );
    expect(conversation.messages.at(-1).content).toBe("Hello world");
  });

  it("removeMessage() drops a specific message by id", () => {
    const store = useConversationPreviewStore();
    store.restore();
    store.createBlank();
    store.appendMessage("user", "one");
    const userId = store.active!.messages.at(-1)!.id;
    const streamId = store.beginStreamingAssistant()!;
    store.removeMessage(streamId);
    expect(
      store.active!.messages.some((message) => message.id === streamId),
    ).toBe(false);
    expect(
      store.active!.messages.some((message) => message.id === userId),
    ).toBe(true);
  });
});
