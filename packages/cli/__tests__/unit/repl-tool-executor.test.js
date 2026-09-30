import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplToolExecutor } from "../../src/repl/repl-tool-executor.js";
import { ApprovalGate, APPROVAL_POLICY } from "@chainlesschain/session-core";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

let cwd;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-repl-tools-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("REPL direct /auto and /plan tool authority", () => {
  it("rejects a write outside the immutable tool ceiling and permits a read", async () => {
    fs.writeFileSync(path.join(cwd, "read.txt"), "permitted read");
    const allowedTools = ["read_file"];
    const execute = createReplToolExecutor({ allowedTools }, () => ({ cwd }));
    allowedTools.push("write_file");
    const denied = await execute("write_file", {
      path: "denied.txt",
      content: "not allowed",
    });
    expect(denied.policy.via).toBe("effective-tool-set");
    expect(fs.existsSync(path.join(cwd, "denied.txt"))).toBe(false);
    const read = await execute("read_file", { path: "read.txt" });
    expect(read.error).toBeUndefined();
    expect(JSON.stringify(read)).toContain("permitted read");
  });

  it("retains deny-all and accumulates tool deny lists", async () => {
    for (const options of [
      { allowedTools: [] },
      { allowedTools: ["write_file"], disallowedTools: ["write_file"] },
      { disabledTools: ["write_file"] },
      { allowedTools: ["write_file"], enabledToolNames: ["read_file"] },
    ]) {
      const execute = createReplToolExecutor(options, () => ({ cwd }));
      const result = await execute("write_file", {
        path: "no-write.txt",
        content: "not allowed",
      });
      expect(result.policy.via).toBe("effective-tool-set");
    }
    expect(fs.existsSync(path.join(cwd, "no-write.txt"))).toBe(false);
  });

  it("reads the live permission provider on each direct call", async () => {
    let denied = false;
    const provider = vi.fn(async () => ({
      rules: {
        allow: [],
        ask: [],
        deny: denied ? ["Write(*)"] : [],
      },
    }));
    const execute = createReplToolExecutor({}, () => ({
      cwd,
      permissionRulesProvider: provider,
    }));
    const first = await execute("write_file", {
      path: "first.txt",
      content: "first",
    });
    expect(first.error).toBeUndefined();
    denied = true;
    const second = await execute("write_file", {
      path: "second.txt",
      content: "second",
    });
    expect(second.error).toBeTruthy();
    expect(provider).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(cwd, "first.txt"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "second.txt"))).toBe(false);
  });

  it.each([true, false])(
    "managed classifier stays active with explicit option %s",
    async (classifyAllShell) => {
      const dispatch = vi.spyOn(executionBroker, "execSync");
      const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.STRICT });
      const execute = createReplToolExecutor({ classifyAllShell }, () => ({
        cwd,
        classifyAllShell: true,
        approvalGate: gate,
      }));
      const result = await execute("run_shell", { command: "npm run test" });
      expect(result.error).toBeTruthy();
      expect(result.shellCommandPolicy?.decision).toBe("warn");
      expect(dispatch).not.toHaveBeenCalled();
    },
  );
});
