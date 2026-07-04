import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./fileTransferPageUtils` import. This is an Options-API SFC —
// the setup() return object now references the imported helpers. Helpers are
// covered by fileTransferPageUtils.test.js.
import FileTransferPage from "@renderer/pages/p2p/FileTransferPage.vue";

describe("FileTransferPage.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(FileTransferPage).toBeTruthy();
    expect(typeof FileTransferPage).toBe("object");
  });
});
