import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  registerSessionBudgetCommands,
  renderSessionBudgetReceipts,
  renderSessionBudgetStatus,
} from "../../src/commands/session-budget.js";

function programWith(dependencies) {
  const program = new Command();
  program.exitOverride();
  const session = program.command("session");
  registerSessionBudgetCommands(session, dependencies);
  return program;
}

describe("session budget commands", () => {
  it("renders retained recovery receipt coverage without provider payload text", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(
      renderSessionBudgetReceipts({
        sessionId: "session-audit",
        revision: 8,
        count: 2,
        headDigest: digest,
        baseSequence: 1,
        baseDigest: `sha256:${"b".repeat(64)}`,
        complete: false,
        entries: [
          {
            sequence: 2,
            digest,
            abandoned: [],
            settled: [{ authorityId: "usage-id" }],
            totalsBefore: { tokens: 10, spentUsd: 0.1 },
            totalsAfter: { tokens: 12, spentUsd: 0.2 },
          },
        ],
      }),
    ).toEqual([
      "Session budget recovery receipts session-audit (revision 8)",
      `history partial; retained 1/2; head ${digest}`,
      `  legacy prefix through sequence 1: sha256:${"b".repeat(64)}`,
      `  sequence 2: ${digest}; settled 1; abandoned 0; tokens 10->12; USD 0.1->0.2`,
    ]);
  });

  it("renders the durable recovery adjudication chain head", () => {
    expect(
      renderSessionBudgetStatus({
        sessionId: "session-audit",
        revision: 7,
        limits: {},
        totals: {
          turns: 1,
          tokens: 10,
          spentUsd: 0,
          toolMs: 0,
          elapsedMs: 1,
        },
        recoveryRequired: false,
        pendingRecovery: [],
        state: {
          recoveryAdjudication: {
            count: 2,
            headDigest: `sha256:${"a".repeat(64)}`,
          },
        },
      }),
    ).toContain(
      `recovery adjudication sha256:${"a".repeat(64)} (sequence 2)`,
    );
  });

  it("prints the content-free durable status as JSON", async () => {
    const write = vi.fn();
    const status = {
      sessionId: "session-1",
      revision: 4,
      limits: { maxTurns: 3 },
      totals: { turns: 1, tokens: 2, spentUsd: 0, toolMs: 5, elapsedMs: 9 },
      recoveryRequired: false,
      pendingRecovery: [],
    };
    const readProductionSessionBudget = vi.fn(() => status);
    const program = programWith({ readProductionSessionBudget, write });

    await program.parseAsync([
      "node",
      "cc",
      "session",
      "budget",
      "status",
      "session-1",
      "--json",
    ]);

    expect(readProductionSessionBudget).toHaveBeenCalledWith("session-1");
    expect(JSON.parse(write.mock.calls[0][0])).toEqual(status);
  });

  it("passes every exact recovery authority id to one adjudication", async () => {
    const write = vi.fn();
    const adjudicateProductionSessionBudgetRecovery = vi.fn(() => ({
      sessionId: "session-2",
      abandoned: ["tool-one", "work-two"],
      settled: [],
      adjudication: { digest: "sha256:abandoned" },
    }));
    const program = programWith({
      adjudicateProductionSessionBudgetRecovery,
      write,
    });

    await program.parseAsync([
      "node",
      "cc",
      "session",
      "budget",
      "recover",
      "session-2",
      "--abandon",
      "tool-one",
      "work-two",
    ]);

    expect(adjudicateProductionSessionBudgetRecovery).toHaveBeenCalledWith(
      "session-2",
      { abandoned: ["tool-one", "work-two"], settled: [] },
    );
    expect(write).toHaveBeenCalledWith(
      "Recovered session budget session-2; recorded 0 verified usage settlement(s), abandoned 2 exact authority id(s); adjudication sha256:abandoned.",
    );
  });

  it("parses repeatable verified usage settlements for exact adjudication", async () => {
    const write = vi.fn();
    const authorityId = "usage-00000000-0000-4000-8000-000000000000";
    const adjudicateProductionSessionBudgetRecovery = vi.fn(() => ({
      sessionId: "session-3",
      abandoned: [],
      settled: [authorityId],
      adjudication: { digest: "sha256:settled" },
    }));
    const program = programWith({
      adjudicateProductionSessionBudgetRecovery,
      write,
    });
    const settlement = {
      authorityId,
      provider: "openai",
      model: "gpt-test",
      usage: { input_tokens: 4, output_tokens: 1 },
    };

    await program.parseAsync([
      "node",
      "cc",
      "session",
      "budget",
      "recover",
      "session-3",
      "--settlement",
      JSON.stringify(settlement),
    ]);

    expect(adjudicateProductionSessionBudgetRecovery).toHaveBeenCalledWith(
      "session-3",
      { abandoned: [], settled: [settlement] },
    );
    expect(write).toHaveBeenCalledWith(
      "Recovered session budget session-3; recorded 1 verified usage settlement(s), abandoned 0 exact authority id(s); adjudication sha256:settled.",
    );
  });

  it("prints canonical recovery receipt history as JSON", async () => {
    const write = vi.fn();
    const receipts = {
      sessionId: "session-4",
      count: 1,
      complete: true,
      entries: [{ sequence: 1 }],
    };
    const readProductionSessionBudgetRecoveryReceipts = vi.fn(() => receipts);
    const program = programWith({
      readProductionSessionBudgetRecoveryReceipts,
      write,
    });

    await program.parseAsync([
      "node",
      "cc",
      "session",
      "budget",
      "receipts",
      "session-4",
      "--json",
    ]);

    expect(readProductionSessionBudgetRecoveryReceipts).toHaveBeenCalledWith(
      "session-4",
    );
    expect(JSON.parse(write.mock.calls[0][0])).toEqual(receipts);
  });
});
