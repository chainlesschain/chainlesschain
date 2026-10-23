import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flushWindowsLocalNtfsDirectory } from "../../src/lib/evolution/evolution-windows-directory-durability.js";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function directory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-directory-flush-"));
  directories.push(root);
  return root;
}

function fileSystemWithStats(transform) {
  return Object.assign(Object.create(fs), {
    lstatSync(...args) {
      const stat = fs.lstatSync(...args);
      return Object.assign(Object.create(stat), transform(stat));
    },
  });
}

describe.skipIf(process.platform !== "win32")(
  "Windows native directory durability identities",
  () => {
    it("flushes a real local NTFS directory with native Node stat identities", () => {
      expect(flushWindowsLocalNtfsDirectory(directory())).toBe(
        "windows-directory-flush",
      );
    });

    it.each(["low DWORD", "full 64-bit"])(
      "accepts the %s Node volume representation against the same native handle",
      (representation) => {
        const fsImpl = fileSystemWithStats((stat) => ({
          dev:
            BigInt.asUintN(32, stat.dev) |
            (representation === "full 64-bit" ? 0x34f5ee1200000000n : 0n),
        }));
        expect(flushWindowsLocalNtfsDirectory(directory(), { fsImpl })).toBe(
          "windows-directory-flush",
        );
      },
    );

    it("rejects a different low DWORD volume serial", () => {
      const fsImpl = fileSystemWithStats((stat) => ({ dev: stat.dev ^ 1n }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(directory(), { fsImpl }),
      ).toThrow(/requires a local NTFS directory/u);
    });

    it("rejects changes confined to the high bits between path observations", () => {
      let reads = 0;
      const fsImpl = fileSystemWithStats((stat) => ({
        dev: BigInt.asUintN(32, stat.dev) | (BigInt(++reads) << 32n),
      }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(directory(), { fsImpl }),
      ).toThrow(/directory changed during flush/u);
    });

    it("rejects a different file ID on the same volume", () => {
      const fsImpl = fileSystemWithStats((stat) => ({ ino: stat.ino ^ 1n }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(directory(), { fsImpl }),
      ).toThrow(/handle does not match the requested directory/u);
    });
  },
);
