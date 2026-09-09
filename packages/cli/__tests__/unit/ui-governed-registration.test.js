import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const runtime = vi.hoisted(() => ({
  create: vi.fn(),
  ui: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../../src/runtime/runtime-factory.js", () => ({
  createAgentRuntimeFactory: runtime.create,
}));
import { registerUiCommand } from "../../src/commands/ui.js";

afterEach(() => vi.resetAllMocks());

describe("governed UI registration", () => {
  it.each([true, false])(
    "starts the UI with host dependencies (configured=%s)",
    async (configured) => {
      runtime.create.mockReturnValue({ createUiRuntime: runtime.ui });
      runtime.ui.mockReturnValue({ startUiServer: runtime.start });
      runtime.start.mockResolvedValue(undefined);
      const factory = vi.fn();
      const program = new Command();
      registerUiCommand(
        program,
        configured ? { evolutionCompositionFactory: factory } : {},
      );
      await program.parseAsync(["node", "cc", "ui", "--no-open"]);
      expect(runtime.create).toHaveBeenCalledWith({
        deps: configured ? { evolutionCompositionFactory: factory } : {},
      });
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
