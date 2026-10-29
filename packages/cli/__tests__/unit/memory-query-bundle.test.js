import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { isAffectedWindowsZeroDeviceStatRuntime } from "../../src/lib/secure-file-identity.js";
import {
  createQueryBundlePlan,
  readQueryBundle,
  writeQueryBundle,
} from "../../src/lib/context-memory-kernel/memory-query-bundle.js";

const parent = fs.realpathSync.native(os.tmpdir());
const roots = [];
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const limits = { maxFrameBytes: 1024 * 1024, maxBundleBytes: 4 * 1024 * 1024 };

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== parent ||
      !path.basename(root).startsWith("cc-query-bundle-")
    )
      throw new Error("unsafe query bundle fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture({ large = false } = {}) {
  const root = fs.mkdtempSync(path.join(parent, "cc-query-bundle-"));
  roots.push(root);
  const frames = new Map([
    [
      "01",
      large ? Buffer.alloc(150_000, 0x61) : Buffer.from("first verified index"),
    ],
    ["f0", Buffer.from("last index, possibly not selected by the query")],
  ]);
  const manifest = {
    digest: hash("current generation"),
    shards: Object.fromEntries(
      [...frames]
        .reverse()
        .map(([bucket, bytes]) => [
          bucket,
          { queryBytes: bytes.length, queryDigest: hash(bytes) },
        ]),
    ),
  };
  const plan = createQueryBundlePlan(manifest, limits);
  const file = path.join(root, plan.name);
  const bytes = Buffer.concat([
    plan.header,
    ...plan.frames.map(({ bucket }) => frames.get(bucket)),
  ]);
  const checkDirectories = vi.fn(() => {});
  return {
    root,
    frames,
    manifest,
    plan,
    file,
    bytes,
    checkDirectories,
    getFrame: async (bucket) => frames.get(bucket),
  };
}

function trackOpenedDescriptors() {
  const opened = [];
  const original = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation((...args) => {
    const fd = original(...args);
    if (typeof args[1] === "number") opened.push(fd);
    return fd;
  });
  syncBuiltinESMExports();
  return opened;
}

function expectClosed(fd) {
  expect(() => fs.fstatSync(fd)).toThrow(
    expect.objectContaining({ code: "EBADF" }),
  );
}

function expectClosedDataDescriptors(opened, count) {
  // Affected Windows hosts also open short-lived parent/volume/file handles
  // to bind the legacy path-stat projection. All handles must be released.
  if (isAffectedWindowsZeroDeviceStatRuntime())
    expect(opened.length).toBeGreaterThanOrEqual(count);
  else expect(opened).toHaveLength(count);
  for (const fd of opened) expectClosed(fd);
}

