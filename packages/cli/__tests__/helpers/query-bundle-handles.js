import { expect, vi } from "vitest";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const uvDescriptor = Object.getOwnPropertyDescriptor(process.versions, "uv");

export function restoreQueryBundleIdentityRuntime() {
  Object.defineProperty(process.versions, "uv", uvDescriptor);
}

export function projectQueryBundleDevice(file) {
  Object.defineProperty(process.versions, "uv", {
    ...uvDescriptor,
    value: "1.49.1",
  });
  const lstat = fs.lstatSync;
  vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
    const stat = lstat(target, options);
    if (target === file) stat.dev = options?.bigint ? 0n : 0;
    return stat;
  });
  syncBuiltinESMExports();
}

// Record each allocation separately: the compatibility probe may reopen the
// bundle and the OS may reuse its fd while the actual data fd remains open.
export function observeQueryBundleHandles(bundleFile, onRead = () => {}) {
  const open = fs.openSync;
  const read = fs.readSync;
  const close = fs.closeSync;
  const fstat = fs.fstatSync;
  const opened = [];
  const live = new Map();
  vi.spyOn(fs, "openSync").mockImplementation((file, ...args) => {
    const fd = open(file, ...args);
    const handle = {
      file,
      fd,
      flags: args[0],
      readCalls: 0,
      bytesRead: 0,
      closed: false,
    };
    opened.push(handle);
    live.set(fd, handle);
    return fd;
  });
  vi.spyOn(fs, "readSync").mockImplementation((fd, ...args) => {
    const count = read(fd, ...args);
    const handle = live.get(fd);
    if (handle) {
      handle.readCalls++;
      handle.bytesRead += count;
      if (handle.file === bundleFile && count > 0) onRead(handle, count);
    }
    return count;
  });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    const result = close(fd);
    const handle = live.get(fd);
    if (handle) {
      handle.closed = true;
      live.delete(fd);
    }
    return result;
  });
  syncBuiltinESMExports();
  return {
    opened,
    bundle: () => opened.filter((handle) => handle.file === bundleFile),
    readOnlyBundle: () =>
      opened.filter(
        (handle) =>
          handle.file === bundleFile &&
          (handle.flags === "r" ||
            (typeof handle.flags === "number" &&
              (handle.flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) ===
                0)),
      ),
    data: () =>
      opened.filter(
        (handle) => handle.file === bundleFile && handle.readCalls > 0,
      ),
    assertClosed() {
      expect(opened.length).toBeGreaterThan(0);
      expect(live.size).toBe(0);
      for (const handle of opened) {
        expect(handle.closed).toBe(true);
        expect(() => fstat(handle.fd)).toThrow(
          expect.objectContaining({ code: "EBADF" }),
        );
      }
    },
  };
}
