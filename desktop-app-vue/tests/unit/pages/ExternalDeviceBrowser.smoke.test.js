import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./externalDeviceBrowserUtils` import. A full mount is avoided —
// this page's onMounted kicks off loadDevices + transfer polling that aren't
// meaningfully stubbable; the helpers are covered by externalDeviceBrowserUtils
// .test.js and the util-import-exposure pattern is proven by the
// OrganizationKnowledgePage/MarketPage component suites.
import ExternalDeviceBrowser from "@renderer/pages/ExternalDeviceBrowser.vue";

describe("ExternalDeviceBrowser.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ExternalDeviceBrowser).toBeTruthy();
    expect(typeof ExternalDeviceBrowser).toBe("object");
  });
});
