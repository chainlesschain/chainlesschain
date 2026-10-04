import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCOPED_PERMISSION_ERROR_CODES,
  ScopedPermissionStore,
  getScopedPermissionRevision,
  subscribeScopedPermissionRevision,
} from "../../src/lib/scoped-permission-store.js";
import {
  createPermissionRulesProvider,
  permissionRulesProviderAuthority,
} from "../../src/lib/permission-authority.js";
import { withFileLock } from "../../src/lib/with-file-lock.js";

let root;
let cwd;
let filePath;
const removers = [];
const run = promisify(execFile);
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-scoped-authority-"));
  cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  filePath = path.join(root, "authority", "rules.json");
});
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
const store = (options = {}) =>
  new ScopedPermissionStore({ cwd, filePath, ...options });
const add = (target = store(), options = {}) =>
  target.add({
    decision: "allow",
    rule: "Bash",
    expiresAt: Date.now() + 60_000,
    ...options,
  });
const listen = (listener) => {
  const remove = subscribeScopedPermissionRevision(listener);
  removers.push(remove);
  return remove;
};
const providerFor = (scopedStore = store()) =>
  createPermissionRulesProvider({
    cwd,
    scopedStore,
    env: {},
    managedSettingsFile: path.join(root, "missing.json"),
  });

