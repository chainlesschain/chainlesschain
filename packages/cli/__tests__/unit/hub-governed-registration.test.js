import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const ports = vi.hoisted(() => ({
  getHub: vi.fn(),
  getHubMinimal: vi.fn(),
  getGovernedAnalysisHub: vi.fn(),
}));
vi.mock("../../src/lib/personal-data-hub-wiring.js", () => ports);
vi.mock("../../src/lib/config-manager.js", () => ({ loadConfig: () => ({}) }));
import { registerHubCommand } from "../../src/commands/hub.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("governed Hub registration", () => {
  it("loads an invocation-scoped analysis hub and preserves explicit cloud consent", async () => {
    const factory = vi.fn();
    const ask = vi.fn(async () => ({ answer: "ok" }));
    ports.getGovernedAnalysisHub.mockResolvedValue({ engine: { ask } });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerHubCommand(program, { evolutionCompositionFactory: factory });
    await program.parseAsync([
      "node",
      "cc",
      "hub",
      "ask",
      "question",
      "--accept-non-local",
      "--json",
    ]);
    expect(ports.getGovernedAnalysisHub).toHaveBeenCalledWith(factory);
    expect(ports.getHub).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalledWith(
      "question",
      expect.objectContaining({ acceptNonLocal: true }),
    );
    expect(output).toHaveBeenCalled();
  });

  it("does not fall back to the shared hub when governed REPL initialization fails", async () => {
    const factory = vi.fn();
    ports.getGovernedAnalysisHub.mockRejectedValue(
      new Error("governed initialization denied"),
    );
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
    const program = new Command();
    registerHubCommand(program, { evolutionCompositionFactory: factory });
    await program.parseAsync(["node", "cc", "hub", "repl"]);
    expect(ports.getGovernedAnalysisHub).toHaveBeenCalledWith(factory);
    expect(ports.getHub).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("retains normal hub loading without a deployment factory", async () => {
    ports.getHub.mockResolvedValue({
      engine: { ask: vi.fn(async () => ({ answer: "ok" })) },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerHubCommand(program);
    await program.parseAsync([
      "node",
      "cc",
      "hub",
      "ask",
      "question",
      "--json",
    ]);
    expect(ports.getHub).toHaveBeenCalledTimes(1);
    expect(ports.getGovernedAnalysisHub).not.toHaveBeenCalled();
  });
});
