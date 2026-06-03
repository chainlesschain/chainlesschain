import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");

describe("E2E: install and run", () => {
  it("bin/chainlesschain.js is valid Node script", () => {
    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} --version`,
      {
        encoding: "utf-8",
        timeout: 10000,
      },
    );
    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--help shows command list", () => {
    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} --help`,
      {
        encoding: "utf-8",
        timeout: 10000,
      },
    );
    expect(result).toContain("setup");
    expect(result).toContain("start");
    expect(result).toContain("stop");
    expect(result).toContain("status");
    expect(result).toContain("services");
    expect(result).toContain("config");
    expect(result).toContain("update");
    expect(result).toContain("doctor");
  });

  it("config list works without prior setup", () => {
    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} config list`,
      {
        encoding: "utf-8",
        timeout: 10000,
      },
    );
    expect(result).toContain("setupCompleted");
  });
});
