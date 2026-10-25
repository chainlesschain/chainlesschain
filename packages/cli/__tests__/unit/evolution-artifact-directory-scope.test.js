import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EvolutionArtifactPorts,
  captureEvolutionLedgerWholeHistoryReader,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { openArtifactByteFixture } from "../fixtures/evolution-artifact-bytes.js";
import { evolutionDurableStoreConfiguration } from "../fixtures/evolution-durable-store.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-artifact-directory-scope-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  if (
    path.dirname(root) !== temp ||
    !path.basename(root).startsWith("cc-artifact-directory-scope-")
  )
    throw new Error("unsafe directory scope cleanup");
  fs.rmSync(root, { recursive: true, force: true });
});

function fixture(
  implementation = {
    EvolutionArtifactPorts,
    captureEvolutionLedgerWholeHistoryReader,
  },
) {
  const directory = path.join(root, "home", "artifacts");
  const f = openArtifactByteFixture(directory);
  const config = evolutionDurableStoreConfiguration(directory, {
    artifactTenantId: "bytes-artifacts",
    audience: "bytes-runtime",
  });
  const hooks = {
    authority: 0,
    signatures: 0,
    onAuthority: null,
    onVerify: null,
    onClock: null,
  };
  const ports = new implementation.EvolutionArtifactPorts({
    artifactStore: f.store,
    tenantId: "bytes-artifacts",
    audience: "bytes-runtime",
    ...config.artifactAuthority,
    now: () => {
      hooks.onClock?.();
      return config.clock();
    },
    envelopeVerifier: {
      verify(request) {
        hooks.signatures++;
        hooks.onVerify?.();
        return config.artifactAuthority.envelopeVerifier.verify(request);
      },
    },
    currentAuthorityResolver: {
      resolve(request) {
        hooks.authority++;
        hooks.onAuthority?.();
        return config.artifactAuthority.currentAuthorityResolver.resolve(
          request,
        );
      },
    },
  });
  const resolver = ports.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  return {
    ...f,
    directory,
    files: path.join(directory, "files"),
    hooks,
    read: implementation.captureEvolutionLedgerWholeHistoryReader(resolver),
    requests: (count) =>
      Array.from({ length: count }, () => structuredClone(f.request)),
  };
}

function expectIntegrity(operation) {
  let result;
  try {
    result = operation();
  } catch (error) {
    expect(error.code).toBe(EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE);
    return;
  }
  throw new Error(
    `unsafe history unexpectedly returned ${result?.length} results`,
  );
}

function trackDescriptors(onOpen = () => {}, onClose = () => {}) {
  const originalOpen = fs.openSync,
    originalClose = fs.closeSync;
  const live = new Map();
  vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
    const fd = originalOpen(target, ...args);
    live.set(fd, target);
    onOpen(target, fd);
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    const result = originalClose(fd);
    live.delete(fd);
    onClose(fd);
    return result;
  });
  return live;
}

function replacement(target) {
  const saved = `${target}-held-original`;
  let moved = false;
  let blocked = null;
  return {
    get moved() {
      return moved;
    },
    get blocked() {
      return blocked;
    },
    replace() {
      try {
        fs.renameSync(target, saved);
      } catch (error) {
        blocked = error.code;
        throw error;
      }
      moved = true;
      fs.cpSync(saved, target, { recursive: true });
    },
    restore() {
      if (!moved) return;
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(saved, target);
      moved = false;
    },
  };
}

