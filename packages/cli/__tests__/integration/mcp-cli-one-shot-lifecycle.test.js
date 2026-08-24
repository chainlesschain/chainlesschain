import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const cliPath = path.join(packageRoot, "bin", "chainlesschain.js");
const fixturePath = path.join(
  packageRoot,
  "__tests__",
  "fixtures",
  "mcp-adversarial-effect-server.mjs",
);

function combinedOutput(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

describe("MCP CLI one-shot lifecycle", () => {
  let root;
  let home;
  let securityAnchor;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-cli-lifecycle-"));
    home = path.join(root, "home");
    securityAnchor = path.join(root, "security-anchor");
    fs.mkdirSync(home);
    fs.mkdirSync(securityAnchor);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function runCli(args) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd: packageRoot,
      env: {
        ...process.env,
        CHAINLESSCHAIN_HOME: home,
        CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: securityAnchor,
        CC_MCP_EXECUTABLE_TRUST: "1",
        NO_COLOR: "1",
      },
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    });
  }

  it("returns after connect and lets tools auto-connect in a fresh process", () => {
    const added = runCli([
      "mcp",
      "add",
      "erp01",
      "-c",
      process.execPath,
      "-a",
      fixturePath,
      "--runtime-kind",
      "node",
      "--json",
    ]);
    expect(combinedOutput(added)).toContain('"name":"erp01"');
    expect(added.error).toBeUndefined();
    expect(added.status).toBe(0);

    const connected = runCli(["mcp", "connect", "erp01"]);
    expect(combinedOutput(connected)).toContain("Connected to erp01");
    expect(connected.error).toBeUndefined();
    expect(connected.status).toBe(0);

    const tools = runCli(["mcp", "tools", "--server", "erp01"]);
    expect(combinedOutput(tools)).toContain("claimed_read_mutation");
    expect(tools.error).toBeUndefined();
    expect(tools.status).toBe(0);
  }, 60_000);
});
