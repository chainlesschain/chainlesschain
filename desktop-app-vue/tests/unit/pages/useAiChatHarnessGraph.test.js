import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/utils/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

import { useAiChatHarness } from "../../../src/renderer/pages/useAiChatHarness.js";

describe("useAiChatHarness graph hydration", () => {
  let codingAgentStore;

  beforeEach(() => {
    codingAgentStore = {
      harnessStatus: null,
      backgroundTasks: [],
      selectedBackgroundTask: null,
      selectedBackgroundTaskHistory: null,
      refreshHarnessStatus: vi.fn().mockResolvedValue(undefined),
      loadBackgroundTasks: vi.fn().mockResolvedValue(undefined),
      fetchTaskGraph: vi.fn().mockResolvedValue(null),
      fetchSessionEvents: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("hydrates the persistent graph and event timeline with harness state", async () => {
    const harness = useAiChatHarness({
      codingAgentStore,
      currentCodingAgentSessionId: ref("session-graph-1"),
      activeConversationId: ref("conversation-1"),
    });

    await harness.refreshCodingAgentHarnessPanel({ silent: true });

    expect(codingAgentStore.refreshHarnessStatus).toHaveBeenCalledOnce();
    expect(codingAgentStore.loadBackgroundTasks).toHaveBeenCalledOnce();
    expect(codingAgentStore.fetchTaskGraph).toHaveBeenCalledWith(
      "session-graph-1",
    );
    expect(codingAgentStore.fetchSessionEvents).toHaveBeenCalledWith(
      "session-graph-1",
    );
  });

  it("does not issue unbound graph/event reads without an active session", async () => {
    const harness = useAiChatHarness({
      codingAgentStore,
      currentCodingAgentSessionId: ref(null),
      activeConversationId: ref("conversation-1"),
    });

    await harness.refreshCodingAgentHarnessPanel({ silent: true });

    expect(codingAgentStore.fetchTaskGraph).not.toHaveBeenCalled();
    expect(codingAgentStore.fetchSessionEvents).not.toHaveBeenCalled();
  });
});
