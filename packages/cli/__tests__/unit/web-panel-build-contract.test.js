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
    expect(script).toContain('execSync("npm run build:no-sync"');
    const pinnedRuntimePackages = {
      "@ant-design/colors": "6.0.0",
      "@ant-design/icons-svg": "4.4.2",
      "@babel/runtime": "7.29.2",
      "@ctrl/tinycolor": "3.6.1",
      "@emotion/hash": "0.9.2",
      "@emotion/unitless": "0.8.1",
      "@intlify/core-base": "9.14.5",
      "@intlify/message-compiler": "9.14.5",
      "@intlify/shared": "9.14.5",
      "@simonwep/pickr": "1.8.2",
      "@vue/devtools-api": "6.6.4",
    };
    for (const [name, version] of Object.entries(pinnedRuntimePackages)) {
      if (name === "@babel/runtime") {
        expect(script).toContain('"@babel/runtime/helpers/extends"');
      } else {
        expect(script).toContain(`"${name}"`);
      }
      expect(packageJson.dependencies[name]).toBe(version);
      expect(packageLock.packages[""].dependencies[name]).toBe(version);
    }
    expect(viteConfig).toContain('"@intlify/shared": resolve(');
    expect(viteConfig).toContain("maxParallelFileOps: 64");
    expect(viteConfig).toContain('"@ant-design/colors": resolve(');
    expect(viteConfig).toContain(
      '"node_modules/@ant-design/colors/dist/index.esm.js"',
    );
    expect(viteConfig).toContain('"@intlify/core-base": resolve(');
    expect(viteConfig).toContain(
      '"node_modules/@intlify/core-base/dist/core-base.mjs"',
    );
    expect(viteConfig).toContain('"@intlify/message-compiler": resolve(');
    expect(viteConfig).toContain(
      '"node_modules/@intlify/message-compiler/dist/message-compiler.mjs"',
    );
    expect(viteConfig).toContain(
      '"node_modules/@intlify/shared/dist/shared.mjs"',
    );
  });
});