describe("manifest-bound query bundle plans", () => {
  it("uses stable sorted frames and the old collector's owned filename shape", () => {
    const f = fixture();
    expect(f.plan.name).toMatch(/^query-[a-f0-9]{2}-[a-f0-9]{64}\.json$/u);
    expect(f.plan.frames.map((frame) => frame.bucket)).toEqual(["01", "f0"]);
    expect(f.plan.manifestDigest).toBe(f.manifest.digest);
    expect(f.plan.byteLength).toBe(f.bytes.length);
    const reordered = {
      ...f.manifest,
      shards: Object.fromEntries(Object.entries(f.manifest.shards).reverse()),
    };
    expect(createQueryBundlePlan(reordered, limits)).toEqual(f.plan);
    expect(
      createQueryBundlePlan(
        { ...f.manifest, digest: hash("next generation") },
        limits,
      ).name,
    ).not.toBe(f.plan.name);
  });

  it("falls back when descriptors or capacity cannot support a complete bundle", () => {
    const f = fixture();
    for (const manifest of [
      {},
      { ...f.manifest, shards: {} },
      { ...f.manifest, shards: { "01": { queryBytes: 10 } } },
      { ...f.manifest, shards: { unknown: f.manifest.shards["01"] } },
    ])
      expect(createQueryBundlePlan(manifest, limits)).toBeNull();
    expect(
      createQueryBundlePlan(f.manifest, {
        ...limits,
        maxBundleBytes: f.plan.byteLength - 1,
      }),
    ).toBeNull();
    expect(
      createQueryBundlePlan(f.manifest, {
        ...limits,
        maxBundleBytes: f.plan.byteLength,
      }),
    ).not.toBeNull();
    expect(
      createQueryBundlePlan(f.manifest, { ...limits, maxFrameBytes: 1 }),
    ).toBeNull();
    expect(
      createQueryBundlePlan(f.manifest, {
        ...limits,
        maxBundleBytes: Infinity,
      }),
    ).toBeNull();
  });

  it("does not use a bundle name that collides with any current real index", () => {
    const f = fixture();
    const key = f.plan.name.slice("query-00-".length, -".json".length);
    const collision = {
      ...f.manifest,
      shards: {
        ...f.manifest.shards,
        "00": { queryBytes: 10, queryDigest: `sha256:${key}` },
      },
    };
    expect(createQueryBundlePlan(collision, limits)).toBeNull();
  });
});

