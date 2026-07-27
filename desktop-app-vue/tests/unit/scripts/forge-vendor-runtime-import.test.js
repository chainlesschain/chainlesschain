import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  REPO_ROOT,
  vendorWebShellInto,
} from "../../../scripts/prepare-web-shell-vendor.js";

let tempRoot;

function silentLog() {
  /* keep the product-level vendor probe quiet in unit output */
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forge-vendor-runtime-"));
});

afterEach(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("Forge vendored CLI runtime", () => {
  it("imports the real Plugin-bin collector from the staged Resources layout", () => {
    const standaloneNodeModules = path.join(
      tempRoot,
      "standalone-node_modules",
    );
    fs.mkdirSync(standaloneNodeModules, { recursive: true });
    fs.cpSync(
      path.join(REPO_ROOT, "node_modules", "semver"),
      path.join(standaloneNodeModules, "semver"),
      { recursive: true },
    );
    const nestedDependency = path.join(
      standaloneNodeModules,
      "fixture-parent",
      "node_modules",
      "fixture-child",
    );
    fs.mkdirSync(nestedDependency, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDependency, "package.json"),
      '{"name":"fixture-child","version":"1.0.0"}\n',
    );

    const resourcesRoot = path.join(tempRoot, "resources");
    const stats = vendorWebShellInto(resourcesRoot, {
      cliNodeModulesSource: standaloneNodeModules,
      log: silentLog,
    });

    const cliRoot = path.join(resourcesRoot, "packages", "cli");
    const cliPackage = JSON.parse(
      fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"),
    );
    expect(cliPackage.type).toBe("module");
    expect(
      fs.existsSync(
        path.join(cliRoot, "node_modules", "semver", "package.json"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          cliRoot,
          "node_modules",
          "fixture-parent",
          "node_modules",
          "fixture-child",
          "package.json",
        ),
      ),
    ).toBe(true);
    expect(stats.cliPackage.files).toBe(1);
    expect(stats.cliNodeModules.files).toBeGreaterThan(0);

    const helperPath = path.join(
      REPO_ROOT,
      "desktop-app-vue",
      "scripts",
      "prepare-web-shell-vendor.js",
    );
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const { verifyVendoredPluginBinRuntime } = require(${JSON.stringify(helperPath)});
          verifyVendoredPluginBinRuntime(process.argv[1])
            .then((result) => process.stdout.write(JSON.stringify(result)))
            .catch((error) => {
              console.error(error);
              process.exitCode = 1;
            });
        `,
        resourcesRoot,
      ],
      { encoding: "utf8" },
    );
    expect(probe.status, probe.stderr).toBe(0);
    const result = JSON.parse(probe.stdout);
    expect(result.exportName).toBe("collectWorkspacePluginBinSandboxPolicy");
    expect(result.modulePath).toBe(
      path.join(cliRoot, "src", "lib", "plugin-runtime", "bin.js"),
    );
  });

  it("prepares standalone CLI dependencies before every Forge packaging path", () => {
    const desktopPackage = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "desktop-app-vue", "package.json"),
        "utf8",
      ),
    );
    const forgeScripts = [
      "package",
      "make",
      "make:win",
      "make:mac",
      "make:mac:arm64",
      "make:mac:x64",
      "make:linux",
      "make:linux:x64",
      "make:linux:deb",
      "publish",
    ];

    for (const scriptName of forgeScripts) {
      expect(desktopPackage.scripts[scriptName]).toMatch(
        /^npm run prepare:cli-prod-deps && /,
      );
    }
  });
});
