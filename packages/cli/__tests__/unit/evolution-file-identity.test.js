import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  withEvolutionDirectoryFileIdentity,
  withEvolutionFileIdentity,
} from "../../src/lib/evolution/evolution-file-identity.js";
import { openWorkbenchRollbackStore } from "../fixtures/evolution-workbench-rollback.js";

const AFFECTED = { platform: "win32", uvVersion: "1.49.1" };
const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-evolution-identity-"),
  );
  roots.push(root);
  const file = path.join(root, "record.json");
  fs.writeFileSync(file, "{}\n", { mode: 0o600 });
  return { root, file };
}

function projected(stat, overrides) {
  return Object.assign(Object.create(stat), overrides);
}

function zeroPathDeviceFs(volumeDirectory) {
  return {
    ...fs,
    openSync(target, ...args) {
      // The simulated Windows runtime asks for a Windows volume root even
      // on POSIX hosts. Anchor it to a real descriptor on the fixture's
      // volume; keep real fstat device/inode checks for every descriptor.
      const actual =
        process.platform !== "win32" && target === "\\"
          ? volumeDirectory
          : target;
      return fs.openSync(actual, ...args);
    },
    lstatSync(target, options) {
      const observed = fs.lstatSync(target, options);
      return projected(observed, { dev: options?.bigint ? 0n : 0 });
    },
  };
}

describe("evolution path/handle identity", () => {
  it("accepts affected path-device projection only against the held volume", () => {
    const { root, file } = fixture();
    const runtimeFs = zeroPathDeviceFs(root);
    withEvolutionFileIdentity(
      runtimeFs,
      file,
      (samePathHandle) => {
        const before = runtimeFs.lstatSync(file, { bigint: true });
        const descriptor = fs.openSync(file, "r");
        try {
          const opened = fs.fstatSync(descriptor, { bigint: true });
          expect(samePathHandle(before, opened)).toBe(true);
          expect(
            samePathHandle(before, projected(opened, { dev: opened.dev + 1n })),
          ).toBe(false);
          for (const field of [
            "ino",
            "mode",
            "nlink",
            "size",
            "mtimeNs",
            "ctimeNs",
          ]) {
            expect(
              samePathHandle(
                before,
                projected(opened, { [field]: opened[field] + 1n }),
              ),
            ).toBe(false);
          }
        } finally {
          fs.closeSync(descriptor);
        }
      },
      AFFECTED,
    );
  });

  it("shares one held parent authority across multiple child checks", () => {
    const { root, file } = fixture();
    const second = path.join(root, "second.json");
    fs.writeFileSync(second, "{}\n", { mode: 0o600 });
    const runtimeFs = zeroPathDeviceFs(root);
    const open = vi.spyOn(runtimeFs, "openSync");

    withEvolutionDirectoryFileIdentity(
      runtimeFs,
      root,
      (samePathHandle) => {
        for (const target of [file, second]) {
          const before = runtimeFs.lstatSync(target, { bigint: true });
          const descriptor = fs.openSync(target, "r");
          try {
            expect(
              samePathHandle(
                before,
                fs.fstatSync(descriptor, { bigint: true }),
              ),
            ).toBe(true);
          } finally {
            fs.closeSync(descriptor);
          }
        }
      },
      AFFECTED,
    );

    expect(open).toHaveBeenCalledTimes(2);
  });

  it.each([
    { platform: "win32", uvVersion: "1.51.0" },
    { platform: "linux", uvVersion: "1.49.1" },
  ])("retains exact device comparison on unaffected runtime %j", (runtime) => {
    const { file } = fixture();
    withEvolutionFileIdentity(
      fs,
      file,
      (samePathHandle) => {
        const stat = fs.statSync(file, { bigint: true });
        expect(samePathHandle(stat, stat)).toBe(true);
        expect(samePathHandle(projected(stat, { dev: 0n }), stat)).toBe(false);
      },
      runtime,
    );
  });

  it.skipIf(process.platform !== "win32")(
    "reopens a real Workbench ledger under the affected Windows projection",
    async () => {
      const { root } = fixture();
      const original = fs.lstatSync;
      const uvDescriptor = Object.getOwnPropertyDescriptor(
        process.versions,
        "uv",
      );
      Object.defineProperty(process.versions, "uv", {
        ...uvDescriptor,
        value: "1.49.1",
      });
      vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
        const observed = original(target, options);
        return String(target).startsWith(root)
          ? projected(observed, { dev: options?.bigint ? 0n : 0 })
          : observed;
      });
      try {
        const first = await openWorkbenchRollbackStore(root, { seed: true });
        const expected = first.backend.ledger.verify();
        expect(expected.eventCount).toBeGreaterThan(0);
        const reopened = await openWorkbenchRollbackStore(root);
        expect(reopened.backend.ledger.verify()).toEqual(expected);
        expect(reopened.release.readActive().state).toEqual(
          first.release.readActive().state,
        );
      } finally {
        Object.defineProperty(process.versions, "uv", uvDescriptor);
      }
    },
  );
});
