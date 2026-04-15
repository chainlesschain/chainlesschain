import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.join(__dirname, "..", "..");
const bin = path.join(cliRoot, "bin", "chainlesschain.js");

let tempHome;

function cliEnv() {
  return {
    ...process.env,
    HOME: tempHome,
    USERPROFILE: tempHome,
    APPDATA: tempHome,
    LOCALAPPDATA: tempHome,
  };
}

function runCli(args, options = {}) {
  return execSync(`node "${bin}" ${args}`, {
    cwd: cliRoot,
    encoding: "utf-8",
    timeout: 30000,
    stdio: "pipe",
    env: cliEnv(),
    ...options,
  });
}

beforeAll(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-managed-agents-e2e-"));
});

afterAll(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("Managed Agents parity E2E commands", () => {
  it("memory --help shows store and recall subcommands", () => {
    const output = runCli("memory --help");
    expect(output).toContain("store");
    expect(output).toContain("recall");
  });

  it("session --help shows policy subcommand", () => {
    const output = runCli("session --help");
    expect(output).toContain("policy");
  });

  it("config beta --help shows enable/disable/list", () => {
    const output = runCli("config beta --help");
    expect(output).toContain("enable");
    expect(output).toContain("disable");
    expect(output).toContain("list");
  });

  it("config beta enable persists across CLI invocations", () => {
    runCli("config beta enable managed-agents-2026-04-15");
    const listed = runCli("config beta list --json");
    const parsed = JSON.parse(listed);
    expect(parsed.enabled).toContain("managed-agents-2026-04-15");

    const betaFile = path.join(tempHome, ".chainlesschain", "beta-flags.json");
    expect(fs.existsSync(betaFile)).toBe(true);
  });

  it("memory store + recall persists across CLI invocations", () => {
    runCli(
      'memory store "Prefers TypeScript and Vitest." --scope global --category preference',
    );
    const recalled = runCli("memory recall TypeScript --scope global --json");
    const parsed = JSON.parse(recalled);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].content).toContain("TypeScript");

    const memoryFile = path.join(
      tempHome,
      ".chainlesschain",
      "memory-store.json",
    );
    expect(fs.existsSync(memoryFile)).toBe(true);
  });

  it("session policy set command succeeds and prints the selected policy", () => {
    const output = runCli("session policy sess_e2e --set trusted");
    expect(output).toContain("trusted");
  });
});
