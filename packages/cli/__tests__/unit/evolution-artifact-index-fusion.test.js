import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { evolutionDurableStoreConfiguration } from "../fixtures/evolution-durable-store.js";
import {
  EvolutionArtifactPorts,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE as INTEGRITY,
  EVOLUTION_ARTIFACT_NOT_FOUND_CODE as NOT_FOUND,
} from "../../src/lib/evolution/evolution-artifact-ports.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-index-fusion-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  const target = path.resolve(root);
  if (
    path.dirname(target) !== temp ||
    !path.basename(target).startsWith("cc-index-fusion-")
  )
    throw new Error("unsafe fusion test cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});

function open(onAuthority = () => {}, Store = ArtifactStore) {
  const directory = path.join(root, "artifacts");
  const config = evolutionDurableStoreConfiguration(directory, {
    artifactTenantId: "bytes-artifacts",
    audience: "bytes-runtime",
  });
  const store = new Store({ dir: directory, now: config.clock });
  const resolver = config.artifactAuthority.currentAuthorityResolver;
  const ports = new EvolutionArtifactPorts({
    artifactStore: store,
    tenantId: "bytes-artifacts",
    audience: "bytes-runtime",
    now: config.clock,
    ...config.artifactAuthority,
    currentAuthorityResolver: {
      resolve(request) {
        const decision = resolver.resolve(request);
        onAuthority(request, store);
        return decision;
      },
    },
  });
  const publication = ports.putCanonical(
    "evolution-ledger-v2-journal",
    { text: "signed payload" },
    {
      purpose: "evolution-ledger",
      retention: "ledger",
    },
  );
  const entry = JSON.parse(fs.readFileSync(store._indexFile(), "utf8").trim());
  const f = {
    store,
    ports,
    publication,
    entry,
    target: store.storedPath(entry),
  };
  return {
    ...f,
    resolve: () =>
      f.ports.resolve(f.publication.envelope, {
        expectedDigest: f.publication.digest,
        expectedType: "evolution-ledger-v2-journal",
        purpose: "evolution-ledger",
        tenantId: "bytes-artifacts",
      }),
  };
}

// This is race/fault injection, not production eligibility instrumentation.
function mutateDuringPayload(f, mutate) {
  const openSync = fs.openSync;
  let fired = false;
  vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
    const fd = openSync(target, ...args);
    if (!fired && target === f.target) {
      fired = true;
      const index = f.store._indexFile();
      const rows = fs
        .readFileSync(index, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
      const replacement = mutate(rows);
      fs.writeFileSync(
        index,
        replacement.length
          ? replacement.map(JSON.stringify).join("\n") + "\n"
          : "",
      );
    }
    return fd;
  });
  return () => fired;
}

