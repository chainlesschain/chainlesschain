import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readBoundedArtifactFile as read,
  ARTIFACT_BOUNDED_READ_FAILED_CODE as FAILED,
} from "../../src/lib/bounded-artifact-file-read.js";
import {
  ArtifactStore,
  MAX_ARTIFACT_BYTES,
} from "../../src/lib/artifact-store.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root, target, bytes;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-bounded-artifact-"));
  target = path.join(root, "bytes.json");
  bytes = Buffer.from('{"text":"actual local bytes"}\n');
  fs.writeFileSync(target, bytes);
});
afterEach(() => {
  vi.restoreAllMocks();
  const resolved = path.resolve(root);
  if (
    path.dirname(resolved) !== temp ||
    !path.basename(resolved).startsWith("cc-bounded-artifact-")
  )
    throw new Error("unsafe bounded artifact cleanup");
  fs.rmSync(resolved, { recursive: true, force: true });
});
function held(operation, message, causeMessage) {
  let error;
  try {
    operation();
  } catch (cause) {
    error = cause;
  }
  expect(error).toMatchObject({
    code: FAILED,
    ...(message ? { message } : {}),
  });
  if (causeMessage) expect(error.cause?.message).toBe(causeMessage);
}
function track() {
  const originalOpen = fs.openSync,
    originalClose = fs.closeSync;
  const live = new Set(),
    closed = [];
  vi.spyOn(fs, "openSync").mockImplementation((name, ...args) => {
    const fd = originalOpen(name, ...args);
    if (name === target) live.add(fd);
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    if (live.delete(fd)) closed.push(fd);
    return originalClose(fd);
  });
  return { live, closed };
}
function stats(handles, project) {
  const originalPath = fs.lstatSync,
    originalFd = fs.fstatSync;
  vi.spyOn(fs, "lstatSync").mockImplementation((name, options) => {
    const stat = originalPath(name, options);
    return name === target ? project(stat, "path", options) : stat;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
    const stat = originalFd(fd, options);
    return handles.live.has(fd) ? project(stat, "fd", options) : stat;
  });
}
const fields = [
  "dev",
  "ino",
  "mode",
  "uid",
  "gid",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
];

