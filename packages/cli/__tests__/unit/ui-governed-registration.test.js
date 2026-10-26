import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const runtime = vi.hoisted(() => ({
  create: vi.fn(),
  ui: vi.fn(),
  start: vi.fn(),
  load: vi.fn(),
}));
vi.mock("../../src/runtime/runtime-factory.js", () => ({
  createAgentRuntimeFactory: runtime.create,
}));
vi.mock("../../src/lib/evolution/evolution-deployment-loader.js", () => ({
  loadEvolutionDeploymentCommandDependencies: runtime.load,
}));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
import { registerUiCommand } from "../../src/commands/ui.js";
import {
  prepareConfiguredUiModelTurn,
  loadConfiguredUiEvolutionFactory,
} from "../../src/lib/evolution/optional-ui-model-turn.js";

afterEach(() => vi.resetAllMocks());

describe("governed UI registration", () => {
  it.each([true, false])(
    "starts the UI with host dependencies (configured=%s)",
    async (configured) => {
      runtime.create.mockReturnValue({ createUiRuntime: runtime.ui });
      runtime.ui.mockReturnValue({ startUiServer: runtime.start });
      runtime.start.mockResolvedValue(undefined);
      const factory = vi.fn();
      runtime.load.mockResolvedValue({ evolutionCompositionFactory: factory });
      const program = new Command();
      registerUiCommand(
        program,
        configured ? { evolutionCompositionFactory: factory } : {},
      );
      await program.parseAsync(["node", "cc", "ui", "--no-open"]);
      expect(runtime.create).toHaveBeenCalledWith({
        deps: {
          evolutionCompositionFactory: factory,
          prepareUiModelTurn: prepareConfiguredUiModelTurn,
          resolveEvolutionCompositionFactory: loadConfiguredUiEvolutionFactory,
        },
      });
      expect(runtime.load).toHaveBeenCalledTimes(configured ? 0 : 1);
      if (!configured) {
        expect(runtime.load).toHaveBeenCalledWith("ui", {
          initializeDefaultLocalUi: false,
        });
      }
      expect(runtime.ui).toHaveBeenCalledWith(
        expect.objectContaining({ open: false }),
      );
      expect(runtime.start).toHaveBeenCalledOnce();
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("rejects accessor authority without invoking it", () => {
    const getter = vi.fn();
    const dependencies = Object.defineProperty(
      {},
      "evolutionCompositionFactory",
      { get: getter },
    );
    expect(() => registerUiCommand(new Command(), dependencies)).toThrow(
      /function data property/,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
  });
});
