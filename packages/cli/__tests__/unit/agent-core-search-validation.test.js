import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeTool,
  _agentToolProcessDeps,
} from "../helpers/test-model-egress.js";

afterEach(() => vi.restoreAllMocks());

describe("search_files required pattern", () => {
  it.each([
    { query: "mergeUsagePricingBucket", content_search: true, directory: "." },
    { pattern: "", content_search: true },
    { pattern: null },
    { pattern: 12 },
  ])(
    "refuses invalid arguments before launching a search: %j",
    async (args) => {
      const runner = vi
        .spyOn(_agentToolProcessDeps, "runSearch")
        .mockReturnValue("unrelated-node_modules-file.js\n");
      const result = await executeTool("search_files", args, {
        cwd: process.cwd(),
      });
      expect(result.error).toContain("non-empty string pattern");
      expect(result).not.toHaveProperty("matches");
      expect(runner).not.toHaveBeenCalled();
    },
  );

  it("still launches searches with an explicit valid pattern", async () => {
    const runner = vi
      .spyOn(_agentToolProcessDeps, "runSearch")
      .mockReturnValue("packages/cli/src/lib/usage-pricing-context.js\n");
    const result = await executeTool(
      "search_files",
      { pattern: "usage-pricing-context", content_search: true },
      { cwd: process.cwd() },
    );
    expect(result.error).toBeUndefined();
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][0]).toContain("usage-pricing-context");
  });
});
