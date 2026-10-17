import "../helpers/test-model-egress.js";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const entry = vi.hoisted(() => ({
  presence: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("../../src/harness/jsonl-session-store.js", async (original) => ({
  ...(await original()),
  sessionHasPersistedEvidence: entry.presence,
}));
vi.mock("../../src/runtime/headless-stream.js", () => ({
  runAgentHeadlessStream: entry.stream,
}));
vi.mock("../../src/lib/config-manager.js", () => ({
  loadConfig: () => ({ llm: {} }),
  saveConfig: vi.fn(),
}));

import { registerAgentCommand } from "../../src/commands/agent.js";

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function invoke(format = "stream-json") {
  const program = new Command();
  program.exitOverride();
  registerAgentCommand(program);
  await program.parseAsync(
    [
      "agent",
      "--no-mcp",
      "--no-ide",
      "--session",
      "disk-preflight",
      "--input-format",
      "stream-json",
      "--output-format",
      format,
    ],
    { from: "user" },
  );
}

describe("agent command session preparation failure", () => {
  it.each(["EROFS", "ENOSPC", "EIO"])(
    "emits a bounded %s result before runner dispatch",
    async (code) => {
      const output = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      entry.presence.mockImplementation(() => {
        throw Object.assign(new Error("private storage path"), { code });
      });
      await invoke();
      expect(process.exitCode).toBe(1);
      expect(entry.stream).not.toHaveBeenCalled();
      expect(JSON.parse(output.join(""))).toMatchObject({
        type: "result",
        subtype: "error_persistence",
        is_error: true,
        session_id: "disk-preflight",
        persistence: {
          code: "CC_SESSION_PERSISTENCE_FAILED",
          fs_code: code,
          phase: "before-model",
        },
      });
      expect(output.join("")).not.toContain("private storage path");
      expect(stderr.mock.calls.flat().join("")).not.toContain(
        "private storage path",
      );
    },
  );

  it("preserves non-storage preparation failures without starting the runner", async () => {
    const failure = new Error("unverified authority");
    entry.presence.mockImplementation(() => {
      throw failure;
    });
    await expect(invoke()).rejects.toBe(failure);
    expect(entry.stream).not.toHaveBeenCalled();
  });
});
