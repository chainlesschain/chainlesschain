import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

vi.mock("../../src/lib/paths.js", () => ({
  ensureHomeDir: vi.fn(),
  getConfigPath: () => "isolated-setup-config.json",
}));
vi.mock("../../src/lib/config-manager.js", () => ({
  setSecretConfigValue: vi.fn(),
  updateConfigAtomically: vi.fn(),
}));
vi.mock("../../src/lib/service-manager.js", () => ({
  isDockerAvailable: () => false,
  isDockerComposeAvailable: () => false,
  servicesUp: vi.fn(),
  findComposeFile: vi.fn(),
}));
vi.mock("../../src/lib/downloader.js", () => ({ downloadRelease: vi.fn() }));
vi.mock("../../src/lib/prompts.js", () => ({
  askSelect: vi.fn(),
  askConfirm: vi.fn(async () => true),
  askInput: vi.fn(),
  askPassword: vi.fn(),
}));
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    log: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    newline: vi.fn(),
  },
}));
vi.mock(
  "../../src/lib/evolution/evolution-deployment-config.js",
  async (original) => ({
    ...(await original()),
    getEvolutionDeploymentStatus: vi.fn(),
  }),
);

import { registerSetupCommand } from "../../src/commands/setup.js";
import { askSelect } from "../../src/lib/prompts.js";
import { updateConfigAtomically } from "../../src/lib/config-manager.js";
import { getEvolutionDeploymentStatus } from "../../src/lib/evolution/evolution-deployment-config.js";
import logger from "../../src/lib/logger.js";

beforeEach(() => {
  vi.clearAllMocks();
  askSelect
    .mockReset()
    .mockResolvedValueOnce("personal")
    .mockResolvedValueOnce("ollama");
});

describe("setup deployment preflight", () => {
  it.each([
    { status: { effectiveEnabled: false, verified: false }, admitted: false },
    {
      status: {
        effectiveEnabled: true,
        verified: true,
        commands: ["evolution"],
      },
      admitted: false,
    },
    {
      status: { effectiveEnabled: true, verified: true, commands: ["ask"] },
      admitted: false,
    },
    {
      status: {
        effectiveEnabled: true,
        verified: true,
        commands: ["ask", "agent"],
      },
      admitted: true,
    },
  ])(
    "saves provider settings but only reports deployment admission ($admitted)",
    async ({ status, admitted }) => {
      getEvolutionDeploymentStatus.mockResolvedValue(status);
      const program = new Command().exitOverride();
      registerSetupCommand(program);
      await program.parseAsync(
        ["setup", "--skip-download", "--skip-services"],
        { from: "user" },
      );

      expect(updateConfigAtomically).toHaveBeenCalledOnce();
      const configured = { llm: {} };
      updateConfigAtomically.mock.calls[0][0](configured);
      expect(configured).toMatchObject({
        setupCompleted: true,
        edition: "personal",
        llm: { provider: "ollama" },
      });
      expect(getEvolutionDeploymentStatus).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalled();
      const messages = logger.log.mock.calls.flat().join("\n");
      expect(messages).not.toContain("Setup complete!");
      if (admitted) {
        expect(logger.success).toHaveBeenCalledWith(
          "Signed deployment admits ask and agent",
        );
        expect(messages).toContain("model execution not tested");
      } else {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("Model deployment prerequisites not met"),
        );
        expect(messages).toContain(
          "ask/agent deployment prerequisites remain incomplete",
        );
      }
    },
  );
});
