import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./conversationSearchPanelUtils` import (which now owns the
// MessageType + escapeHtml deps). Helpers are covered by
// conversationSearchPanelUtils.test.js.
import ConversationSearchPanel from "@renderer/components/projects/ConversationSearchPanel.vue";

describe("ConversationSearchPanel.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ConversationSearchPanel).toBeTruthy();
    expect(typeof ConversationSearchPanel).toBe("object");
  });
});
