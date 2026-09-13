import { describe, expect, it, vi } from "vitest";
import { dispatchManifestEntry } from "../../src/lazy-dispatch.js";

const entry = {
  name: "evolution",
  module: "./commands/evolution.js",
  register: "registerEvolutionCommand",
};

function dispatchOptions() {
  const program = { parseAsync: vi.fn(async () => {}) };
  const register = vi.fn();
  return {
    program,
    register,
    createBaseProgram: vi.fn(async () => program),
    loadCommandModule: vi.fn(async () => ({
      registerEvolutionDeploymentCommand: register,
      registerEvolutionCommand: register,
    })),
    loadCommandDependencies: vi.fn(async () => ({ deployment: true })),
    loadFullProgram: vi.fn(async () => program),
  };
}

describe("deployment configuration dispatch boundary", () => {
  it.each(["status", "configure", "enable", "disable", "revoke"])(
    "registers %s without loading configured command dependencies",
    async (command) => {
      const options = dispatchOptions();
      const argv = ["node", "cc", "evolution", "deployment", command];
      await dispatchManifestEntry(argv, entry, options);
      expect(options.loadCommandModule).toHaveBeenCalledWith({
        ...entry,
        module: "./commands/evolution-deployment.js",
        register: "registerEvolutionDeploymentCommand",
      });
      expect(options.loadCommandDependencies).not.toHaveBeenCalled();
      expect(options.loadFullProgram).not.toHaveBeenCalled();
      expect(options.program.parseAsync).toHaveBeenCalledWith(argv);
    },
  );

  it.each([
    ["--verbose", "evolution", "deployment", "status"],
    ["evolution", "--quiet", "deployment", "status"],
    ["evolution", "--", "deployment", "status"],
    ["evolution", "deployment", "--help"],
    ["evolution", "--unknown-option", "deployment", "status"],
  ])("keeps configuration routing isolated for %j", async (...args) => {
    const options = dispatchOptions();
    await dispatchManifestEntry(["node", "cc", ...args], entry, options);
    expect(options.loadCommandDependencies).not.toHaveBeenCalled();
    expect(options.loadFullProgram).not.toHaveBeenCalled();
  });

  it.each(["module", "registration", "parse"])(
    "never enters the eager program after a configuration %s failure",
    async (phase) => {
      const options = dispatchOptions();
      const fail = () => {
        throw new Error("configuration unavailable");
      };
      if (phase === "module")
        options.loadCommandModule.mockImplementation(fail);
      if (phase === "registration") options.register.mockImplementation(fail);
      if (phase === "parse")
        options.program.parseAsync.mockImplementation(fail);
      await expect(
        dispatchManifestEntry(
          ["node", "cc", "evolution", "deployment", "status"],
          entry,
          options,
        ),
      ).rejects.toThrow("configuration unavailable");
      expect(options.loadCommandDependencies).not.toHaveBeenCalled();
      expect(options.loadFullProgram).not.toHaveBeenCalled();
    },
  );

  it.each(["ask", "agent", "evolution", "skill"])(
    "still assembles authenticated dependencies for %s business commands",
    async (command) => {
      const options = dispatchOptions();
      const businessEntry = { ...entry, name: command };
      await dispatchManifestEntry(
        ["node", "cc", command, command === "evolution" ? "workbench" : "task"],
        businessEntry,
        options,
      );
      expect(options.loadCommandModule).toHaveBeenCalledWith(businessEntry);
      expect(options.loadCommandDependencies).toHaveBeenCalledWith(command);
      expect(options.register).toHaveBeenCalledWith(options.program, {
        deployment: true,
      });
    },
  );
});
