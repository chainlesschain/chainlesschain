import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIRECTORY, "../../../../../..");
const AUDIT_SCRIPT = path.join(
  PROJECT_ROOT,
  "scripts",
  "sync-bundled-skill-capabilities.mjs",
);

describe("bundled Skill capability catalog", () => {
  it("matches every checked-in manifest, handler digest, and audited host surface", () => {
    const result = spawnSync(process.execPath, [AUDIT_SCRIPT], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      windowsHide: true,
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("verified: 145/145");
    expect(result.stdout).toContain("filesystem:read=");
    expect(result.stdout).toContain("process:execute=");
    expect(result.stdout).toContain("network:http=");
    expect(result.stdout).toContain("host:network=7");
  });

  it("keeps brokered HTTPS as an explicit network capability", async () => {
    const { inferCapabilities } = await import(
      pathToFileURL(AUDIT_SCRIPT).href
    );

    expect(
      inferCapabilities(
        'require("../../bundled-skill-egress-broker.js");',
        "brokered-network-fixture",
      ),
    ).toEqual(["data:result", "data:task", "host:network", "network:http"]);
  });

  it("fails closed for unknown modules and fs operations", async () => {
    const { inferCapabilities } = await import(
      pathToFileURL(AUDIT_SCRIPT).href
    );

    expect(() =>
      inferCapabilities('require("unreviewed-module");', "unknown-module"),
    ).toThrow(/unknown required module/);
    expect(() =>
      inferCapabilities(
        'const fs = require("fs"); fs.unreviewedOperation("x");',
        "unknown-fs",
      ),
    ).toThrow(/unknown fs operation/);
  });

  it("classifies nondeterminism, network, dynamic loading, and fs direction", async () => {
    const { inferCapabilities } = await import(
      pathToFileURL(AUDIT_SCRIPT).href
    );
    const capabilities = inferCapabilities(
      `const fs = require("fs");
       fs.readFileSync("input");
       fs.writeFileSync("output", "value");
       fetch("https://example.com");
       Math.random();
       Date.now();
       import(moduleName);`,
      "classification-fixture",
    );

    expect(capabilities).toEqual([
      "data:result",
      "data:task",
      "filesystem:read",
      "filesystem:write",
      "host:module-load",
      "network:http",
      "runtime:random",
      "runtime:time",
    ]);
  });
});
