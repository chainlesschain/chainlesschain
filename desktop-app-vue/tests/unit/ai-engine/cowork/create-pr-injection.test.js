/**
 * Security regression: create-pr's generateChangelog interpolates a caller range
 * (description like "v1..v2") into `git log --oneline ${description}` (shell). A
 * malicious range must not reach execSync — isSafeRef gates it, falling back to
 * the safe default command.
 */
import { describe, it, expect, vi } from "vitest";

const handler = require("../../../../src/main/ai-engine/cowork/skills/builtin/create-pr/handler.js");

describe("create-pr changelog injection guard", () => {
  it("isSafeRef accepts ranges, rejects metacharacters", () => {
    expect(handler.isSafeRef("v1.1.0..v1.2.0")).toBe(true);
    expect(handler.isSafeRef("main")).toBe(true);
    expect(handler.isSafeRef("v1..v2; rm -rf ~")).toBe(false);
    expect(handler.isSafeRef("$(id)")).toBe(false);
  });

  it("never passes a malicious range to execSync (falls back to safe default)", async () => {
    const spy = vi.fn(() => "");
    const orig = handler._deps.execSync;
    handler._deps.execSync = spy;
    try {
      const res = await handler.execute(
        { input: "changelog v1..v2;rm -rf ~" },
        { cwd: "." },
      );
      expect(res.success).toBe(true);
      // the malicious range must never appear in any executed command
      for (const call of spy.mock.calls) {
        expect(String(call[0])).not.toContain(";rm");
        expect(String(call[0])).not.toContain("v1..v2;");
      }
    } finally {
      handler._deps.execSync = orig;
    }
  });
});
