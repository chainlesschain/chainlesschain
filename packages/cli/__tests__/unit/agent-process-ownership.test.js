import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  inspectProcessOwnership,
  recoverProcessOwnership,
  registerProcessOwnershipCommands,
} from "../../src/commands/agent-process-ownership.js";

const id = "f790cfa4-7ba3-4baf-a9e8-43b3f4c2a747";
const exitCode = process.exitCode;
afterEach(() => {
  process.exitCode = exitCode;
});

function fixture() {
  const status = {
    blocked: true,
    unresolvedExecutionIds: [id],
    recoverableExecutionIds: [id],
    recoveryRequired: true,
    durable: true,
    restartSafe: false,
  };
  const receipt = {
    executionId: id,
    cleanupConfirmed: true,
    executionResumed: false,
    killIssued: true,
    populated: false,
  };
  const host = {
    getProcessOwnershipStatus: vi.fn(() => status),
    recoverProcessOwnership: vi.fn(async () => receipt),
  };
  const dependencies = {
    platform: "linux",
    loadAuthority: vi.fn(async () => host),
    writeOut: vi.fn(),
    writeError: vi.fn(),
  };
  const program = new Command().exitOverride();
  program.configureOutput({ writeErr: () => {} });
  const agent = program
    .command("agent")
    .option("--yolo")
    .option("--settings <file>");
  registerProcessOwnershipCommands(agent, dependencies);
  return { status, receipt, host, dependencies, program };
}

describe("explicit process ownership operator commands", () => {
  it.each(["win32", "darwin"])(
    "refuses %s without opening authority",
    async (platform) => {
      const f = fixture();
      f.dependencies.platform = platform;
      await expect(
        inspectProcessOwnership(f.dependencies),
      ).rejects.toMatchObject({
        code: "CC_PROCESS_OWNERSHIP_PLATFORM_UNSUPPORTED",
      });
      await expect(
        recoverProcessOwnership(id, {}, f.dependencies),
      ).rejects.toMatchObject({
        code: "CC_PROCESS_OWNERSHIP_PLATFORM_UNSUPPORTED",
      });
      expect(f.dependencies.loadAuthority).not.toHaveBeenCalled();
    },
  );

  it("projects read-only status without recovering or declaring restart safety", async () => {
    const f = fixture();
    await f.program.parseAsync(
      ["agent", "process-ownership", "status", "--json"],
      { from: "user" },
    );
    expect(JSON.parse(f.dependencies.writeOut.mock.calls[0][0])).toEqual({
      schema: "chainlesschain.process-ownership-status/v1",
      ...f.status,
    });
    expect(f.host.getProcessOwnershipStatus).toHaveBeenCalledOnce();
    expect(f.host.recoverProcessOwnership).not.toHaveBeenCalled();
  });

  it("waits for the existing authority receipt and passes the exact bounded target", async () => {
    const f = fixture();
    let complete;
    f.host.recoverProcessOwnership.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = f.program.parseAsync(
      [
        "agent",
        "process-ownership",
        "recover",
        id,
        "--timeout-ms",
        "21",
        "--json",
      ],
      { from: "user" },
    );
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    expect(f.dependencies.writeOut).not.toHaveBeenCalled();
    complete(f.receipt);
    await pending;
    expect(f.host.recoverProcessOwnership).toHaveBeenCalledExactlyOnceWith(id, {
      timeoutMs: 21,
    });
    expect(JSON.parse(f.dependencies.writeOut.mock.calls[0][0])).toEqual({
      schema: "chainlesschain.process-ownership-recovery/v1",
      receipt: f.receipt,
    });
    expect(f.host.getProcessOwnershipStatus).not.toHaveBeenCalled();
  });

  it.each([null, "123", "all", id.toUpperCase(), `${id}/../journal`])(
    "rejects an invalid execution ID %s",
    async (executionId) => {
      const f = fixture();
      await expect(
        recoverProcessOwnership(executionId, {}, f.dependencies),
      ).rejects.toMatchObject({ code: "CC_PROCESS_OWNERSHIP_INVALID" });
      expect(f.dependencies.loadAuthority).not.toHaveBeenCalled();
    },
  );

  it.each(["", "1.5", "1e3", "-1", "0", "30001", true, NaN])(
    "rejects invalid timeout %s before opening authority",
    async (timeoutMs) => {
      const f = fixture();
      await expect(
        recoverProcessOwnership(id, { timeoutMs }, f.dependencies),
      ).rejects.toMatchObject({ code: "CC_PROCESS_OWNERSHIP_INVALID" });
      expect(f.dependencies.loadAuthority).not.toHaveBeenCalled();
    },
  );

  it.each([
    "BROKER_PROCESS_OWNERSHIP_PENDING",
    "BROKER_PROCESS_RECOVERY_UNAVAILABLE",
    "BROKER_PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE",
  ])(
    "preserves %s without emitting a cleanup receipt or retrying",
    async (code) => {
      const f = fixture();
      f.host.recoverProcessOwnership.mockRejectedValue(
        Object.assign(new Error("quarantine retained"), { code }),
      );
      await f.program.parseAsync(
        ["agent", "process-ownership", "recover", id, "--json"],
        { from: "user" },
      );
      expect(process.exitCode).toBe(1);
      expect(f.dependencies.writeOut).not.toHaveBeenCalled();
      expect(f.dependencies.writeError).toHaveBeenCalledWith(
        `${code}: quarantine retained\n`,
      );
      expect(f.host.recoverProcessOwnership).toHaveBeenCalledOnce();
    },
  );

  it("propagates corrupt status as failure, never an empty inventory", async () => {
    const f = fixture();
    f.host.getProcessOwnershipStatus.mockImplementation(() => {
      throw Object.assign(new Error("corrupt"), {
        code: "BROKER_PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE",
      });
    });
    await f.program.parseAsync(
      ["agent", "process-ownership", "status", "--json"],
      { from: "user" },
    );
    expect(process.exitCode).toBe(1);
    expect(f.dependencies.writeOut).not.toHaveBeenCalled();
    expect(f.host.recoverProcessOwnership).not.toHaveBeenCalled();
  });

  it.each([["--yolo"], ["--settings", "other.json"]])(
    "refuses parent flags %j",
    async (...flags) => {
      const f = fixture();
      await f.program.parseAsync(
        ["agent", ...flags, "process-ownership", "status"],
        { from: "user" },
      );
      expect(process.exitCode).toBe(1);
      expect(f.dependencies.loadAuthority).not.toHaveBeenCalled();
    },
  );

  it.each(["reset", "clear", "recover-all"])(
    "does not expose %s",
    async (action) => {
      const f = fixture();
      await expect(
        f.program.parseAsync(["agent", "process-ownership", action], {
          from: "user",
        }),
      ).rejects.toMatchObject({ code: "commander.unknownCommand" });
      expect(f.dependencies.loadAuthority).not.toHaveBeenCalled();
    },
  );
});