describe("bounded query bundle reads", () => {
  it("reads a fresh file on every call, using one closed fd and blocks no larger than 64 KiB", async () => {
    const f = fixture({ large: true });
    fs.writeFileSync(f.file, f.bytes);
    const opened = trackOpenedDescriptors();
    const original = fs.readSync;
    const sizes = [];
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, bytes, offset, length, position) => {
        sizes.push(length);
        return original(fd, bytes, offset, length, position);
      },
    );
    syncBuiltinESMExports();
    const received = new Map();
    const checkpoint = vi.fn(async () => {});
    await readQueryBundle(f.file, f.plan, {
      checkpoint,
      onFrame: async (bucket, bytes) => received.set(bucket, bytes),
    });
    expect(received).toEqual(f.frames);
    expectClosedDataDescriptors(opened, 1);
    expect(sizes.every((size) => size <= 64 * 1024)).toBe(true);
    expect(checkpoint.mock.calls.length).toBeGreaterThan(4);
    const changed = Buffer.from(f.bytes);
    changed[changed.length - 1] ^= 1;
    fs.writeFileSync(f.file, changed);
    await expect(readQueryBundle(f.file, f.plan)).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_QUERY_BUNDLE_CORRUPT",
    });
    expectClosedDataDescriptors(opened, 2);
  });

  it("can reuse borrowed storage after an asynchronous frame consumer settles", async () => {
    const f = fixture({ large: true });
    fs.writeFileSync(f.file, f.bytes);
    const decoded = new Map();
    const views = [];
    await readQueryBundle(f.file, f.plan, {
      reuseFrameBuffer: true,
      onFrame: async (bucket, bytes) => {
        // The next frame cannot overwrite storage while decoding is pending.
        await new Promise((resolve) => setImmediate(resolve));
        expect(bytes).toEqual(f.frames.get(bucket));
        decoded.set(bucket, Buffer.from(bytes));
        views.push(bytes);
      },
    });
    expect(decoded).toEqual(f.frames);
    expect(views[0].buffer).toBe(views[1].buffer);
    expect(views[0].byteOffset).toBe(views[1].byteOffset);
    // The default consumer in the preceding test retains original frame
    // bytes; opting in here deliberately limits their lifetime to onFrame.
    expect(views[0].subarray(0, views[1].length)).toEqual(views[1]);
  });

  it.each([false, true])(
    "rejects corruption in an unselected final frame after an earlier verified frame (reuse=%s)",
    async (reuseFrameBuffer) => {
      const f = fixture();
      f.bytes[f.bytes.length - 1] ^= 1;
      fs.writeFileSync(f.file, f.bytes);
      const seen = [];
      await expect(
        readQueryBundle(f.file, f.plan, {
          reuseFrameBuffer,
          onFrame: (bucket) => seen.push(bucket),
        }),
      ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_QUERY_BUNDLE_CORRUPT" });
      expect(seen).toEqual(["01"]);
    },
  );

  it.each([
    "old-generation",
    "unknown-bucket",
    "duplicate-bucket",
    "extra-header-field",
    "truncated",
    "trailing",
  ])("rejects %s bytes instead of trusting file metadata", async (kind) => {
    const f = fixture();
    let bytes = f.bytes;
    if (kind === "old-generation") {
      const old = createQueryBundlePlan(
        { ...f.manifest, digest: hash("older generation") },
        limits,
      );
      bytes = Buffer.concat([
        old.header,
        f.bytes.subarray(f.plan.header.length),
      ]);
    } else if (kind === "unknown-bucket" || kind === "duplicate-bucket") {
      const replacement = kind === "unknown-bucket" ? "fe" : "01";
      const header = Buffer.from(
        f.plan.header
          .toString()
          .replace('"bucket":"f0"', `"bucket":"${replacement}"`),
      );
      bytes = Buffer.concat([header, f.bytes.subarray(f.plan.header.length)]);
    } else if (kind === "extra-header-field") {
      const header = Buffer.from(
        f.plan.header.toString().replace('"frames":', '"x":0,"frames":'),
      );
      // Preserve total file size so exact header comparison, not only size,
      // rejects the additional untrusted metadata.
      bytes = Buffer.concat([
        header,
        f.bytes.subarray(f.plan.header.length),
      ]).subarray(0, f.bytes.length);
    } else if (kind === "truncated")
      bytes = bytes.subarray(0, bytes.length - 1);
    else bytes = Buffer.concat([bytes, Buffer.from("extra")]);
    fs.writeFileSync(f.file, bytes);
    const onFrame = vi.fn();
    await expect(
      readQueryBundle(f.file, f.plan, { onFrame }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_QUERY_BUNDLE_CORRUPT" });
    expect(onFrame).not.toHaveBeenCalled();
  });

  it.each(["hardlink", "directory", "symlink"])(
    "rejects an unsafe %s as a store error, not repairable bundle corruption",
    async (kind) => {
      const f = fixture();
      if (kind === "hardlink") {
        fs.writeFileSync(f.file, f.bytes);
        fs.linkSync(f.file, path.join(f.root, "second-name"));
      } else if (kind === "directory") fs.mkdirSync(f.file);
      else {
        const target = path.join(f.root, "target");
        fs.mkdirSync(target);
        fs.symlinkSync(
          target,
          f.file,
          process.platform === "win32" ? "junction" : "dir",
        );
      }
      await expect(readQueryBundle(f.file, f.plan)).rejects.toMatchObject({
        code: "CONTEXT_MEMORY_STORE_CORRUPT",
      });
    },
  );

  it("detects a real file replacement between lstat and open and closes the new fd", async () => {
    const f = fixture();
    fs.writeFileSync(f.file, f.bytes);
    const original = fs.openSync;
    let opened;
    vi.spyOn(fs, "openSync").mockImplementation((file, ...args) => {
      if (file === f.file && typeof args[0] === "number") {
        fs.renameSync(file, `${file}.displaced`);
        fs.writeFileSync(file, f.bytes);
      }
      const fd = original(file, ...args);
      if (typeof args[0] === "number") opened = fd;
      return fd;
    });
    syncBuiltinESMExports();
    await expect(readQueryBundle(f.file, f.plan)).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
    expectClosed(opened);
  });

  it("rejects metadata changes after frames were hashed and closes on callback failure", async () => {
    const f = fixture();
    fs.writeFileSync(f.file, f.bytes);
    const opened = trackOpenedDescriptors();
    await expect(
      readQueryBundle(f.file, f.plan, {
        onFrame: () => {
          fs.utimesSync(f.file, new Date(), new Date(Date.now() + 5000));
        },
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_QUERY_BUNDLE_CORRUPT" });
    expectClosed(opened[0]);
    await expect(
      readQueryBundle(f.file, f.plan, {
        onFrame: () => {
          throw new Error("consumer failed");
        },
      }),
    ).rejects.toThrow("consumer failed");
    expectClosed(opened[1]);
  });

  it("honors cancellation between chunks and releases the descriptor", async () => {
    const f = fixture({ large: true });
    fs.writeFileSync(f.file, f.bytes);
    const opened = trackOpenedDescriptors();
    const controller = new AbortController();
    let checks = 0;
    const onFrame = vi.fn();
    await expect(
      readQueryBundle(f.file, f.plan, {
        onFrame,
        checkpoint: async () => {
          if (++checks === 3) controller.abort();
          controller.signal.throwIfAborted();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onFrame).not.toHaveBeenCalled();
    expectClosed(opened[0]);
  });

  it.each(["grow", "truncate"])(
    "rejects a file that changes size during a %s read",
    async (change) => {
      const f = fixture({ large: true });
      fs.writeFileSync(f.file, f.bytes);
      const opened = trackOpenedDescriptors();
      let checks = 0;
      await expect(
        readQueryBundle(f.file, f.plan, {
          checkpoint: () => {
            if (++checks === 2 && change === "truncate")
              fs.truncateSync(f.file, f.plan.header.length + 1);
          },
          onFrame: (bucket) => {
            if (bucket === "f0" && change === "grow")
              fs.appendFileSync(f.file, "unexpected tail");
          },
        }),
      ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_QUERY_BUNDLE_CORRUPT" });
      expectClosed(opened[0]);
    },
  );
});

describe("atomic query bundle writes", () => {
  it("publishes a complete round trip and leaves no temporary files", async () => {
    const f = fixture({ large: true });
    const checkpoint = vi.fn(async () => {});
    await writeQueryBundle(f.file, f.plan, {
      checkpoint,
      getFrame: f.getFrame,
      checkDirectories: f.checkDirectories,
    });
    expect(fs.readFileSync(f.file)).toEqual(f.bytes);
    const received = new Map();
    await readQueryBundle(f.file, f.plan, {
      onFrame: (bucket, bytes) => received.set(bucket, bytes),
    });
    expect(received).toEqual(f.frames);
    expect(fs.readdirSync(f.root)).toEqual([f.plan.name]);
    expect(checkpoint.mock.calls.length).toBeGreaterThan(4);
  });

  it.each(["cancel", "io-error", "bad-frame"])(
    "preserves the old target on %s, closes the fd and removes only its temporary file",
    async (failure) => {
      const f = fixture({ large: true });
      const old = Buffer.from("old authoritative derived representation");
      fs.writeFileSync(f.file, old);
      const opened = trackOpenedDescriptors();
      let checks = 0;
      const controller = new AbortController();
      if (failure === "io-error") {
        const write = fs.writeSync;
        let writes = 0;
        vi.spyOn(fs, "writeSync").mockImplementation((...args) => {
          if (++writes === 2)
            throw Object.assign(new Error("injected write failure"), {
              code: "EIO",
            });
          return write(...args);
        });
        syncBuiltinESMExports();
      }
      await expect(
        writeQueryBundle(f.file, f.plan, {
          checkDirectories: f.checkDirectories,
          getFrame:
            failure === "bad-frame"
              ? async () => Buffer.from("wrong")
              : f.getFrame,
          checkpoint: async () => {
            if (failure === "cancel" && ++checks === 3) controller.abort();
            controller.signal.throwIfAborted();
          },
        }),
      ).rejects.toBeDefined();
      expect(fs.readFileSync(f.file)).toEqual(old);
      expect(fs.readdirSync(f.root)).toEqual([f.plan.name]);
      expectClosedDataDescriptors(opened, 1);
    },
  );

  it("detects frame buffer mutation during a yielded write instead of publishing unchecked bytes", async () => {
    const f = fixture({ large: true });
    let changed = false;
    await expect(
      writeQueryBundle(f.file, f.plan, {
        getFrame: f.getFrame,
        checkDirectories: f.checkDirectories,
        checkpoint: () => {
          const temp = fs
            .readdirSync(f.root)
            .find((name) => name.startsWith("query-rebuild-"));
          if (
            !changed &&
            temp &&
            fs.statSync(path.join(f.root, temp)).size > f.plan.header.length
          ) {
            changed = true;
            f.frames.get("01")[100_000] ^= 1;
          }
        },
      }),
    ).rejects.toThrow(/source frame changed while writing/);
    expect(fs.readdirSync(f.root)).toEqual([]);
  });

  it("refuses to overwrite a real replacement target at publication", async () => {
    const f = fixture();
    fs.writeFileSync(f.file, "old");
    let replaced = false;
    await expect(
      writeQueryBundle(f.file, f.plan, {
        checkDirectories: f.checkDirectories,
        getFrame: async (bucket) => {
          if (!replaced) {
            replaced = true;
            fs.renameSync(f.file, `${f.file}.original`);
            fs.writeFileSync(f.file, "replacement belongs to someone else");
          }
          return f.frames.get(bucket);
        },
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_STORE_CORRUPT" });
    expect(fs.readFileSync(f.file, "utf8")).toBe(
      "replacement belongs to someone else",
    );
    expect(
      fs
        .readdirSync(f.root)
        .filter((name) => name.startsWith("query-rebuild-")),
    ).toEqual([]);
  });

  it("does not delete a replaced temporary path during failed-write cleanup", async () => {
    const f = fixture();
    let temp;
    await expect(
      writeQueryBundle(f.file, f.plan, {
        checkDirectories: f.checkDirectories,
        getFrame: async () => {
          temp = path.join(
            f.root,
            fs
              .readdirSync(f.root)
              .find((name) => name.startsWith("query-rebuild-")),
          );
          fs.renameSync(temp, `${temp}.displaced`);
          fs.writeFileSync(temp, "not the original temporary inode");
          throw new Error("stop after replacement");
        },
      }),
    ).rejects.toThrow("stop after replacement");
    expect(fs.readFileSync(temp, "utf8")).toBe(
      "not the original temporary inode",
    );
    expect(fs.existsSync(f.file)).toBe(false);
  });

  it("leaves a temporary file untouched if directory revalidation fails", async () => {
    const f = fixture();
    let checks = 0;
    await expect(
      writeQueryBundle(f.file, f.plan, {
        getFrame: async () => {
          throw new Error("source failed");
        },
        checkDirectories: () => {
          if (++checks > 1) throw new Error("directory was redirected");
        },
      }),
    ).rejects.toThrow("source failed");
    expect(fs.readdirSync(f.root)).toEqual([
      expect.stringMatching(/^query-rebuild-[a-f0-9-]{36}\.tmp$/u),
    ]);
    expect(fs.existsSync(f.file)).toBe(false);
  });

  it("rejects unsafe targets and mismatched planned filenames before allocating a temporary file", async () => {
    const f = fixture();
    fs.writeFileSync(f.file, f.bytes);
    fs.linkSync(f.file, `${f.file}.linked`);
    await expect(writeQueryBundle(f.file, f.plan, f)).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
    await expect(
      writeQueryBundle(path.join(f.root, "real-index.json"), f.plan, f),
    ).rejects.toMatchObject({ code: "CONTEXT_MEMORY_STORE_CORRUPT" });
    expect(
      fs
        .readdirSync(f.root)
        .filter((name) => name.startsWith("query-rebuild-")),
    ).toEqual([]);
  });
});