describe("official scoped permission mutation authority", () => {
  it("retains all concurrent real-process grants and revocations under the same strict lock", async () => {
    const moduleUrl = new URL(
      "../../src/lib/scoped-permission-store.js",
      import.meta.url,
    ).href;
    const source = `import { ScopedPermissionStore } from ${JSON.stringify(moduleUrl)};
const store = new ScopedPermissionStore({ cwd: process.argv[1], filePath: process.argv[2] });
const id = process.argv[3];
if (id) store.revoke({ id });
else console.log(store.add({ decision: 'allow', rule: 'Read', expiresAt: Date.now() + 60000 }).id);`;
    const execute = (id) =>
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          source,
          cwd,
          filePath,
          ...(id ? [id] : []),
        ],
        { timeout: 15_000, windowsHide: true },
      );
    const results = await Promise.all(
      Array.from({ length: 4 }, () => execute()),
    );
    const ids = results.map((result) => result.stdout.trim());
    expect(new Set(ids).size).toBe(4);
    expect(store().list()).toMatchObject({ generation: 4 });
    await Promise.all(ids.map(execute));
    expect(store().list()).toMatchObject({ generation: 8 });
    expect(
      store()
        .list()
        .rules.map((record) => record.status),
    ).toEqual(Array(4).fill("revoked"));
  }, 30_000);

  it("notifies synchronously before durable add/revoke and shares the owner across instances", () => {
    const provider = providerFor();
    const authority = permissionRulesProviderAuthority(provider);
    const before = authority.getSnapshot();
    const disk = [];
    listen((revision) => {
      expect(revision.state).toBe("mutating");
      disk.push(
        fs.existsSync(filePath)
          ? JSON.parse(fs.readFileSync(filePath, "utf8"))
          : null,
      );
    });
    const created = add();
    expect(disk).toEqual([null]);
    expect(provider().rules.allow).toContain("Bash");
    expect(authority.getSnapshot()).not.toBe(before);
    const added = authority.getSnapshot();
    expect(authority.getSnapshot()).toBe(added);
    store().revoke({ id: created.id, expectedRevision: 1 });
    expect(disk[1].rules[0].revokedAt).toBeNull();
    expect(provider().rules.allow).not.toContain("Bash");
    expect(authority.getSnapshot().scoped.revision).toBe(
      before.scoped.revision + 2,
    );
    expect(authority.getSnapshot().settings).toBe(before.settings);
  });

  it("isolates observer errors, rejects cross-instance read/write reentry before locks, and unsubscribes", () => {
    listen(() => {
      throw new Error("observer failed");
    });
    const locking = vi.fn(withFileLock);
    const other = store({ lock: locking });
    const provider = providerFor(other);
    const errors = [];
    listen(() => {
      for (const attempt of [() => other.list(), () => add(other), provider]) {
        try {
          attempt();
          errors.push(null);
        } catch (error) {
          errors.push(error.code);
        }
      }
    });
    const observed = vi.fn();
    const remove = listen(observed);
    add();
    expect(errors).toEqual(
      Array(3).fill("CC_SCOPED_PERMISSION_AUTHORITY_UNAVAILABLE"),
    );
    expect(locking).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalledOnce();
    remove();
    add();
    expect(observed).toHaveBeenCalledOnce();
  });

  it("keeps path, workspace and operation dependencies fixed when an observer changes the public instance", () => {
    const target = store();
    const originalWorkspace = target.workspace;
    const otherFile = path.join(root, "wrong", "rules.json");
    listen(() => {
      target.filePath = otherFile;
      target.workspace = { id: "wrong", root: "wrong" };
      target._lock = () => {
        throw new Error("replacement lock");
      };
      target._now = () => 0;
    });
    const created = add(target);
    expect(created.sourceFile).toBe(filePath);
    expect(created.createdAt).toBeGreaterThan(0);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8")).workspace).toEqual(
      originalWorkspace,
    );
    expect(fs.existsSync(otherFile)).toBe(false);
    expect(store().list().rules[0].id).toBe(created.id);
  });

  it("does not change authority or bytes on idempotent revoke, validation, CAS, full store, or lock failure", () => {
    const target = store({ maxRecords: 1 });
    const created = add(target);
    const observer = vi.fn();
    listen(observer);
    const before = getScopedPermissionRevision();
    for (const attempt of [
      () => add(target, { decision: "invalid" }),
      () => add(target, { expectedGeneration: 0 }),
      () => add(target),
      () => target.revoke({ id: created.id, expectedRevision: 4 }),
      () =>
        add(
          store({
            lock: () => {
              throw new Error("lock unavailable");
            },
          }),
        ),
    ])
      expect(attempt).toThrow();
    expect(getScopedPermissionRevision()).toBe(before);
    expect(observer).not.toHaveBeenCalled();
    target.revoke({ id: created.id });
    const revoked = getScopedPermissionRevision();
    const bytes = fs.readFileSync(filePath, "utf8");
    observer.mockClear();
    target.revoke({ id: created.id, expectedRevision: 2 });
    expect(getScopedPermissionRevision()).toBe(revoked);
    expect(fs.readFileSync(filePath, "utf8")).toBe(bytes);
    expect(observer).not.toHaveBeenCalled();
  });

  it.each([
    ["add", "generation"],
    ["revoke", "generation"],
    ["revoke", "revision"],
  ])(
    "refuses %s at exhausted %s before notifying or writing",
    (operation, field) => {
      const target = store();
      const created = add(target);
      const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const versioned = field === "generation" ? state : state.rules[0];
      versioned[field] = Number.MAX_SAFE_INTEGER;
      fs.writeFileSync(filePath, JSON.stringify(state));
      const bytes = fs.readFileSync(filePath, "utf8");
      const before = getScopedPermissionRevision();
      const observer = vi.fn();
      listen(observer);
      const rename = vi.spyOn(fs, "renameSync");

      expect(() =>
        operation === "add"
          ? add(target, { expectedGeneration: state.generation })
          : target.revoke({
              id: created.id,
              expectedRevision: state.rules[0].revision,
            }),
      ).toThrow(
        expect.objectContaining({
          code: SCOPED_PERMISSION_ERROR_CODES.INVALID,
          message: `Scoped permission ${field} is exhausted`,
          commitState: "not-committed",
        }),
      );
      expect(getScopedPermissionRevision()).toBe(before);
      expect(observer).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalledWith(expect.anything(), filePath);
      expect(fs.readFileSync(filePath, "utf8")).toBe(bytes);
      expect(target.list().rules[0].status).toBe("active");
    },
  );

  it("keeps an idempotent revoke at exhausted versions read-only while rejecting stale CAS", () => {
    const target = store();
    const created = add(target);
    target.revoke({ id: created.id });
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    state.generation = Number.MAX_SAFE_INTEGER;
    state.rules[0].revision = Number.MAX_SAFE_INTEGER;
    fs.writeFileSync(filePath, JSON.stringify(state));
    const bytes = fs.readFileSync(filePath, "utf8");
    const before = getScopedPermissionRevision();
    const observer = vi.fn();
    listen(observer);
    const rename = vi.spyOn(fs, "renameSync");

    expect(
      target.revoke({
        id: created.id,
        expectedRevision: Number.MAX_SAFE_INTEGER,
      }),
    ).toMatchObject({ status: "revoked", revision: Number.MAX_SAFE_INTEGER });
    expect(() =>
      target.revoke({
        id: created.id,
        expectedRevision: Number.MAX_SAFE_INTEGER - 1,
      }),
    ).toThrow(
      expect.objectContaining({ code: SCOPED_PERMISSION_ERROR_CODES.CONFLICT }),
    );
    expect(getScopedPermissionRevision()).toBe(before);
    expect(observer).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalledWith(expect.anything(), filePath);
    expect(fs.readFileSync(filePath, "utf8")).toBe(bytes);
  });

  it("rejects stale reads when a clock callback commits another scoped mutation", () => {
    let mutate = false;
    const target = store({
      now: () => {
        if (mutate) {
          mutate = false;
          add();
        }
        return Date.now();
      },
    });
    mutate = true;
    expect(() => target.list()).toThrow(
      expect.objectContaining({
        code: "CC_SCOPED_PERMISSION_AUTHORITY_CHANGED",
      }),
    );
    expect(target.list().rules).toHaveLength(1);
  });

  it("rejects a provider that loads stale scoped rules across a synchronous mutation", () => {
    const provider = providerFor({
      list() {
        const stale = store().list();
        add();
        return stale;
      },
    });
    expect(() => provider()).toThrow(
      expect.objectContaining({
        code: "CC_SCOPED_PERMISSION_AUTHORITY_CHANGED",
      }),
    );
  });

  it("keeps revision advanced after a known uncommitted write failure", () => {
    const before = getScopedPermissionRevision();
    const observer = vi.fn();
    listen(observer);
    const original = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === filePath) throw new Error("replace failed");
      return original(from, to);
    });
    expect(() => add()).toThrow(
      expect.objectContaining({ commitState: "not-committed" }),
    );
    expect(getScopedPermissionRevision()).toMatchObject({
      state: "ready",
      revision: before.revision + 1,
    });
    expect(observer).toHaveBeenCalledOnce();
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual([]);
  });

  it("reports committed lock-cleanup failure without rolling back the owner", () => {
    const before = getScopedPermissionRevision();
    const target = store({
      lock: (file, operation, options) => {
        withFileLock(file, operation, options);
        throw new Error("lock cleanup failed");
      },
    });
    expect(() => add(target)).toThrow(
      expect.objectContaining({ commitState: "committed" }),
    );
    expect(getScopedPermissionRevision()).toMatchObject({
      state: "ready",
      revision: before.revision + 1,
    });
    expect(store().list().rules).toHaveLength(1);
  });

  it("latches an uncertain commit across file restoration in an isolated real process", () => {
    const fixture = fileURLToPath(
      new URL("../fixtures/scoped-write-uncertain.mjs", import.meta.url),
    );
    expect(
      execFileSync(process.execPath, [fixture], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      }),
    ).toContain("scoped uncertain commit blocked");
  });
});
