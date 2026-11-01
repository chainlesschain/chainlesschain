import { afterEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentCommand } from "../../src/commands/agent.js";
import { resolveAgentPolicy } from "../../src/runtime/policies/agent-policy.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function parse(value) {
  const program = new Command();
  registerAgentCommand(program);
  const agent = program.commands.find((command) => command.name() === "agent");
  agent.parseOptions(value === undefined ? [] : ["--context-window", value]);
  return agent.opts();
}

describe("agent operator context window", () => {
  it.each(["0", "1023", "16777217", "1e6", "32768.5", "oops", ""])(
    "rejects invalid window %j during argument parsing",
    (value) => {
      expect(() => parse(value)).toThrow(/must be an integer/);
    },
  );

  it.each([undefined, "32768"])(
    "binds parsed window %s to a real canonical plan without changing model metadata",
    async (value) => {
      const parsed = parse(value);
      const cwd = mkdtempSync(join(tmpdir(), "cc-agent-window-"));
      directories.push(cwd);
      const options = resolveAgentPolicy({
        overrides: {
          provider: "openai",
          model: "gpt-6.1-sol",
          contextMemoryModelWindowTokens: parsed.contextWindow,
        },
      });
      const prepared = await prepareCanonicalProviderContext(
        [{ role: "user", content: "Check the source." }],
        {
          ...options,
          cwd,
          sessionId: "operator-window-test",
          maxOutputTokens: 8192,
          contextMemoryEnv: {
            CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
          },
          contextMemoryFilePath: join(cwd, "kernel.json"),
          contextMemorySelectedToolNames: [],
        },
      );
      expect(prepared.modelCapabilities.runtimeVerified).toBe(false);
      expect(prepared.modelCapabilities.model).toBe("gpt-6.1-sol");
      if (value !== undefined) {
        expect(prepared.modelCapabilities.contextWindowTokens).toBe(32768);
        expect(prepared.plan.inputBudget).toBe(32768 - 8192 - 1638);
      } else {
        expect(parsed.contextWindow).toBeUndefined();
        expect(prepared.modelCapabilities.contextWindowTokens).toBeGreaterThan(
          32768,
        );
      }
    },
  );
});