describe("bounded artifact file windows", () => {
  it("returns exact bytes including an empty file and accepts a coherent same-byte new inode on a later independent read", () => {
    expect(read(target, bytes.length, 1024)).toEqual(bytes);
    const saved = path.join(root, "saved-bytes"),
      inode = fs.lstatSync(target, { bigint: true }).ino;
    fs.renameSync(target, saved);
    fs.writeFileSync(target, bytes);
    expect(fs.lstatSync(target, { bigint: true }).ino).not.toBe(inode);
    expect(read(target, bytes.length, 1024)).toEqual(bytes);
    fs.writeFileSync(target, "");
    expect(read(target, 0, 1024)).toEqual(Buffer.alloc(0));
  });
  it.each(["path", "fd"].flatMap((api) => fields.map((field) => [api, field])))(
    "rejects Number fallback in %s %s before content reads",
    (api, field) => {
      const handles = track(),
        content = vi.spyOn(fs, "readSync");
      stats(handles, (stat, source, options) => {
        if (source === api && options?.bigint)
          stat[field] = Number(stat[field]);
        return stat;
      });
      held(
        () => read(target, bytes.length, 1024),
        `artifact ${api === "fd" ? "descriptor" : "path"} requires full-precision stat fields`,
      );
      expect(content).not.toHaveBeenCalled();
      expect(handles.live.size).toBe(0);
    },
  );
  it("rejects different full path/fd inode IDs whose Number projections collide", () => {
    const handles = track(),
      content = vi.spyOn(fs, "readSync");
    stats(handles, (stat, source, options) => {
      if (options?.bigint)
        stat.ino = (1n << 60n) + (source === "path" ? 1n : 2n);
      return stat;
    });
    expect(Number((1n << 60n) + 1n)).toBe(Number((1n << 60n) + 2n));
    held(
      () => read(target, bytes.length, 1024),
      "artifact path and descriptor identities differ",
    );
    expect(content).not.toHaveBeenCalled();
    expect(handles.live.size).toBe(0);
  });
  it.each(["mtimeNs", "ctimeNs", "uid", "gid", "mode"])(
    "holds %s drift after reading and closes the real descriptor",
    (field) => {
      const handles = track(),
        originalRead = fs.readSync;
      let changed = false;
      stats(handles, (stat, source, options) => {
        if (options?.bigint && field.endsWith("Ns"))
          stat[field] = (1n << 60n) + 1n;
        if (options?.bigint && source === "fd" && changed)
          stat[field] += field === "mode" ? 0o100n : 1n;
        return stat;
      });
      vi.spyOn(fs, "readSync").mockImplementation((fd, ...args) => {
        const count = originalRead(fd, ...args);
        if (handles.live.has(fd)) changed = true;
        return count;
      });
      held(
        () => read(target, bytes.length, 1024),
        "artifact descriptor changed during bounded read",
      );
      expect(changed).toBe(true);
      expect(handles.live.size).toBe(0);
      expect(handles.closed).toHaveLength(1);
    },
  );
  it.each(["uid", "gid"])(
    "rejects only %s differing between path and opened fd",
    (field) => {
      const handles = track(),
        content = vi.spyOn(fs, "readSync");
      stats(handles, (stat, source, options) => {
        if (source === "fd" && options?.bigint) stat[field] += 1n;
        return stat;
      });
      held(
        () => read(target, bytes.length, 1024),
        "artifact path and descriptor identities differ",
      );
      expect(content).not.toHaveBeenCalled();
      expect(handles.live.size).toBe(0);
    },
  );
  it("rejects a real open-window file replacement before returning any bytes", () => {
    const originalOpen = fs.openSync;
    let fired = false;
    vi.spyOn(fs, "openSync").mockImplementation((name, ...args) => {
      if (!fired && name === target) {
        fired = true;
        const saved = path.join(root, "saved-bytes");
        fs.renameSync(target, saved);
        fs.copyFileSync(saved, target);
      }
      return originalOpen(name, ...args);
    });
    held(
      () => read(target, bytes.length, 1024),
      "artifact path and descriptor identities differ",
    );
    expect(fired).toBe(true);
  });
  it("rejects a real final-path replacement after sampled final fd stat and closes it", () => {
    const handles = track(),
      originalRead = fs.readSync,
      originalFstat = fs.fstatSync;
    let readComplete = false,
      fired = false;
    vi.spyOn(fs, "readSync").mockImplementation((fd, ...args) => {
      const count = originalRead(fd, ...args);
      if (handles.live.has(fd)) readComplete = true;
      return count;
    });
    vi.spyOn(fs, "fstatSync").mockImplementation((fd, ...args) => {
      const stat = originalFstat(fd, ...args);
      if (!fired && readComplete && handles.live.has(fd)) {
        fired = true;
        const saved = path.join(root, "saved-bytes");
        fs.renameSync(target, saved);
        fs.copyFileSync(saved, target);
      }
      return stat;
    });
    held(
      () => read(target, bytes.length, 1024),
      "artifact pathname changed during bounded read",
    );
    expect(fired).toBe(true);
    expect(handles.live.size).toBe(0);
  });
  it("rejects a real hard link before opening the artifact", () => {
    fs.linkSync(target, path.join(root, "hard-linked-bytes"));
    const content = vi.spyOn(fs, "readSync");
    held(
      () => read(target, bytes.length, 1024),
      "artifact path must be a regular, non-symlink, single-link file",
    );
    expect(content).not.toHaveBeenCalled();
  });
  it("rejects a real directory junction/symlink alias before opening the file", () => {
    const alias = path.join(root, "alias");
    fs.symlinkSync(
      root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    held(
      () => read(path.join(alias, "bytes.json"), bytes.length, 1024),
      "artifact path is not physically canonical",
    );
  });
  it.each([(bytes) => bytes.length - 1, (bytes) => bytes.length + 1])(
    "rejects mismatched expected size before allocating",
    (size) => {
      const allocate = vi.spyOn(Buffer, "allocUnsafe"),
        content = vi.spyOn(fs, "readSync");
      held(
        () => read(target, size(bytes), 1024),
        "artifact path differs from its bounded expected size",
      );
      expect(allocate).not.toHaveBeenCalled();
      expect(content).not.toHaveBeenCalled();
    },
  );
  it("handles partial reads and caps every read at 64 KiB with exactly one EOF probe", () => {
    bytes = Buffer.alloc(150000, 0x61);
    fs.writeFileSync(target, bytes);
    const handles = track(),
      originalRead = fs.readSync,
      requests = [];
    let actual = 0;
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        const count = originalRead(
          fd,
          buffer,
          offset,
          Math.min(length, 10000),
          position,
        );
        if (handles.live.has(fd)) {
          requests.push({ length, position });
          actual += count;
        }
        return count;
      },
    );
    const whole = vi.spyOn(fs, "readFileSync");
    expect(read(target, bytes.length, 200000)).toEqual(bytes);
    expect(requests.every((request) => request.length <= 65536)).toBe(true);
    expect(
      requests.filter((request) => request.position === bytes.length),
    ).toEqual([{ length: 1, position: bytes.length }]);
    expect(actual).toBe(bytes.length);
    expect(whole).not.toHaveBeenCalled();
    expect(handles.live.size).toBe(0);
  });
  it("rejects actual growth at EOF after probing just one additional byte", () => {
    const handles = track(),
      originalRead = fs.readSync;
    let extra = 0;
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        if (handles.live.has(fd) && position === bytes.length)
          fs.appendFileSync(target, Buffer.alloc(2 * 1024 * 1024));
        const count = originalRead(fd, buffer, offset, length, position);
        if (position === bytes.length) extra += count;
        return count;
      },
    );
    held(
      () => read(target, bytes.length, 1024),
      "artifact bounded descriptor read failed",
      "file grew during bounded read",
    );
    expect(extra).toBe(1);
    expect(handles.live.size).toBe(0);
  });
  it("rejects actual truncation while reading and closes the descriptor", () => {
    const handles = track(),
      originalRead = fs.readSync;
    let fired = false;
    vi.spyOn(fs, "readSync").mockImplementation((fd, ...args) => {
      if (!fired && handles.live.has(fd)) {
        fired = true;
        fs.truncateSync(target, 0);
      }
      return originalRead(fd, ...args);
    });
    held(
      () => read(target, bytes.length, 1024),
      "artifact bounded descriptor read failed",
      "file changed or ended during bounded read",
    );
    expect(handles.live.size).toBe(0);
  });
  it("closes the descriptor when the actual read API throws", () => {
    const handles = track();
    vi.spyOn(fs, "readSync").mockImplementation(() => {
      throw new Error("injected I/O failure");
    });
    held(
      () => read(target, bytes.length, 1024),
      "artifact bounded descriptor read failed",
      "injected I/O failure",
    );
    expect(handles.closed).toHaveLength(1);
    expect(handles.live.size).toBe(0);
  });
});

