import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { latestCliVersion, parseChangelog } from "../../src/lib/changelog.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, "..", "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

describe("bundled changelog artifact parity", () => {
  it("matches the canonical source and current CLI package version", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
    const bundled = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "src", "data", "changelog.json"),
        "utf8",
      ),
    );
    const parsed = parseChangelog(
      fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8"),
    );

    expect(bundled.releases).toEqual(parsed);
    expect(latestCliVersion(bundled.releases)).toBe(packageJson.version);
    expect(bundled.releases[0].cliVersion).toBe(packageJson.version);
  });
});
