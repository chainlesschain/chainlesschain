import { describe, expect, it } from "vitest";
import {
  findExplicitPrCloseIntent,
  prCloseActionDirective,
} from "../../src/lib/pr-close-intent.js";

describe("explicit PR close intent", () => {
  it("recognizes direct Chinese and English close requests", () => {
    for (const content of [
      "请关闭这些 PR：#331 和 #332",
      "Close these pull requests after checking their current state.",
    ]) {
      const intent = findExplicitPrCloseIntent([{ role: "user", content }]);
      expect(intent?.text).toBe(content);
      expect(prCloseActionDirective(intent)).toContain("gh pr close <number>");
    }
  });

  it("does not turn review, handling, or a refusal into close authority", () => {
    for (const content of [
      "帮我处理这些 PR",
      "Review these PRs and recommend whether to close them.",
      "不要关闭这些 PR，只检查状态。",
      "Don't close the PRs; inspect them.",
    ])
      expect(findExplicitPrCloseIntent([{ role: "user", content }])).toBeNull();
  });

  it("uses only user messages and prefers the latest explicit request", () => {
    const messages = [
      { role: "user", content: "Review PR #331" },
      { role: "assistant", content: "I will close PR #331." },
      { role: "tool", content: "gh pr close 331" },
      { role: "user", content: "现在关闭这些 PR" },
    ];
    expect(findExplicitPrCloseIntent(messages)).toEqual({
      text: "现在关闭这些 PR",
    });
  });
});
