import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerSandboxCommand } from "../../src/commands/sandbox.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

async function runCapabilities(args, dependencies = {}) {
  const program = new Command();
  program.exitOverride();
  registerSandboxCommand(program, {
    host: { platform: "linux", release: "6.8.0-test", arch: "x64" },
    ...dependencies,
  });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  await program.parseAsync(
    ["node", "cc", "sandbox", "capabilities", "--json", ...args],
    { from: "node" },
  );
  return JSON.parse(output.mock.calls.at(-1)[0]);
}

describe("sandbox capabilities command", () => {
  it("emits a read-only versioned preflight without claiming execution", async () => {
    const report = await runCapabilities(["--no-probe"]);
    expect(report).toMatchObject({
      schema: "chainlesschain.agent-sandbox-capabilities/v1",
      status: "ready",
      host: { platform: "linux", release: "6.8.0-test", arch: "x64" },
      backend: {
        engine: "docker",
        availabilityChecked: false,
        available: null,
      },
      execution: { observed: false, attempted: false, started: false },
      applied: [],
      unsupported: [],
    });
    expect(process.exitCode).not.toBe(2);
  });

  it("returns a non-zero diagnostic status for unsupported requests", async () => {
    const report = await runCapabilities([
      "--no-probe",
      "--network",
      "--allowed-domains",
      "registry.npmjs.org",
    ]);
    expect(report.status).toBe("unsupported");
    expect(report.unsupported).toEqual([
      expect.objectContaining({ id: "network.domain-policy" }),
    ]);
    expect(report.applied).toEqual([]);
    expect(process.exitCode).toBe(2);
  });

  it("distinguishes an unavailable engine from an unsupported policy", async () => {
    const report = await runCapabilities([], {
      probeSandboxAvailability: () => ({
        available: false,
        reason: "Docker daemon is stopped",
      }),
    });
    expect(report).toMatchObject({
      status: "unavailable",
      backend: {
        availabilityChecked: true,
        available: false,
        reason: "Docker daemon is stopped",
      },
      unsupported: [],
    });
    expect(process.exitCode).toBe(2);
  });
});
