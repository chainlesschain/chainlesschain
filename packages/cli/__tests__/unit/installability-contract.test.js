import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDirectory, "..", "..");
const repositoryRoot = path.resolve(cliRoot, "..", "..");

const readManifest = (manifestPath) =>
  JSON.parse(fs.readFileSync(manifestPath, "utf8"));

describe("npm first-install contract", () => {
  it("keeps native SQLite drivers optional and ships the WASM fallback", () => {
    const cliManifest = readManifest(path.join(cliRoot, "package.json"));
    const hubManifest = readManifest(
      path.join(
        repositoryRoot,
        "packages",
        "personal-data-hub",
        "package.json",
      ),
    );

    expect(cliManifest.dependencies[hubManifest.name]).toBe(
      hubManifest.version,
    );
    expect(cliManifest.dependencies["sql.js"]).toBeTruthy();
    expect(cliManifest.optionalDependencies["better-sqlite3"]).toBeTruthy();

    expect(
      hubManifest.dependencies["better-sqlite3-multiple-ciphers"],
    ).toBeUndefined();
    expect(
      hubManifest.optionalDependencies["better-sqlite3-multiple-ciphers"],
    ).toBe("^12.5.0");
  });
});
