import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  pathMatchesOpenedFileIdentitySync,
  sameOpenedFileIdentity,
} from "../../src/lib/packer/file-identity.js";

const temporaryDirectories = [];
const NODE_22_12_WINDOWS = Object.freeze({
  platform: "win32",
  uvVersion: "1.49.1",
});

function projectedStat(stat, overrides) {
  return new Proxy(stat, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function windowsPathDeviceProjection(filePath, projectTarget) {
  const resolvedTarget = path.resolve(filePath);
  return new Proxy(fs, {
    get(target, property) {
      if (property === "realpathSync") return fs.realpathSync;
      if (property === "lstatSync") {
        return (candidate, options) => {
          const stat = fs.lstatSync(candidate, options);
          return projectedStat(stat, {
            dev: projectTarget(path.resolve(candidate), resolvedTarget, stat),
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("packer file identity", () => {
  it("binds a pathname to the exact opened volume and file index", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-packer-identity-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "artifact.bin");
    fs.writeFileSync(filePath, "verified-payload");
    const descriptor = fs.openSync(filePath, "r");
    try {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      expect(pathMatchesOpenedFileIdentitySync(filePath, opened)).toBe(true);
      expect(
        pathMatchesOpenedFileIdentitySync(filePath, {
          ...opened,
          ino: opened.ino + 1n,
        }),
      ).toBe(false);
      expect(
        sameOpenedFileIdentity(opened, { ...opened, dev: opened.dev + 1n }),
      ).toBe(false);
    } finally {
      fs.closeSync(descriptor);
    }
  });

  it.runIf(process.platform === "win32")(
    "bridges only the affected libuv path-device projection through a trusted volume handle",
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-packer-win-device-"),
      );
      temporaryDirectories.push(directory);
      const filePath = path.join(directory, "artifact.exe");
      fs.writeFileSync(filePath, "verified-payload");
      const descriptor = fs.openSync(filePath, "r");
      try {
        const opened = fs.fstatSync(descriptor, { bigint: true });
        const projectedFs = windowsPathDeviceProjection(
          filePath,
          (_candidate, _target, stat) => stat.dev + 987654321n,
        );

        expect(
          pathMatchesOpenedFileIdentitySync(filePath, opened, {
            fileSystem: projectedFs,
            runtime: NODE_22_12_WINDOWS,
            stateFields: ["size", "mtimeNs", "ctimeNs"],
          }),
        ).toBe(true);
        expect(
          pathMatchesOpenedFileIdentitySync(filePath, opened, {
            fileSystem: projectedFs,
            runtime: { platform: "win32", uvVersion: "1.51.0" },
          }),
        ).toBe(false);
      } finally {
        fs.closeSync(descriptor);
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects an unanchored volume or changed file index on the compatibility path",
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-packer-win-anchor-"),
      );
      temporaryDirectories.push(directory);
      const filePath = path.join(directory, "artifact.exe");
      fs.writeFileSync(filePath, "verified-payload");
      const descriptor = fs.openSync(filePath, "r");
      try {
        const opened = fs.fstatSync(descriptor, { bigint: true });
        const projectedFs = windowsPathDeviceProjection(
          filePath,
          (_candidate, _target, stat) => stat.dev + 987654321n,
        );
        expect(
          pathMatchesOpenedFileIdentitySync(
            filePath,
            { ...opened, dev: opened.dev + 1n },
            {
              fileSystem: projectedFs,
              runtime: NODE_22_12_WINDOWS,
            },
          ),
        ).toBe(false);
        expect(
          pathMatchesOpenedFileIdentitySync(
            filePath,
            { ...opened, ino: opened.ino + 1n },
            {
              fileSystem: projectedFs,
              runtime: NODE_22_12_WINDOWS,
            },
          ),
        ).toBe(false);
      } finally {
        fs.closeSync(descriptor);
      }
    },
  );
});