describe("sealed artifact directory canonical checks", () => {
  it("keeps directory canonical checks constant while freshly reading and authenticating every item", async () => {
    let f;
    const native = fs.realpathSync.native;
    const counts = { directories: 0, leaf: 0 };
    vi.spyOn(fs.realpathSync, "native").mockImplementation(
      (target, ...args) => {
        if (target === f?.directory || target === f?.files)
          counts.directories++;
        if (target === f?.target) counts.leaf++;
        return native(target, ...args);
      },
    );
    // Observe before this module instance binds its private physicalRealpath.
    // Its constructor/capture pair owns its own branded capability throughout.
    const implementation = await import(
      "../../src/lib/evolution/evolution-artifact-ports.js?directory-scope-counter"
    );
    f = fixture(implementation);
    counts.directories = counts.leaf = 0;
    const live = trackDescriptors();
    expect(f.read(f.requests(2))).toHaveLength(2);
    const small = { ...counts };
    counts.directories = counts.leaf = 0;
    expect(f.read(f.requests(7))).toHaveLength(7);
    expect(counts.directories).toBe(small.directories);
    expect(counts.leaf).toBe(7 * 3);
    expect(small.leaf).toBe(2 * 3);
    expect(f.hooks.authority).toBe(9);
    expect(f.hooks.signatures).toBe(9);
    expect(live.size).toBe(0);
  });

  it.each(["directory", "files"])(
    "rejects a %s replacement attempt during authority lookup before replacement payload opens",
    (field) => {
      const f = fixture();
      const swap = replacement(f[field]);
      let replacementOpened = false;
      const live = trackDescriptors((target) => {
        if (target === f.target && f.hooks.authority > 0)
          replacementOpened = true;
      });
      f.hooks.onAuthority = () => {
        f.hooks.onAuthority = null;
        swap.replace();
      };
      try {
        let failure;
        try {
          f.read(f.requests(2));
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeDefined();
        if (swap.blocked !== null) {
          // Windows may prevent moving a directory containing held children.
          // That is OS rejection, not evidence of a scope detecting ABA.
          expect(process.platform).toBe("win32");
          expect(["EPERM", "EACCES", "EBUSY"]).toContain(swap.blocked);
          expect(failure.code).toBe("CC_EVOLUTION_ARTIFACT_AUTHORITY_DENIED");
        } else {
          expect(swap.moved).toBe(true);
          expect(failure.code).toBe(EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE);
        }
        expect(replacementOpened).toBe(false);
        expect(live.size).toBe(0);
      } finally {
        swap.restore();
      }
    },
  );

  it("rejects a signature verifier replacing the held files directory", () => {
    const f = fixture(),
      swap = replacement(f.files);
    f.hooks.onVerify = () => {
      f.hooks.onVerify = null;
      swap.replace();
    };
    try {
      expectIntegrity(() => f.read(f.requests(1)));
      expect(swap.moved).toBe(true);
    } finally {
      swap.restore();
    }
  });

  it("rejects a final clock replacing files after both index reads", () => {
    const f = fixture(),
      swap = replacement(f.files);
    let indexReads = 0,
      changed = false;
    const live = trackDescriptors((target) => {
      if (target === f.store._indexFile()) indexReads++;
    });
    f.hooks.onClock = () => {
      if (indexReads === 2 && !changed) {
        changed = true;
        swap.replace();
      }
    };
    try {
      expectIntegrity(() => f.read(f.requests(1)));
      expect(changed).toBe(true);
      expect(swap.moved).toBe(true);
      expect(live.size).toBe(0);
    } finally {
      swap.restore();
    }
  });

  it("rejects a fresh root path identity mismatch against its held descriptor", () => {
    const f = fixture(),
      lstat = fs.lstatSync;
    let changed = false,
      observed = false;
    const live = trackDescriptors();
    vi.spyOn(fs, "lstatSync").mockImplementation((target, ...args) => {
      const stat = lstat(target, ...args);
      if (changed && target === f.directory && args[0]?.bigint) {
        observed = true;
        Object.defineProperty(stat, "ino", { value: stat.ino + 1n });
      }
      return stat;
    });
    f.hooks.onAuthority = () => {
      changed = true;
    };
    expectIntegrity(() => f.read(f.requests(1)));
    expect(observed).toBe(true);
    expect(live.size).toBe(0);
  });

  it("does not release results when closing a held directory reports failure", () => {
    const f = fixture();
    let rootFd = null,
      injected = false;
    const live = trackDescriptors(
      (target, fd) => {
        if (target === f.directory && rootFd === null) rootFd = fd;
      },
      (fd) => {
        if (fd === rootFd && !injected) {
          injected = true;
          throw new Error("test close failure after native close");
        }
      },
    );
    expectIntegrity(() => f.read(f.requests(1)));
    expect(injected).toBe(true);
    expect(live.size).toBe(0);
  });

  it("rejects a post-hash leaf canonical mismatch before a later clock could restore it", async () => {
    let f;
    const open = fs.openSync,
      close = fs.closeSync,
      digest = crypto.Hash.prototype.digest,
      native = fs.realpathSync.native;
    let targetFd = null,
      closed = false,
      changed = false,
      observed = false,
      restoredByClock = false;
    // Held descendants can prevent ancestor renames on Windows. Inject the
    // canonical-path observation explicitly; do not treat OS rename failure
    // as evidence that the post-hash canonical check actually ran.
    vi.spyOn(fs.realpathSync, "native").mockImplementation(
      (target, ...args) => {
        if (changed && target === f?.target) {
          observed = true;
          return path.join(root, "moved-home", path.basename(target));
        }
        return native(target, ...args);
      },
    );
    const implementation = await import(
      "../../src/lib/evolution/evolution-artifact-ports.js?directory-scope-post-hash"
    );
    f = fixture(implementation);
    vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
      const fd = open(target, ...args);
      if (target === f.target) targetFd = fd;
      return fd;
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      const result = close(fd);
      if (fd === targetFd) closed = true;
      return result;
    });
    vi.spyOn(crypto.Hash.prototype, "digest").mockImplementation(function (
      ...args
    ) {
      const result = digest.apply(this, args);
      if (closed && !changed) {
        closed = false;
        changed = true;
      }
      return result;
    });
    f.hooks.onClock = () => {
      if (changed) {
        restoredByClock = true;
        changed = false;
      }
    };
    expectIntegrity(() => f.read(f.requests(1)));
    expect(changed).toBe(true);
    expect(observed).toBe(true);
    expect(restoredByClock).toBe(false);
  });

  it.each(["storedPath", "_filesDir", "verifyIntegrity"])(
    "fails closed when %s changes after the sealed scope starts",
    (method) => {
      const f = fixture(),
        original = ArtifactStore.prototype[method];
      f.hooks.onAuthority = () => {
        f.hooks.onAuthority = null;
        vi.spyOn(ArtifactStore.prototype, method).mockImplementation(function (
          ...args
        ) {
          return original.apply(this, args);
        });
      };
      expectIntegrity(() => f.read(f.requests(1)));
    },
  );

  it("retains the original hook path when defaults changed before a retained reader starts", () => {
    const f = fixture(),
      original = ArtifactStore.prototype._filesDir;
    const hook = vi
      .spyOn(ArtifactStore.prototype, "_filesDir")
      .mockImplementation(function (...args) {
        return original.apply(this, args);
      });
    expect(f.read(f.requests(2))).toHaveLength(2);
    expect(hook).toHaveBeenCalled();
    expect(f.hooks.authority).toBe(2);
  });

  it("withholds results and closes held descriptors when an authority callback throws", () => {
    const f = fixture(),
      live = trackDescriptors();
    f.hooks.onAuthority = () => {
      throw new Error("test authority failure");
    };
    expect(() => f.read(f.requests(2))).toThrow();
    expect(live.size).toBe(0);
  });
});
