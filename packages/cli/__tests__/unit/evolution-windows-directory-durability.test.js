import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function observeNativeVolume(root, observe) {
  return (api) => {
    const handle = api.CreateFileW(root, 0, 7, null, 3, 0x02200000, null);
    try {
      const identity = {};
      expect(
        api.GetFileInformationByHandleEx(
          handle,
          18,
          identity,
          api.koffi.sizeof(api.FILE_ID_INFO),
        ),
      ).toBe(true);
      observe(BigInt(identity.volumeSerialNumber));
    } finally {
      expect(api.CloseHandle(handle)).toBe(true);
    }
    return api;
  };
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
        const root = directory();
        let device;
        const nativeApi = observeNativeVolume(root, (serial) => {
          device =
            representation === "full 64-bit"
              ? serial
              : BigInt.asUintN(32, serial);
        });
        const fsImpl = fileSystemWithStats(() => ({ dev: device }));
        expect(
          flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi }),
        ).toBe("windows-directory-flush");
      },
    );

    it("rejects a different low DWORD volume serial", () => {
      const fsImpl = fileSystemWithStats((stat) => ({ dev: stat.dev ^ 1n }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(directory(), { fsImpl }),
      ).toThrow(/handle does not match the requested directory/u);
    });

    it("rejects changes confined to the high bits between path observations", () => {
      const root = directory();
      let device;
      const nativeApi = observeNativeVolume(root, (serial) => {
        device = serial;
      });
      let reads = 0;
      const fsImpl = fileSystemWithStats(() => ({
        dev: reads++ === 0 ? device : device ^ (1n << 32n),
      }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi }),
      ).toThrow(/directory changed during flush/u);
    });

    it("rejects forged high serial bits even with the correct DWORD and inode", () => {
      const root = directory();
      let device;
      const nativeApi = observeNativeVolume(root, (serial) => {
        device = serial ^ (1n << 63n);
      });
      const fsImpl = fileSystemWithStats(() => ({ dev: device }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi }),
      ).toThrow(/handle does not match/u);
    });

    it("rejects a different file ID on the same volume", () => {
      const fsImpl = fileSystemWithStats((stat) => ({ ino: stat.ino ^ 1n }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(directory(), { fsImpl }),
      ).toThrow(/handle does not match the requested directory/u);
    });
  },
);

// The fast ByName API is absent on older Windows hosts. Model its documented
// layout separately so the Node 22.12 compatibility path remains covered there.
function fastStatApi(root, mutate = () => {}) {
  const stat = fs.lstatSync(root, { bigint: true });
  const serial = BigInt.asUintN(32, stat.dev) || 123n;
  const fullSerial = serial | 0x34f5ee1200000000n;
  const identity = { low: stat.ino, high: 0n };
  let reads = 0;
  const api = {
    koffi: { sizeof: () => 8, address: () => 1n },
    FILE_ID_INFO: "file-id-info",
    FILE_STAT_INFORMATION: "file-stat-info",
    FILE_STAT_BASIC_INFORMATION: "file-stat-basic-info",
    GetVolumePathNameW(_path, output) {
      output.write(path.parse(root).root + "\0", "utf16le");
      return true;
    },
    GetDriveTypeW: () => 3,
    GetVolumeInformationW(
      _root,
      _name,
      _size,
      serialOutput,
      _max,
      _flags,
      fsName,
    ) {
      serialOutput[0] = Number(serial);
      fsName.write("NTFS\0", "utf16le");
      return true;
    },
    CreateFileW: () => 1n,
    GetFileInformationByHandle(_handle, output) {
      Object.assign(output, {
        fileAttributes: 0x10,
        volumeSerialNumber: Number(serial),
        fileIndexLow: Number(BigInt.asUintN(32, stat.ino)),
        fileIndexHigh: Number(stat.ino >> 32n),
      });
      return true;
    },
    GetFileInformationByHandleEx(_handle, _class, output) {
      Object.assign(output, {
        volumeSerialNumber: fullSerial,
        fileId: { ...identity },
      });
      return true;
    },
    NtQueryInformationFile(_handle, _ioStatus, output) {
      output.fileId = stat.ino;
      return 0;
    },
    GetFileInformationByName(_path, _class, output) {
      Object.assign(output, {
        fileAttributes: 0x10,
        volumeSerialNumber: fullSerial,
        fileId128: { ...identity },
        fileId: stat.ino,
      });
      mutate(output, ++reads);
      return true;
    },
    FlushFileBuffers: vi.fn(() => true),
    CloseHandle: vi.fn(() => true),
    GetLastError: () => 5,
  };
  return api;
}