describe("ArtifactStore explicit bounded integrity mode", () => {
  it("keeps legacy verification for deliverables larger than the evolution 1 MiB bound", () => {
    const store = new ArtifactStore({ dir: path.join(root, "store") });
    const entry = store.publishData({
      data: Buffer.alloc(2 * 1024 * 1024, 0x61),
      fileName: "large.txt",
    });
    expect(store.verifyIntegrity(entry)).toMatchObject({
      ok: true,
      reason: "ok",
    });
    expect(() =>
      store.verifyIntegrity(entry, {
        expectedSize: entry.size,
        maximumBytes: 1024 * 1024,
      }),
    ).toThrow(TypeError);
  });
  it("verifies exact bytes with valid explicit bounds and holds a changed size", () => {
    const store = new ArtifactStore({ dir: path.join(root, "store") });
    const entry = store.publishData({ data: bytes, fileName: "bytes.json" });
    expect(
      store.verifyIntegrity(entry, {
        expectedSize: bytes.length,
        maximumBytes: 1024,
      }),
    ).toMatchObject({ ok: true, reason: "ok" });
    fs.appendFileSync(store.storedPath(entry), "x");
    expect(
      store.verifyIntegrity(entry, {
        expectedSize: bytes.length,
        maximumBytes: 1024,
      }),
    ).toMatchObject({ ok: false, reason: "artifact-bytes-unavailable" });
  });
  it("rejects malformed or callable bounds before id lookup without raw-read fallback or getter invocation", () => {
    const store = new ArtifactStore({ dir: path.join(root, "store") }),
      touched = vi.fn(),
      lookup = vi.spyOn(store, "get"),
      whole = vi.spyOn(fs, "readFileSync");
    const callable = () => null;
    delete callable.name;
    delete callable.length;
    Object.setPrototypeOf(callable, Object.prototype);
    Object.assign(callable, { expectedSize: 1, maximumBytes: 1024 });
    const getter = { maximumBytes: 1024 };
    Object.defineProperty(getter, "expectedSize", {
      enumerable: true,
      get: touched,
    });
    for (const bounds of [
      undefined,
      null,
      {},
      { expectedSize: 1 },
      { expectedSize: 1, maximumBytes: 1024, extra: true },
      { expectedSize: -1, maximumBytes: 1024 },
      { expectedSize: 1, maximumBytes: MAX_ARTIFACT_BYTES + 1 },
      { expectedSize: 1, maximumBytes: 0 },
      { expectedSize: 1025, maximumBytes: 1024 },
      callable,
      getter,
      new Proxy({ expectedSize: 1, maximumBytes: 1024 }, { get: touched }),
    ])
      expect(() => store.verifyIntegrity("unknown-id", bounds)).toThrow(
        TypeError,
      );
    expect(() =>
      store.verifyIntegrity(
        "unknown-id",
        { expectedSize: 1, maximumBytes: 1024 },
        touched,
      ),
    ).toThrow(TypeError);
    expect(touched).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(whole).not.toHaveBeenCalled();
  });
});
