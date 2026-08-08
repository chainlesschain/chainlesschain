import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");

describe("web-panel isolated build contract", () => {
  it("uses the lockfile and verifies the ARM64-missing dependency", () => {
    const script = fs.readFileSync(
      path.join(
        repositoryRoot,
        "packages",
        "cli",
        "scripts",
        "build-web-panel.mjs",
      ),
      "utf8",
    );
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.join(repositoryRoot, "packages", "web-panel", "package.json"),
        "utf8",
      ),
    );
    const packageLock = JSON.parse(
      fs.readFileSync(
        path.join(repositoryRoot, "packages", "web-panel", "package-lock.json"),
        "utf8",
      ),
    );

    expect(script).toContain(
      "npm ci --include=dev --include=optional --legacy-peer-deps",
    );
    expect(script).toContain('"@intlify/shared"');
    expect(script).toContain('execSync("npm run build:no-sync"');
    expect(packageJson.dependencies["@intlify/shared"]).toBe("9.14.5");
    expect(packageLock.packages[""].dependencies["@intlify/shared"]).toBe(
      "9.14.5",
    );
  });
});
