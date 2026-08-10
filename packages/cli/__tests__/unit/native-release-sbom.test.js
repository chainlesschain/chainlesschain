import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeReleaseSbom } from "../../scripts/create-native-release-sbom.mjs";
import {
  resolvePublicRedirect,
  validatePublicDownloadLimit,
  validatePublicDownloadUrl,
} from "../../scripts/download-public-release-file.mjs";
import {
  assertNativeReleaseIdentity,
  assertStrictSemver,
  nativePackageManagerContract,
} from "../../scripts/native-release-contract.mjs";

const directories = [];
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TIMESTAMP = "2026-08-10T00:00:00.000Z";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-native-sbom-"));
  directories.push(root);
  const packageJson = {
    name: "chainlesschain",
    version: "1.2.3",
    dependencies: { runtime: "^1.0.0" },
    optionalDependencies: { optional: "^2.0.0" },
    devDependencies: { "dev-only": "^9.0.0" },
  };
  const lock = {
    name: "repository-root",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "repository-root", version: "1.0.0" },
      "packages/cli": {
        name: "chainlesschain",
        version: "1.2.3",
        dependencies: { runtime: "^1.0.0" },
        optionalDependencies: { optional: "^2.0.0" },
        devDependencies: { "dev-only": "^9.0.0" },
      },
      "packages/cli/node_modules/runtime": {
        version: "1.4.0",
        integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
        license: "MIT",
        dependencies: { nested: "1.0.0" },
        peerDependencies: {
          "peer-runtime": "^3.0.0",
          "optional-peer": "^4.0.0",
        },
        peerDependenciesMeta: {
          "optional-peer": { optional: true },
        },
      },
      "node_modules/nested": {
        version: "1.0.0",
        integrity: `sha512-${Buffer.alloc(64, 2).toString("base64")}`,
      },
      "node_modules/optional": {
        version: "2.0.1",
        optional: true,
        integrity: `sha512-${Buffer.alloc(64, 3).toString("base64")}`,
      },
      "node_modules/dev-only": {
        version: "9.0.1",
        dev: true,
        integrity: `sha512-${Buffer.alloc(64, 4).toString("base64")}`,
      },
      "node_modules/peer-runtime": {
        version: "3.0.1",
        dev: true,
        integrity: `sha512-${Buffer.alloc(64, 5).toString("base64")}`,
      },
      "node_modules/optional-peer": {
        version: "4.0.1",
        dev: true,
        integrity: `sha512-${Buffer.alloc(64, 6).toString("base64")}`,
      },
    },
  };
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return { root, packagePath, lockPath, packageJson, lock };
}

function property(component, name) {
  return component.properties.find((item) => item.name === name)?.value;
}

describe("native release deterministic SBOM", () => {
  it("derives the same runtime-only graph from the exact repository lock", () => {
    const value = fixture();
    const options = {
      lockPath: value.lockPath,
      packagePath: value.packagePath,
      commit: COMMIT,
      timestamp: TIMESTAMP,
    };
    const first = createNativeReleaseSbom(options);
    const second = createNativeReleaseSbom(options);
    expect(second).toEqual(first);
    expect(first.components.map((item) => item.name).sort()).toEqual([
      "nested",
      "optional",
      "peer-runtime",
      "runtime",
    ]);
    expect(first.components).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "dev-only" })]),
    );
    expect(first.components).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "optional-peer" }),
      ]),
    );
    expect(
      property(first.metadata.component, "chainlesschain:lock.sha256"),
    ).toBe(sha256(fs.readFileSync(value.lockPath)));
    expect(
      property(first.metadata.component, "chainlesschain:runtime.refs.count"),
    ).toBe("4");
    expect(first.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/u);
  });

  it("rejects package metadata that drifts from the repository lock", () => {
    const value = fixture();
    value.packageJson.dependencies.runtime = "^2.0.0";
    fs.writeFileSync(
      value.packagePath,
      `${JSON.stringify(value.packageJson, null, 2)}\n`,
    );
    expect(() =>
      createNativeReleaseSbom({
        lockPath: value.lockPath,
        packagePath: value.packagePath,
        commit: COMMIT,
        timestamp: TIMESTAMP,
      }),
    ).toThrow(/does not match the exact repository lock/);
  });
});

describe("native release version and package-manager history contract", () => {
  it.each(["0.0.0", "1.2.3", "1.2.3-rc.1", "1.2.3+build.7"])(
    "accepts strict SemVer %s",
    (version) => {
      expect(assertStrictSemver(version)).toBe(version);
      expect(assertNativeReleaseIdentity(`cli-v${version}`, version)).toEqual({
        tag: `cli-v${version}`,
        version,
      });
    },
  );

  it.each(["01.2.3", "1.02.3", "1.2.03", "1.2", "v1.2.3", "1.2.3-01"])(
    "rejects non-strict version %s",
    (version) => {
      expect(() => assertStrictSemver(version)).toThrow(/strict SemVer/);
    },
  );

  it("pins the signed package-manager generator and complete WinGet file set", () => {
    expect(nativePackageManagerContract()).toEqual({
      schema: 2,
      generator: "chainlesschain.package-manager-manifests.v2",
      homebrew: { formula: "chainlesschain.rb" },
      winget: {
        packageIdentifier: "ChainlessChain.ChainlessChainCLI",
        manifestVersion: "1.9.0",
        files: [
          "ChainlessChain.ChainlessChainCLI.yaml",
          "ChainlessChain.ChainlessChainCLI.locale.en-US.yaml",
          "ChainlessChain.ChainlessChainCLI.installer.yaml",
        ],
      },
    });
  });
});

describe("anonymous public download boundary", () => {
  it("allows only the profile host on every redirect hop", () => {
    const start = validatePublicDownloadUrl(
      "https://github.com/chainlesschain/chainlesschain/releases/download/cli-v1.2.3/a",
      "release",
    );
    expect(
      resolvePublicRedirect(
        start,
        "https://release-assets.githubusercontent.com/object",
        "release",
      ).hostname,
    ).toBe("release-assets.githubusercontent.com");
    expect(() =>
      resolvePublicRedirect(
        start,
        "https://attacker.invalid/object",
        "release",
      ),
    ).toThrow(/outside the release HTTPS allowlist/);
  });

  it.each([
    "http://github.com/file",
    "https://user@github.com/file",
    "https://github.com:444/file",
    "https://github.com/file#fragment",
  ])("rejects unsafe public URL %s", (url) => {
    expect(() => validatePublicDownloadUrl(url, "release")).toThrow(
      /outside the release HTTPS allowlist/,
    );
  });

  it("rejects missing, zero, unsafe, or excessive size limits", () => {
    expect(validatePublicDownloadLimit(1024)).toBe(1024);
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, "bad"]) {
      expect(() => validatePublicDownloadLimit(value)).toThrow(
        /public download limit/,
      );
    }
  });
});
