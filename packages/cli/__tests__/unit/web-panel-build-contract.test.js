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
    const viteConfig = fs.readFileSync(
      path.join(repositoryRoot, "packages", "web-panel", "vite.config.js"),
      "utf8",
    );

    expect(script).toContain(
      "npm ci --include=dev --include=optional --legacy-peer-deps",
    );
    expect(script).toContain("fs.realpathSync.native(os.tmpdir())");
    expect(script).toContain('"@ant-design/colors"');
    expect(script).toContain('"@intlify/shared"');
    expect(script).toContain('execSync("npm run build:no-sync"');
    expect(packageJson.dependencies["@ant-design/colors"]).toBe("6.0.0");
    expect(packageJson.dependencies["@intlify/shared"]).toBe("9.14.5");
    expect(packageLock.packages[""].dependencies["@ant-design/colors"]).toBe(
      "6.0.0",
    );
    expect(packageLock.packages[""].dependencies["@intlify/shared"]).toBe(
      "9.14.5",
    );
    expect(viteConfig).toContain('"@intlify/shared": resolve(');
    expect(viteConfig).toContain('"@ant-design/colors": resolve(');
    expect(viteConfig).toContain(
      '"node_modules/@ant-design/colors/dist/index.esm.js"',
    );
    expect(viteConfig).toContain(
      '"node_modules/@intlify/shared/dist/shared.mjs"',
    );
  });
});
