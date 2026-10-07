import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureEvolutionArtifactStoreDirectoryBoundary,
  captureEvolutionLedgerBatchResolver,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE as INTEGRITY,
  EVOLUTION_ARTIFACT_MAX_INDEX_BYTES as MAXIMUM,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { openArtifactDirectoryPorts } from "../fixtures/rrsi-artifact-directory.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root, directory, index;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-artifact-index-"));
  directory = path.join(root, "artifacts");
  index = path.join(directory, "index.jsonl");
});
afterEach(() => {
  vi.restoreAllMocks();
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-artifact-index-")
  )
    throw new Error("unsafe artifact index cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});
function safe(...targets) {
  for (const target of targets) {
    const relative = path.relative(root, path.resolve(target));
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error("unsafe artifact index mutation");
  }
}
function open() {
  const result = openArtifactDirectoryPorts(directory);
  const resolver = result.ports.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  return {
    ...result,
    resolver,
    batch: captureEvolutionLedgerBatchResolver(resolver),
  };
}
function held(operation, message, causeMessage) {
  let error;
  try {
    operation();
  } catch (cause) {
    error = cause;
  }
  expect(error).toMatchObject({
    code: INTEGRITY,
    ...(message ? { message } : {}),
  });
  if (causeMessage) expect(error.cause?.message).toBe(causeMessage);
}
// Track real descriptors, so every failure can check the actual open was closed.
function track() {
  const originalOpen = fs.openSync,
    originalClose = fs.closeSync;
  const live = new Set(),
    opened = [],
    closed = [];
  vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
    const fd = originalOpen(target, ...args);
    if (target === index) {
      live.add(fd);
      opened.push({ fd, flags: args[0] });
    }
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    if (live.delete(fd)) closed.push(fd);
    return originalClose(fd);
  });
  return { live, opened, closed };
}
function indexStats(handles, transform) {
  const originalPath = fs.lstatSync,
    originalFd = fs.fstatSync;
  vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
    const stat = originalPath(target, options);
    return target === index ? transform(stat, "path", options) : stat;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
    const stat = originalFd(fd, options);
    return handles.live.has(fd) ? transform(stat, "fd", options) : stat;
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

describe("original ArtifactPorts index snapshot precision and read bounds", () => {
  it("reads an empty index and genuine appended artifacts without freezing mutable index bytes", () => {
    const current = open(),
      inode = fs.lstatSync(index, { bigint: true }).ino;
    expect(current.batch([])).toEqual([]);
    const publication = current.ports.putCanonical(
      "evolution-ledger-v2-journal",
      { value: "actual signed bytes" },
      {
        purpose: "evolution-ledger",
        retention: "ledger",
      },
    );
    expect(fs.lstatSync(index, { bigint: true }).ino).toBe(inode);
    expect(
      current.batch([
        {
          tenantId: "directory-artifacts",
          ledgerId: "index-ledger",
          epoch: "index-epoch",
          ref: publication.ref,
        },
      ])[0],
    ).toMatchObject({
      authenticated: true,
      found: true,
      digest: publication.digest,
    });
    const bytes = fs.readFileSync(index);
    fs.writeFileSync(index, bytes);
    expect(fs.lstatSync(index, { bigint: true }).ino).toBe(inode);
    expect(current.batch([])).toEqual([]);
  });
  it("holds an actual same-byte index inode replacement while the directory-only boundary stays in scope", () => {
    const current = open(),
      boundary = captureEvolutionArtifactStoreDirectoryBoundary(current.ports);
    const saved = path.join(root, "saved-index"),
      bytes = fs.readFileSync(index),
      inode = fs.lstatSync(index, { bigint: true }).ino;
    safe(index, saved);
    fs.renameSync(index, saved);
    fs.writeFileSync(index, bytes);
    expect(fs.lstatSync(index, { bigint: true }).ino).not.toBe(inode);
    expect(boundary.recheck()).toMatchObject({
      indexFileIdentityVerified: false,
      indexContentsVerified: false,
    });
    held(
      () => current.batch([]),
      "ArtifactStore index physical identity changed",
    );
    expect(open().batch([])).toEqual([]);
  });
  it.each(["path", "fd"])(
    "rejects Number fields during constructor %s capture and closes every opened index fd",
    (api) => {
      const handles = track();
      indexStats(handles, (stat, source, options) => {
        if (source === api && options?.bigint) stat.ino = Number(stat.ino);
        return stat;
      });
      held(
        () => open(),
        `ArtifactStore index${api === "fd" ? " descriptor" : ""} requires full-precision index stat fields`,
      );
      expect(handles.live.size).toBe(0);
      expect(handles.closed.length).toBe(handles.opened.length);
    },
  );
  it.each(["path", "fd"].flatMap((api) => fields.map((field) => [api, field])))(
    "rejects a Number fallback in snapshot %s %s before reading",
    (api, field) => {
      const current = open(),
        handles = track(),
        read = vi.spyOn(fs, "readSync");
      indexStats(handles, (stat, source, options) => {
        if (source === api && options?.bigint)
          stat[field] = Number(stat[field]);
        return stat;
      });
      held(
        () => current.batch([]),
        `ArtifactStore index${api === "fd" ? " descriptor" : ""} requires full-precision index stat fields`,
      );
      expect(read).not.toHaveBeenCalled();
      expect(handles.live.size).toBe(0);
    },
  );
  it("retains a full index inode and rejects a different ID with the same Number projection", () => {
    const handles = track(),
      first = (1n << 60n) + 1n;
    let inode = first;
    indexStats(handles, (stat, _source, options) => {
      if (options?.bigint) stat.ino = inode;
      return stat;
    });
    const current = open();
    expect(current.batch([])).toEqual([]);
    expect(Number(first)).toBe(Number(first + 1n));
    inode += 1n;
    held(
      () => current.batch([]),
      "ArtifactStore index physical identity changed",
    );
    expect(handles.live.size).toBe(0);
  });
  it("rejects different path and fd full inodes even when their Number projections agree", () => {
    const current = open(),
      handles = track(),
      read = vi.spyOn(fs, "readSync");
    indexStats(handles, (stat, source, options) => {
      if (options?.bigint)
        stat.ino = (1n << 60n) + (source === "path" ? 1n : 2n);
      return stat;
    });
    // A fresh ports capture exercises the path/fd comparison, before any bytes.
    held(
      () => open(),
      "ArtifactStore index pathname and descriptor identities differ",
    );
    expect(read).not.toHaveBeenCalled();
    expect(handles.live.size).toBe(0);
    expect(current.ports).toBeDefined();
  });
  it.each(["mtimeNs", "ctimeNs", "uid", "gid", "mode"])(
    "holds %s drift on the opened descriptor and closes it",
    (field) => {
      const current = open(),
        handles = track(),
        originalRead = fs.readSync;
      let read = false;
      indexStats(handles, (stat, source, options) => {
        if (options?.bigint && field.endsWith("Ns"))
          stat[field] = (1n << 60n) + 1n;
        if (source === "fd" && options?.bigint && read) {
          if (field.endsWith("Ns"))
            expect(Number(stat[field])).toBe(Number(stat[field] + 1n));
          stat[field] += field === "mode" ? 0o100n : 1n;
        }
        return stat;
      });
      vi.spyOn(fs, "readSync").mockImplementation((fd, ...args) => {
        const count = originalRead(fd, ...args);
        if (handles.live.has(fd)) read = true;
        return count;
      });
      held(
        () => current.batch([]),
        "ArtifactStore index changed while its descriptor was read",
      );
      expect(read).toBe(true);
      expect(handles.live.size).toBe(0);
      expect(handles.closed.length).toBe(handles.opened.length);
    },
  );
  it("rejects actual same-inode growth between path stat and fd stat before reading", () => {
    const current = open(),
      originalOpen = fs.openSync,
      inode = fs.lstatSync(index, { bigint: true }).ino;
    const read = vi.spyOn(fs, "readSync");
    let fired = false;
    vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
      if (!fired && target === index) {
        fired = true;
        fs.appendFileSync(index, '{"id":"new-row"}\n');
      }
      return originalOpen(target, ...args);
    });
    held(
      () => current.batch([]),
      "ArtifactStore index descriptor is replaced or oversized",
    );
    expect(fired).toBe(true);
    expect(fs.lstatSync(index, { bigint: true }).ino).toBe(inode);
    expect(read).not.toHaveBeenCalled();
  });
  it("holds a real pathname copy replacement after final descriptor stat and closes the original descriptor", () => {
    const current = open(),
      handles = track(),
      originalRead = fs.readSync,
      originalFstat = fs.fstatSync;
    let fired = false,
      readComplete = false;
    vi.spyOn(fs, "readSync").mockImplementation((fd, ...args) => {
      const count = originalRead(fd, ...args);
      if (handles.live.has(fd)) readComplete = true;
      return count;
    });
    vi.spyOn(fs, "fstatSync").mockImplementation((fd, ...args) => {
      const stat = originalFstat(fd, ...args);
      if (!fired && readComplete && handles.live.has(fd)) {
        fired = true;
        const saved = path.join(root, "saved-index");
        safe(index, saved);
        fs.renameSync(index, saved);
        fs.copyFileSync(saved, index);
      }
      return stat;
    });
    held(
      () => current.batch([]),
      "ArtifactStore index pathname changed during descriptor read",
    );
    expect(fired).toBe(true);
    expect(handles.live.size).toBe(0);
  });
  it.each([-1n, BigInt(MAXIMUM) + 1n])(
    "rejects declared size %s before buffer allocation or read",
    (size) => {
      const current = open(),
        handles = track(),
        allocate = vi.spyOn(Buffer, "allocUnsafe"),
        read = vi.spyOn(fs, "readSync");
      indexStats(handles, (stat, _source, options) => {
        if (options?.bigint) stat.size = size;
        return stat;
      });
      held(
        () => current.batch([]),
        "ArtifactStore index exceeds its bounded snapshot size",
      );
      expect(allocate).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(handles.live.size).toBe(0);
    },
  );
  it("rejects a real oversized index before opening it or allocating its contents", () => {
    const current = open(),
      fd = fs.openSync(index, "r+");
    try {
      fs.ftruncateSync(fd, MAXIMUM + 1);
    } finally {
      fs.closeSync(fd);
    }
    const handles = track(),
      read = vi.spyOn(fs, "readSync"),
      allocate = vi.spyOn(Buffer, "allocUnsafe");
    held(
      () => current.batch([]),
      "ArtifactStore index exceeds its bounded snapshot size",
    );
    expect(handles.opened).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
  });
  it("reads partial chunks to the checked length using descriptor reads and one EOF probe", () => {
    const current = open();
    const bytes = Buffer.from('{"id":"short-read-row"}\n');
    fs.writeFileSync(index, bytes);
    const handles = track(),
      originalRead = fs.readSync,
      requests = [];
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        if (handles.live.has(fd)) {
          requests.push({ length, position });
          return originalRead(
            fd,
            buffer,
            offset,
            Math.min(length, 3),
            position,
          );
        }
        return originalRead(fd, buffer, offset, length, position);
      },
    );
    const whole = vi.spyOn(fs, "readFileSync");
    expect(current.batch([])).toEqual([]);
    expect(whole).not.toHaveBeenCalled();
    expect(
      requests.filter((request) => request.position === bytes.length),
    ).toEqual([
      { position: bytes.length, length: 1 },
      { position: bytes.length, length: 1 },
    ]);
    expect(
      requests
        .filter((request) => request.position < bytes.length)
        .every((request) => request.position + request.length <= bytes.length),
    ).toBe(true);
    expect(handles.live.size).toBe(0);
  });
  it("caps each descriptor read at 64 KiB even for a larger admitted JSONL snapshot", () => {
    const current = open(),
      bytes = Buffer.from(
        Array.from({ length: 8 }, (_, id) =>
          JSON.stringify({ id: String(id), pad: "x".repeat(16000) }),
        ).join("\n") + "\n",
      );
    fs.writeFileSync(index, bytes);
    const handles = track(),
      originalRead = fs.readSync,
      requests = [];
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        if (handles.live.has(fd)) requests.push({ length, position });
        return originalRead(fd, buffer, offset, length, position);
      },
    );
    expect(current.batch([])).toEqual([]);
    expect(requests.every((request) => request.length <= 64 * 1024)).toBe(true);
    expect(
      requests.filter((request) => request.position === bytes.length),
    ).toHaveLength(2);
    expect(handles.live.size).toBe(0);
  });
  it("detects actual growth with exactly one extra byte instead of reading the enlarged file", () => {
    const current = open(),
      handles = track(),
      originalRead = fs.readSync,
      requests = [];
    let fired = false;
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        if (handles.live.has(fd)) {
          requests.push({ length, position });
          if (!fired) {
            fired = true;
            fs.appendFileSync(index, Buffer.alloc(2 * 1024 * 1024, 0x78));
          }
        }
        return originalRead(fd, buffer, offset, length, position);
      },
    );
    held(
      () => current.batch([]),
      "ArtifactStore index could not be read from a trusted descriptor",
      "file grew during bounded read",
    );
    expect(requests).toEqual([{ length: 1, position: 0 }]);
    expect(handles.live.size).toBe(0);
  });
  it("holds actual truncation during a bounded read and closes the fd", () => {
    const current = open();
    fs.writeFileSync(index, '{"id":"before-truncation"}\n');
    const handles = track(),
      originalRead = fs.readSync;
    let fired = false;
    vi.spyOn(fs, "readSync").mockImplementation((fd, ...args) => {
      if (!fired && handles.live.has(fd)) {
        fired = true;
        fs.truncateSync(index, 0);
      }
      return originalRead(fd, ...args);
    });
    held(
      () => current.batch([]),
      "ArtifactStore index could not be read from a trusted descriptor",
      "file changed or ended during bounded read",
    );
    expect(fired).toBe(true);
    expect(handles.live.size).toBe(0);
  });
  it("closes the actual index fd when readSync throws", () => {
    const current = open(),
      handles = track();
    vi.spyOn(fs, "readSync").mockImplementation(() => {
      throw new Error("injected descriptor I/O failure");
    });
    held(
      () => current.batch([]),
      "ArtifactStore index could not be read from a trusted descriptor",
      "injected descriptor I/O failure",
    );
    expect(handles.opened).toHaveLength(1);
    expect(handles.closed).toEqual(handles.opened.map((entry) => entry.fd));
    expect(handles.live.size).toBe(0);
  });
  it.each(["uid", "gid"])(
    "rejects only %s changing between path and opened fd before any bytes are read",
    (field) => {
      const current = open(),
        handles = track(),
        read = vi.spyOn(fs, "readSync");
      indexStats(handles, (stat, source, options) => {
        if (source === "fd" && options?.bigint) stat[field] += 1n;
        return stat;
      });
      held(
        () => current.batch([]),
        "ArtifactStore index descriptor is replaced or oversized",
      );
      expect(read).not.toHaveBeenCalled();
      expect(handles.opened).toHaveLength(1);
      expect(handles.live.size).toBe(0);
    },
  );
  it("holds an actual constructor pathname replacement after its first fd stat and closes all index fds", () => {
    const handles = track();
    let fired = false;
    indexStats(handles, (stat, source, options) => {
      if (!fired && source === "fd" && options?.bigint) {
        fired = true;
        const saved = path.join(root, "saved-index");
        safe(index, saved);
        fs.renameSync(index, saved);
        fs.copyFileSync(saved, index);
      }
      return stat;
    });
    held(
      () => open(),
      "ArtifactStore index changed while its identity was captured",
    );
    expect(fired).toBe(true);
    expect(handles.live.size).toBe(0);
    expect(handles.closed.length).toBe(handles.opened.length);
  });
  it.each([-1n, BigInt(MAXIMUM) + 1n])(
    "rejects opened descriptor size %s before allocation/read and closes it",
    (size) => {
      const current = open(),
        handles = track(),
        allocate = vi.spyOn(Buffer, "allocUnsafe"),
        read = vi.spyOn(fs, "readSync");
      indexStats(handles, (stat, source, options) => {
        if (source === "fd" && options?.bigint) stat.size = size;
        return stat;
      });
      held(
        () => current.batch([]),
        "ArtifactStore index descriptor exceeds its bounded snapshot size",
      );
      expect(allocate).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(handles.opened).toHaveLength(1);
      expect(handles.live.size).toBe(0);
    },
  );
});