describe("independent pre/post default index lookup phases", () => {
  it("checks duplicate digest before duplicate id in publication readback after authority returns", () => {
    let armed = false;
    const f = open((request, store) => {
      if (!armed || request.action !== "resolve") return;
      armed = false;
      const rows = fs
        .readFileSync(store._indexFile(), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
      fs.appendFileSync(store._indexFile(), JSON.stringify(rows.at(-1)) + "\n");
    });
    armed = true;
    let error;
    try {
      f.ports.putCanonical(
        "evolution-ledger-v2-journal",
        { text: "another signed value" },
        {
          purpose: "evolution-ledger",
          retention: "ledger",
        },
      );
    } catch (cause) {
      error = cause;
    }
    expect(armed).toBe(false);
    expect(error).toMatchObject({
      code: INTEGRITY,
      message: "recordDigest must have exactly one ArtifactStore index row",
    });
  });

  it.each(["list", "get"])(
    "preserves the original custom %s hook sequence",
    (method) => {
      let armed = false;
      const calls = [];
      class CustomStore extends ArtifactStore {
        [method](...args) {
          if (armed) calls.push(method);
          return super[method](...args);
        }
      }
      const f = open(() => {}, CustomStore);
      const openSync = fs.openSync;
      vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
        const fd = openSync(target, ...args);
        if (target === f.target) calls.push("payload-open");
        return fd;
      });
      armed = true;
      expect(f.resolve()).toMatchObject({ authenticated: true });
      expect(calls).toEqual([
        ...Array(method === "list" ? 4 : 1).fill(method),
        "payload-open",
        ...Array(method === "list" ? 3 : 1).fill(method),
      ]);
    },
  );

  it.each(["list", "get", "verifyIntegrity"])(
    "retains captured semantics after a late default prototype %s replacement",
    (method) => {
      const f = open();
      const hook = vi
        .spyOn(ArtifactStore.prototype, method)
        .mockImplementation(() => {
          throw new Error(
            "late replacement must not replace the already captured method",
          );
        });
      expect(f.resolve()).toMatchObject({ authenticated: true });
      expect(hook).not.toHaveBeenCalled();
    },
  );

  it.each(["id", "recordDigest"])(
    "rejects a duplicate %s inserted by current authority before payload access",
    (field) => {
      let armed = false;
      const f = open((request, store) => {
        if (!armed || request.action !== "resolve") return;
        armed = false;
        const row = JSON.parse(
          fs.readFileSync(store._indexFile(), "utf8").trim(),
        );
        const duplicate =
          field === "id"
            ? { ...row, recordDigest: "sha256:" + "2".repeat(64) }
            : { ...row, id: "art_other_12345678" };
        fs.appendFileSync(store._indexFile(), JSON.stringify(duplicate) + "\n");
      });
      const opened = vi.spyOn(fs, "openSync");
      armed = true;
      let error;
      try {
        f.resolve();
      } catch (cause) {
        error = cause;
      }
      expect(error).toMatchObject({ code: INTEGRITY });
      expect(armed).toBe(false);
      expect(opened.mock.calls.some(([target]) => target === f.target)).toBe(
        false,
      );
    },
  );

  it.each(["before", "during"])(
    "preserves a default prototype path hook installed %s payload read",
    (stage) => {
      const f = open();
      let calls = 0;
      let installed = false;
      const install = () => {
        installed = true;
        vi.spyOn(ArtifactStore.prototype, "_filesDir").mockImplementation(
          () => {
            calls++;
            throw new Error("late default prototype path hook rejected");
          },
        );
      };
      const openSync = fs.openSync;
      vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
        const fd = openSync(target, ...args);
        if (stage === "during" && target === f.target && !installed) install();
        return fd;
      });
      if (stage === "before") install();
      let error;
      try {
        f.resolve();
      } catch (cause) {
        error = cause;
      }
      expect(error).toMatchObject({ code: INTEGRITY });
      expect(installed).toBe(true);
      expect(calls).toBe(1);
    },
  );

  it("rejects a same-byte index inode replacement during payload read", () => {
    const f = open();
    const index = f.store._indexFile();
    const inode = fs.statSync(index, { bigint: true }).ino;
    const fired = mutateDuringPayload(f, (rows) => {
      fs.renameSync(index, index + ".saved");
      return rows;
    });
    let error;
    try {
      f.resolve();
    } catch (cause) {
      error = cause;
    }
    expect(fired()).toBe(true);
    expect(fs.statSync(index, { bigint: true }).ino).not.toBe(inode);
    expect(error).toMatchObject({
      code: INTEGRITY,
      message: "ArtifactStore index physical identity changed",
    });
  });

  it("allows an unrelated same-inode append during payload read", () => {
    const f = open();
    const fired = mutateDuringPayload(f, (rows) => [
      ...rows,
      { id: "unrelated-row" },
    ]);
    expect(f.resolve()).toMatchObject({
      authenticated: true,
      digest: f.publication.digest,
    });
    expect(fired()).toBe(true);
  });

  it.each([
    [
      "changed row and duplicate digest",
      (rows) => [
        { ...rows[0], title: "changed while reading" },
        { ...rows[0], id: "art_other_12345678" },
      ],
      INTEGRITY,
      "ArtifactStore index entry was replaced during readback",
    ],
    [
      "duplicate id and digest",
      (rows) => [...rows, { ...rows[0] }],
      INTEGRITY,
      "evolution artifact id has duplicate index rows",
    ],
    [
      "duplicate digest",
      (rows) => [...rows, { ...rows[0], id: "art_other_12345678" }],
      INTEGRITY,
      "recordDigest must have exactly one ArtifactStore index row",
    ],
    [
      "duplicate id",
      (rows) => [
        ...rows,
        { ...rows[0], recordDigest: "sha256:" + "1".repeat(64) },
      ],
      INTEGRITY,
      "evolution artifact id has duplicate index rows",
    ],
    [
      "changed row",
      (rows) => rows.map((row) => ({ ...row, title: "changed while reading" })),
      INTEGRITY,
      "ArtifactStore index entry was replaced during readback",
    ],
    [
      "removed row",
      () => [],
      NOT_FOUND,
      "evolution artifact index entry was removed or expired",
    ],
  ])(
    "rejects %s introduced during payload read",
    (_name, mutate, code, message) => {
      const f = open();
      const fired = mutateDuringPayload(f, mutate);
      let error;
      try {
        f.resolve();
      } catch (cause) {
        error = cause;
      }
      expect(error).toMatchObject({ code, message });
      expect(fired()).toBe(true);
    },
  );
});
