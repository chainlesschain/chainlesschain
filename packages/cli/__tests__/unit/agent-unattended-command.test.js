import "../helpers/test-model-egress.js";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const entry = vi.hoisted(() => ({
  headless: vi.fn(async () => ({ exitCode: 0 })),
  stream: vi.fn(async () => ({ exitCode: 0 })),
  interactive: vi.fn(async () => {}),
}));
vi.mock("../../src/lib/config-manager.js", () => ({
  loadConfig: () => ({ llm: {} }),
  saveConfig: vi.fn(),
}));
vi.mock("../../src/runtime/headless-runner.js", async (original) => ({
  ...(await original()),
  runAgentHeadless: entry.headless,
}));
vi.mock("../../src/runtime/headless-stream.js", async (original) => ({
  ...(await original()),
  runAgentHeadlessStream: entry.stream,
}));
vi.mock("../../src/runtime/runtime-factory.js", () => ({
  createAgentRuntimeFactory: () => ({
    createAgentRuntime: (options) => ({
      startAgentSession: () => entry.interactive(options),
    }),
  }),
}));

import { registerAgentCommand } from "../../src/commands/agent.js";

let cwd;
let originalCwd;
let ttyDescriptor;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-unattended-command-"));
  originalCwd = process.cwd();
  process.chdir(cwd);
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  vi.spyOn(process, "exit").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.stubEnv("CC_TOOL_ADMISSION", "");
  entry.headless.mockClear();
  entry.stream.mockClear();
  entry.interactive.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (ttyDescriptor)
    Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
  else delete process.stdin.isTTY;
  process.chdir(originalCwd);
  fs.rmSync(cwd, { recursive: true, force: true });
});

async function invoke(args) {
  const program = new Command();
  program.exitOverride();
  registerAgentCommand(program);
  await program.parseAsync(
    ["agent", "--no-mcp", "--no-ide", "--no-pdh", ...args],
    { from: "user" },
  );
}

describe("cc agent unattended command dispatch", () => {
  it.each(["text", "json", "stream-json"])(
    "passes frozen authority to %s output",
    async (format) => {
      await invoke([
        "--unattended",
        "--unattended-allow",
        " merge, publish ",
        "-p",
        "inspect",
        "--output-format",
        format,
      ]);
      expect(entry.headless).toHaveBeenCalledOnce();
      const policy = entry.headless.mock.calls[0][0].unattendedActionPolicy;
      expect(policy).toEqual({
        unattended: true,
        allowlist: ["merge", "publish"],
        trigger: { trusted: true },
      });
      expect(Object.isFrozen(policy.allowlist)).toBe(true);
      expect(Object.isFrozen(policy.trigger)).toBe(true);
    },
  );

  it("passes authority to the separate stream-input command branch", async () => {
    await invoke(["--unattended", "--input-format", "stream-json"]);
    expect(entry.stream).toHaveBeenCalledOnce();
    expect(entry.stream.mock.calls[0][0].unattendedActionPolicy).toEqual({
      unattended: true,
      allowlist: [],
      trigger: { trusted: true },
    });
  });

  it("passes authority to interactive runtime creation", async () => {
    await invoke(["--unattended"]);
    expect(entry.interactive).toHaveBeenCalledOnce();
    expect(
      entry.interactive.mock.calls[0][0].unattendedActionPolicy?.unattended,
    ).toBe(true);
  });

  it("keeps an attended invocation unset", async () => {
    await invoke(["-p", "inspect"]);
    expect(entry.headless.mock.calls[0][0].unattendedActionPolicy).toBeNull();
  });

  it("passes the IDE admission envelope to the interactive entry", async () => {
    vi.stubEnv(
      "CC_TOOL_ADMISSION",
      JSON.stringify({
        enforce: true,
        policyAllowed: false,
        budgetOk: true,
      }),
    );
    await invoke([]);
    expect(entry.interactive.mock.calls[0][0].toolAdmission).toMatchObject({
      enforce: true,
      policyAllowed: false,
    });
  });
  it("passes tool restrictions to the interactive entry", async () => {
    await invoke([
      "--allowed-tools",
      "read_file, list_dir",
      "--disallowed-tools",
      "run_shell",
    ]);
    expect(entry.interactive.mock.calls[0][0]).toMatchObject({
      allowedTools: ["read_file", "list_dir"],
      disallowedTools: ["run_shell"],
    });
  });
});
