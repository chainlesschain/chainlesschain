import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerSessionBudgetCommands } from "../../src/commands/session-budget.js";

function programWith(dependencies) {
  const program = new Command();
  program.exitOverride();
  const session = program.command("session");
  registerSessionBudgetCommands(session, dependencies);
  return program;
}

describe("session budget commands", () => {
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
      ["tool-one", "work-two"],
    );
    expect(write).toHaveBeenCalledWith(
      "Recovered session budget session-2; abandoned 2 exact authority id(s).",
    );
  });
});
