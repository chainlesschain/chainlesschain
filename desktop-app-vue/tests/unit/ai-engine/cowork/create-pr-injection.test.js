/**
 * Security regression: create-pr's generateChangelog interpolates a caller range
 * (description like "v1..v2") into `git log --oneline ${description}` (shell). A
 * malicious range must not reach execSync — isSafeRef gates it, falling back to
 * the safe default command.
 */
import { describe, it, expect, vi } from "vitest";
import { createTestProcessContext } from "../../../../src/main/ai-engine/cowork/skills/__tests__/helpers/bundled-skill-process.js";

const handler = require("../../../../src/main/ai-engine/cowork/skills/builtin/create-pr/handler.js");

describe("create-pr changelog injection guard", () => {
  it("isSafeRef accepts ranges, rejects metacharacters", () => {
    expect(handler.isSafeRef("v1.1.0..v1.2.0")).toBe(true);
    expect(handler.isSafeRef("main")).toBe(true);
    expect(handler.isSafeRef("v1..v2; rm -rf ~")).toBe(false);
    expect(handler.isSafeRef("$(id)")).toBe(false);
  });

  it("never passes a malicious range to the process authority", async () => {
    const spy = vi.fn(() => "");
    const context = {
      cwd: process.cwd(),
      ...createTestProcessContext("create-pr", spy),
    };
    const res = await handler.execute(
      { input: "changelog v1..v2;rm -rf ~" },
      context,
    );
    expect(res.success).toBe(true);
    for (const [request] of spy.mock.calls) {
      expect(request.args.join(" ")).not.toContain(";rm");
      expect(request.args.join(" ")).not.toContain("v1..v2;");
    }
  });
});
