/**
 * `cc pdh feedback` — surface what cc has learned from cross-session corrections
 * (design module 101 §3.5.13 flywheel / §3.5.18 transparency). The ledger is
 * otherwise only injected into prompts; this makes it visible + honest about an
 * empty state. readFeedback is injected so no real ledger file is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerPdhCommand } from "../../src/commands/pdh.js";

let logSpy;

async function run(entries, ...argv) {
  logSpy.mockClear();
  const program = new Command();
  program.exitOverride();
  registerPdhCommand(program, { readFeedback: () => entries });
  await program.parseAsync(["node", "cc", "pdh", "feedback", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("cc pdh feedback", () => {
  it("honestly reports an empty ledger", async () => {
    const out = await run([]);
    expect(out).toMatch(/尚无|no cross-session feedback/);
  });

  it("summarizes counts, net sentiment and remembered corrections", async () => {
    const out = await run([
      { kind: "positive" },
      { kind: "positive" },
      { kind: "negative" },
      { kind: "correction", comment: "金额用人民币" },
      { kind: "correction", comment: "汇报要简洁" },
    ]);
    expect(out).toMatch(/5 条/); // total entries
    expect(out).toMatch(/👍 2/);
    expect(out).toMatch(/👎 1/);
    expect(out).toMatch(/金额用人民币/);
    expect(out).toMatch(/汇报要简洁/);
  });

  it("--json emits the summary object", async () => {
    const out = await run(
      [{ kind: "positive" }, { kind: "correction", comment: "金额用人民币" }],
      "--json",
    );
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({
      total: 2,
      positive: 1,
      negative: 0,
      sentiment: 1,
    });
    expect(parsed.corrections).toContain("金额用人民币");
  });

  it("surfaces correction text (newest first) in human output", async () => {
    const out = await run([
      { kind: "correction", comment: "旧纠正" },
      { kind: "correction", comment: "新纠正" },
    ]);
    expect(out).toMatch(/新纠正/);
    expect(out).toMatch(/旧纠正/);
    // newest-first: 新纠正 appears before 旧纠正
    expect(out.indexOf("新纠正")).toBeLessThan(out.indexOf("旧纠正"));
  });
});