describe.skipIf(process.platform !== "win32")(
  "Windows fast-stat ABI compatibility",
  () => {
    it.each([
      { mismatch: false, longPath: false },
      { mismatch: true, longPath: false },
      { mismatch: false, longPath: true },
    ])(
      "binds controlled ByName data to real native handles (mismatch=$mismatch, longPath=$longPath)",
      ({ mismatch, longPath }) => {
        const base = directory();
        const root = longPath
          ? path.join(base, ...Array(9).fill("nested-directory-for-identity"))
          : base;
        if (longPath) {
          expect(root.length).toBeGreaterThan(260);
          fs.mkdirSync(root, { recursive: true });
        }
        let node22Device;
        const fsImpl = fileSystemWithStats(() => ({ dev: node22Device }));
        const nativeApi = (api) => {
          expect(api.koffi.sizeof(api.FILE_STAT_BASIC_INFORMATION)).toBe(104);
          expect(
            api.koffi.offsetof(
              api.FILE_STAT_BASIC_INFORMATION,
              "volumeSerialNumber",
            ),
          ).toBe(80);
          expect(
            api.koffi.offsetof(api.FILE_STAT_BASIC_INFORMATION, "fileId128"),
          ).toBe(88);
          expect(api.koffi.sizeof(api.FILE_ID_INFO)).toBe(24);
          expect(api.koffi.sizeof(api.FILE_STAT_INFORMATION)).toBe(72);
          const readPathIdentity = (directoryPath) => {
            const handle = api.CreateFileW(
              path.toNamespacedPath(directoryPath),
              0,
              7,
              null,
              3,
              0x02200000,
              null,
            );
            try {
              const identity = {};
              expect(
                api.GetFileInformationByHandleEx(
                  handle,
                  18,
                  identity,
                  api.koffi.sizeof(api.FILE_ID_INFO),
                ),
              ).toBe(true);
              const stat = {};
              expect(
                api.NtQueryInformationFile(
                  handle,
                  {},
                  stat,
                  api.koffi.sizeof(api.FILE_STAT_INFORMATION),
                  68,
                ),
              ).toBeGreaterThanOrEqual(0);
              const basic = {};
              expect(api.GetFileInformationByHandle(handle, basic)).toBe(true);
              return {
                fileAttributes: basic.fileAttributes,
                volumeSerialNumber: identity.volumeSerialNumber,
                fileId128: identity.fileId,
                fileId: stat.fileId,
              };
            } finally {
              expect(api.CloseHandle(handle)).toBe(true);
            }
          };
          node22Device = BigInt(readPathIdentity(root).fileId128.high);
          return {
            ...api,
            GetFileInformationByName(directoryPath, _class, output) {
              expect(directoryPath).toBe(path.toNamespacedPath(root));
              expect(directoryPath.startsWith("\\\\?\\")).toBe(true);
              Object.assign(output, readPathIdentity(directoryPath));
              if (mismatch)
                output.fileId128.high = BigInt(output.fileId128.high) ^ 1n;
              return true;
            },
          };
        };
        if (mismatch) {
          expect(() =>
            flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi }),
          ).toThrow(/path identity does not match/u);
        } else {
          expect(
            flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi }),
          ).toBe("windows-directory-flush");
        }
      },
    );

    it("accepts Node 22.12's HighPart/ino only after native identity binding", () => {
      const root = directory();
      const api = fastStatApi(root);
      const fsImpl = fileSystemWithStats(() => ({ dev: 0n }));
      expect(
        flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi: api }),
      ).toBe("windows-directory-flush");
      expect(api.FlushFileBuffers).toHaveBeenCalledOnce();
      expect(api.CloseHandle).toHaveBeenCalledOnce();
    });

    it("does not treat dev zero as a fallback when ByName is unavailable", () => {
      const root = directory();
      const api = fastStatApi(root);
      api.GetFileInformationByName = null;
      const fsImpl = fileSystemWithStats(() => ({ dev: 0n }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi: api }),
      ).toThrow(/handle does not match/u);
      expect(api.FlushFileBuffers).not.toHaveBeenCalled();
      expect(api.CloseHandle).toHaveBeenCalledOnce();
    });

    it.each([
      "volume-high",
      "id-low",
      "id-high",
      "path-file-id",
      "reparse",
      "not-directory",
    ])("rejects unbound %s despite matching Node dev/ino", (change) => {
      const root = directory();
      const api = fastStatApi(root, (output) => {
        if (change === "volume-high") output.volumeSerialNumber ^= 1n << 32n;
        if (change === "id-low") output.fileId128.low ^= 1n;
        if (change === "id-high") output.fileId128.high ^= 1n;
        if (change === "path-file-id") output.fileId ^= 1n;
        if (change === "reparse") output.fileAttributes |= 0x400;
        if (change === "not-directory") output.fileAttributes = 0;
      });
      const fsImpl = fileSystemWithStats(() => ({ dev: 0n }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi: api }),
      ).toThrow(/path identity does not match/u);
      expect(api.FlushFileBuffers).not.toHaveBeenCalled();
      expect(api.CloseHandle).toHaveBeenCalledOnce();
    });

    it("detects a native path replacement after flush with unchanged Node dev/ino", () => {
      const root = directory();
      const api = fastStatApi(root, (output, reads) => {
        if (reads === 2) output.volumeSerialNumber ^= 1n << 32n;
      });
      const fsImpl = fileSystemWithStats(() => ({ dev: 0n }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi: api }),
      ).toThrow(/path identity does not match/u);
      expect(api.FlushFileBuffers).toHaveBeenCalledOnce();
      expect(api.CloseHandle).toHaveBeenCalledOnce();
    });

    it("does not mix Node dev with a different inode projection", () => {
      const root = directory();
      const api = fastStatApi(root);
      const fsImpl = fileSystemWithStats((stat) => ({
        dev: 0n,
        ino: stat.ino ^ 1n,
      }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi: api }),
      ).toThrow(/handle does not match/u);
      expect(api.FlushFileBuffers).not.toHaveBeenCalled();
    });

    it.each([
      "GetFileInformationByHandleEx",
      "NtQueryInformationFile",
      "GetFileInformationByName",
    ])("fails closed when %s fails", (method) => {
      const root = directory();
      const api = fastStatApi(root);
      api[method] = () => (method === "NtQueryInformationFile" ? -1 : false);
      const fsImpl = fileSystemWithStats(() => ({ dev: 0n }));
      expect(() =>
        flushWindowsLocalNtfsDirectory(root, { fsImpl, nativeApi: api }),
      ).toThrow(/unavailable/u);
      expect(api.FlushFileBuffers).not.toHaveBeenCalled();
      expect(api.CloseHandle).toHaveBeenCalledOnce();
    });
  },
);
