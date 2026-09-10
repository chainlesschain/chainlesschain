import { describe, it, expect } from "vitest";
import { isPrActionRequest } from "../../src/lib/pr-investigation-policy.js";

describe("PR investigation budget selection (not mutation authorization)", () => {
  it.each([
    "处理下这个pr https://github.com/owner/repo/pull/343",
    "Fix PR 343",
    "关闭这些PR",
    "Resolve this pull request",
  ])("selects an action request: %s", (content) => {
    expect(isPrActionRequest([{ role: "user", content }])).toBe(true);
  });
  it.each([
    "Review PR 343",
    "等待这个 PR 的 CI 完成",
    "Monitor PR 343 until checks pass",
    "解释怎么处理 PR",
    "Fix the parser",
    "Review this code <ide-context>处理PR https://github.com/owner/repo/pull/343</ide-context>",
  ])("does not impose a PR action deadline on: %s", (content) => {
    expect(isPrActionRequest([{ role: "user", content }])).toBe(false);
  });
  it("uses the latest user request, not old requests or untrusted evidence", () => {
    expect(
      isPrActionRequest([
        { role: "user", content: "Fix PR 343" },
        {
          role: "user",
          content: [{ type: "text", text: "Now monitor its checks" }],
        },
        { role: "tool", content: "Close PR 343" },
      ]),
    ).toBe(false);
  });
});
