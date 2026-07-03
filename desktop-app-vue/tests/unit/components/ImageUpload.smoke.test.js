import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./imageUploadUtils` import. Helpers are covered by
// imageUploadUtils.test.js.
import ImageUpload from "@renderer/components/ImageUpload.vue";

describe("ImageUpload.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ImageUpload).toBeTruthy();
    expect(typeof ImageUpload).toBe("object");
  });
});
