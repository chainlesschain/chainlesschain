import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_BOUNDED_READ_FAILED_CODE as FAILED,
  withBoundedArtifactDirectoryRead as withDirectory,
} from "../../src/lib/bounded-artifact-file-read.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root, target, bytes;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-bounded-directory-"));
  target = path.join(root, "artifact.json");
  bytes = Buffer.from('{"value":"fresh bytes"}');
  fs.writeFileSync(target, bytes);
});
function removeFixture(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== temp ||
    !path.basename(resolved).startsWith("cc-bounded-directory-")
  )
    throw new Error("unsafe bounded directory cleanup");
  fs.rmSync(resolved, { recursive: true, force: true });
}
afterEach(() => {
  vi.restoreAllMocks();
  removeFixture(root);
});

describe("bounded artifact directory read window", () => {
  it("holds one real parent for a batch, closes every descriptor and rereads changed bytes", () => {
    const originalOpen = fs.openSync,
      originalClose = fs.closeSync;
    const parentOpens = [],
      live = new Set();
    vi.spyOn(fs, "openSync").mockImplementation((name, ...args) => {
      const fd = originalOpen(name, ...args);
      live.add(fd);
      if (name === root) parentOpens.push(fd);
      return fd;
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      live.delete(fd);
      return originalClose(fd);
    });
    const changed = Buffer.from('{"value":"other bytes"}');
    expect(changed.length).toBe(bytes.length);
    withDirectory(root, (read) => {
      for (let index = 0; index < 12; index++)
        expect(read(target, bytes.length, 1024)).toEqual(bytes);
      fs.writeFileSync(target, changed);
      expect(read(target, changed.length, 1024)).toEqual(changed);
    });
    expect(parentOpens).toHaveLength(1);
    expect(live.size).toBe(0);
  });

  it("rejects nested and escaped paths before opening them and expires escaped readers", () => {
    let escaped;
    const open = vi.spyOn(fs, "openSync");
    withDirectory(root, (read) => {
      escaped = read;
      for (const invalid of [
        path.join(root, "nested", "data.json"),
        path.join(temp, "outside.json"),
      ]) {
        expect(() => read(invalid, 1, 1024)).toThrow("direct child");
        expect(open.mock.calls.some(([name]) => name === invalid)).toBe(false);
      }
      expect(read(target, bytes.length, 1024)).toEqual(bytes);
    });
    expect(() => escaped(target, bytes.length, 1024)).toThrow(
      "window is closed",
    );
  });

  it("preserves callback errors and closes both parent and file on I/O failure", () => {
    const originalOpen = fs.openSync,
      originalClose = fs.closeSync;
    const live = new Set();
    vi.spyOn(fs, "openSync").mockImplementation((...args) => {
      const fd = originalOpen(...args);
      live.add(fd);
      return fd;
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      live.delete(fd);
      return originalClose(fd);
    });
    const originalError = new Error("caller stopped this read");
    let escaped;
    expect(() =>
      withDirectory(root, (read) => {
        escaped = read;
        throw originalError;
      }),
    ).toThrow(originalError);
    expect(live.size).toBe(0);
    expect(() => escaped(target, bytes.length, 1024)).toThrow(
      "window is closed",
    );
    vi.spyOn(fs, "readSync").mockImplementation(() => {
      throw new Error("real descriptor read failed");
    });
    expect(() =>
      withDirectory(root, (read) => read(target, bytes.length, 1024)),
    ).toThrow("artifact bounded descriptor read failed");
    expect(live.size).toBe(0);
  });

  it("rejects async callbacks before opening and closes a callback returning a promise", () => {
    const open = vi.spyOn(fs, "openSync");
    expect(() => withDirectory(root, async () => null)).toThrow(TypeError);
    expect(open).not.toHaveBeenCalled();
    let escaped;
    expect(() =>
      withDirectory(root, (read) => {
        escaped = read;
        return Promise.resolve(null);
      }),
    ).toThrow("must not return a promise");
    expect(() => escaped(target, bytes.length, 1024)).toThrow(
      "window is closed",
    );
  });

  it("rejects a replaced parent before returning the batch even when each child's bytes match", () => {
    const retired = root + "-retired";
    expect(path.dirname(path.resolve(retired))).toBe(temp);
    let moved = false;
    try {
      expect(() =>
        withDirectory(root, (read) => {
          expect(read(target, bytes.length, 1024)).toEqual(bytes);
          fs.renameSync(root, retired);
          moved = true;
          fs.mkdirSync(root);
          fs.writeFileSync(target, bytes);
          expect(read(target, bytes.length, 1024)).toEqual(bytes);
        }),
      ).toThrow(expect.objectContaining({ code: FAILED }));
    } finally {
      if (moved) {
        removeFixture(root);
        fs.renameSync(retired, root);
      }
    }
  });

  it.each(["uid", "gid", "mtimeNs", "ctimeNs"])(
    "keeps full-precision %s post-read checks inside a shared parent",
    (field) => {
      const originalRead = fs.readSync,
        originalFstat = fs.fstatSync;
      let changed = false;
      vi.spyOn(fs, "readSync").mockImplementation((...args) => {
        const count = originalRead(...args);
        changed = true;
        return count;
      });
      vi.spyOn(fs, "fstatSync").mockImplementation((...args) => {
        const stat = originalFstat(...args);
        if (changed && stat.isFile() && args[1]?.bigint) stat[field] += 1n;
        return stat;
      });
      expect(() =>
        withDirectory(root, (read) => read(target, bytes.length, 1024)),
      ).toThrow("artifact descriptor changed during bounded read");
    },
  );

  it("rejects hard links and enforces exact bounded EOF reads within the batch", () => {
    fs.linkSync(target, path.join(root, "linked.json"));
    const content = vi.spyOn(fs, "readSync");
    expect(() =>
      withDirectory(root, (read) => read(target, bytes.length, 1024)),
    ).toThrow("single-link file");
    expect(content).not.toHaveBeenCalled();
    fs.unlinkSync(path.join(root, "linked.json"));
    const originalRead = fs.readSync;
    content.mockRestore();
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        if (position === bytes.length) fs.appendFileSync(target, "growth");
        return originalRead(fd, buffer, offset, length, position);
      },
    );
    expect(() =>
      withDirectory(root, (read) => read(target, bytes.length, 1024)),
    ).toThrow("artifact bounded descriptor read failed");
  });
});
