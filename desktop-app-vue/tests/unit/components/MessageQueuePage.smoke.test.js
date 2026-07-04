import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the Options-API SFC resolves its module graph
// including the extracted `./messageQueuePageUtils` import. Helpers are covered
// by messageQueuePageUtils.test.js; they remain listed in the setup() return{}.
import MessageQueuePage from "@renderer/pages/p2p/MessageQueuePage.vue";

describe("MessageQueuePage.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(MessageQueuePage).toBeTruthy();
    expect(typeof MessageQueuePage).toBe("object");
  });
});
