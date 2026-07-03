import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import-compile smoke: pulling in the SFC resolves its module graph, including
// the extracted `./projectDetailPageUtils` import. A broken path / missing
// export would fail this import. (A full mount is avoided: this page's
// onMounted + useProjectGit status-polling are not meaningfully stubbable, and
// the helpers themselves are covered by projectDetailPageUtils.test.js while the
// util-import-exposure pattern is proven by the CollaborationPage/MarketPage
// component suites in the same batch.)
import ProjectDetailPage from "@renderer/pages/projects/ProjectDetailPage.vue";

describe("ProjectDetailPage.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ProjectDetailPage).toBeTruthy();
    expect(typeof ProjectDetailPage).toBe("object");
  });
});
