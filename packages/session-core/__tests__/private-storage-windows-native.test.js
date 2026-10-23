import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const {
  executeRequest,
  ownerOnly,
  mutexName,
  validateRequest,
  standardPath,
} = require("../lib/private-storage-windows-native.cjs");
const {
  assertSafeOwnerOnlyPath,
  inspectPrivatePaths,
} = require("../lib/private-storage.js");
const USER = "S-1-5-21-1-2-3-4";
const OWNER = "S-1-5-32-544";
const secure = (directory, sid = USER) => ({
  ownerSid: sid,
  protected: true,
  rules: [{ type: 0, flags: directory ? 3 : 0, mask: 0x1f01ff, sid }],
});
function fixture() {
  const entries = new Map();
  const handles = [],
    writes = [],
    waits = [],
    released = [];
  const add = (
    name,
    directory = true,
    security = secure(directory),
    attributes = directory ? 0x10 : 0,
  ) => {
    entries.set(name, {
      identity: name,
      attributes,
      security: structuredClone(security),
    });
  };
  add("C:\\");
  add("C:\\fixture");
  add("C:\\fixture\\one", false);
  const api = {
    open(target, access) {
      const name = path.win32.resolve(standardPath(target));
      const entry = entries.get(name);
      if (!entry) return null;
      const handle = { entry, access, name, closed: false };
      handles.push(handle);
      return handle;
    },
    close(handle) {
      expect(handle.closed).toBe(false);
      handle.closed = true;
    },
    information(handle) {
      return {
        identity: handle.entry.identity,
        attributes: handle.entry.attributes,
      };
    },
    token: () => ({ userSid: USER, ownerSid: OWNER }),
    security: (handle) => structuredClone(handle.entry.security),
    writeSecurity(handle, sid, directory, changeOwner) {
      writes.push({ access: handle.access, changeOwner });
      handle.entry.security = secure(directory, sid);
    },
    createMutex(name) {
      const handle = { name, closed: false };
      handles.push(handle);
      return handle;
    },
    waitMutex(handle, milliseconds) {
      waits.push(milliseconds);
      return true;
    },
    releaseMutex(handle) {
      released.push(handle.name);
    },
    fullPath: (target) => "\\\\?\\" + path.win32.resolve(standardPath(target)),
    invariantUpper: (value) => value.toUpperCase(),
  };
  const run = (targets = ["C:\\fixture\\one"], extras = {}, options = {}) =>
    executeRequest(
      {
        operation: "repair",
        targets,
        timeoutMs: 15000,
        ...extras,
      },
      api,
      { guard: assertSafeOwnerOnlyPath, ...options },
    );
  return { api, entries, handles, writes, waits, released, add, run };
}

describe("native Windows ACL policy", () => {
  it("retains valid DACLs unchanged and reads back while every handle is held", () => {
    const f = fixture();
    const result = f.run();
    expect(result[0].ok).toBe(true);
    expect(f.writes).toEqual([]);
    expect(f.released).toHaveLength(1);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it("repairs a broad same-owner DACL with WRITE_DAC and without WRITE_OWNER", () => {
    const f = fixture();
    f.entries
      .get("C:\\fixture\\one")
      .security.rules.push({ type: 0, flags: 0, mask: 0x1f01ff, sid: OWNER });
    expect(f.run()[0].ok).toBe(true);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].access & 0x40000).not.toBe(0);
    expect(f.writes[0].access & 0x80000).toBe(0);
  });

  it("migrates only the exact token owner and requires WRITE_OWNER for that case", () => {
    const f = fixture();
    f.entries.get("C:\\fixture\\one").security = secure(false, OWNER);
    expect(f.run()[0].ownerSid).toBe(USER);
    expect(f.writes[0].access & 0x80000).not.toBe(0);
    expect(f.writes[0].changeOwner).toBe(true);
  });

  it("rejects an unrelated owner without mutation and releases the mutex", () => {
    const f = fixture();
    f.entries.get("C:\\fixture\\one").security = secure(
      false,
      "S-1-5-21-9-8-7-6",
    );
    expect(() => f.run()).toThrow(/FOREIGN_OWNER/);
    expect(f.writes).toEqual([]);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it.each([
    ["safe", "SAFE"],
    ["k", "K"],
  ])("does not fold traversal cache keys for %s and %s", (regular, linked) => {
    const f = fixture();
    f.add(`C:\\fixture\\${regular}`);
    f.add(`C:\\fixture\\${regular}\\a`, false);
    f.add(`C:\\fixture\\${linked}`, true, secure(true), 0x410);
    f.add(`C:\\fixture\\${linked}\\b`, false);
    expect(() =>
      f.run([`C:\\fixture\\${regular}\\a`, `C:\\fixture\\${linked}\\b`]),
    ).toThrow(/PATH_PREFLIGHT_FAILED/);
    expect(f.writes).toEqual([]);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it("preflights all kinds before changing the first invalid DACL", () => {
    const f = fixture();
    f.entries.get("C:\\fixture\\one").security.rules = [];
    expect(() =>
      f.run(["C:\\fixture\\one", "C:\\fixture"], { expectedKind: "file" }),
    ).toThrow(/EXPECTED_KIND_MISMATCH/);
    expect(f.writes).toEqual([]);
  });

  it("rejects a replacement target after the preflight handle was obtained", () => {
    const f = fixture(),
      original = f.api.open;
    f.api.open = (target, access) => {
      const handle = original(target, access);
      if (access & 0x20000)
        handle.entry = { ...handle.entry, identity: "replacement" };
      return handle;
    };
    expect(() => f.run()).toThrow(/PATH_IDENTITY_CHANGED/);
    expect(f.writes).toEqual([]);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it("rejects changed ownership after opening the write handle", () => {
    const f = fixture(),
      read = f.api.security;
    f.entries.get("C:\\fixture\\one").security.rules = [];
    f.api.security = (handle) =>
      handle.access & 0x40000
        ? secure(false, "S-1-5-21-9-8-7-6")
        : read(handle);
    expect(() => f.run()).toThrow(/FOREIGN_OWNER/);
    expect(f.writes).toEqual([]);
  });

  it("rejects ineffective repair on fresh readback", () => {
    const f = fixture();
    f.entries.get("C:\\fixture\\one").security.rules = [];
    f.api.writeSecurity = () => {};
    expect(f.run()[0].ok).toBe(false);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it("pins directories with TRAVERSE without adding file read/execute rights", () => {
    const f = fixture();
    f.entries.get("C:\\fixture\\one").security.rules = [];
    expect(f.run()[0].ok).toBe(true);
    expect(
      f.handles
        .filter((h) => h.name === "C:\\fixture")
        .some((h) => h.access === 0xa0),
    ).toBe(true);
    expect(
      f.handles
        .filter((h) => h.name === "C:\\fixture\\one")
        .every((h) => (h.access & 0x21) === 0),
    ).toBe(true);
  });

  it("does not rewrite an ACL that becomes valid before the fresh prewrite check", () => {
    const f = fixture(),
      read = f.api.security;
    let reads = 0;
    f.entries.get("C:\\fixture\\one").security.rules = [];
    f.api.security = (h) => {
      if (++reads === 3) h.entry.security = secure(false);
      return read(h);
    };
    expect(f.run()[0].ok).toBe(true);
    expect(f.writes).toEqual([]);
  });

  it.each(["file", "directory", "reparse", "foreign-owner"])(
    "rejects a prewrite path replacement (%s) without mutating either object",
    (kind) => {
      const f = fixture(),
        open = f.api.open,
        target = "C:\\fixture\\one";
      const original = f.entries.get(target);
      original.security.rules = [];
      const replacement = {
        ...structuredClone(original),
        identity: "replacement",
        attributes:
          kind === "directory" ? 0x10 : kind === "reparse" ? 0x400 : 0,
      };
      if (kind === "foreign-owner")
        replacement.security.ownerSid = "S-1-5-21-99";
      f.api.open = (name, access) => {
        const handle = open(name, access);
        if (access & 0x40000) f.entries.set(target, replacement);
        return handle;
      };
      expect(() => f.run()).toThrow(/PATH_IDENTITY_CHANGED/);
      expect(f.writes).toEqual([]);
      expect(original.security.rules).toEqual([]);
      expect(replacement.security.rules).toEqual([]);
      expect(f.handles.every((h) => h.closed)).toBe(true);
      expect(f.released).toHaveLength(1);
    },
  );

  it("rejects final path replacement after prewrite check while never mutating replacement", () => {
    const f = fixture(),
      write = f.api.writeSecurity,
      target = "C:\\fixture\\one";
    const original = f.entries.get(target);
    original.security.rules = [];
    const replacement = {
      ...structuredClone(original),
      identity: "replacement",
    };
    f.api.writeSecurity = (...args) => {
      f.entries.set(target, replacement);
      write(...args);
    };
    expect(() => f.run()).toThrow(/PATH_IDENTITY_CHANGED/);
    expect(f.writes).toHaveLength(1);
    expect(ownerOnly(original.security, false, USER)).toBe(true);
    expect(replacement.security.rules).toEqual([]);
    expect(f.handles.every((h) => h.closed)).toBe(true);
    expect(f.released).toHaveLength(1);
  });

  it("rejects a path swap after writing but before final fresh open", () => {
    const f = fixture(),
      open = f.api.open,
      target = "C:\\fixture\\one";
    f.entries.get(target).security.rules = [];
    const replacement = {
      ...structuredClone(f.entries.get(target)),
      identity: "replacement",
    };
    f.api.open = (name, access) => {
      if (f.writes.length) f.entries.set(target, replacement);
      return open(name, access);
    };
    expect(() => f.run()).toThrow(/PATH_IDENTITY_CHANGED/);
    expect(replacement.security.rules).toEqual([]);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it("rejects a fresh path reparse bit even when identity is unchanged", () => {
    const f = fixture(),
      open = f.api.open;
    let reads = 0;
    f.api.open = (name, access) => {
      const h = open(name, access);
      if (access & 0x20000 && ++reads === 2)
        h.entry = { ...h.entry, attributes: 0x400 };
      return h;
    };
    expect(() => f.run()).toThrow(/PATH_IDENTITY_CHANGED/);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it("does not mutate when mutex acquisition times out", () => {
    const f = fixture();
    f.api.waitMutex = () => false;
    expect(() => f.run()).toThrow(/MUTEX_TIMEOUT/);
    expect(f.released).toEqual([]);
    expect(f.writes).toEqual([]);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it("shrinks the mutex wait to the one remaining operation budget", () => {
    const f = fixture();
    let clock = 0;
    expect(
      f.run(undefined, { timeoutMs: 100 }, { now: () => clock++ * 10 })[0].ok,
    ).toBe(true);
    expect(f.waits[0]).toBeGreaterThan(0);
    expect(f.waits[0]).toBeLessThan(100);
  });

  it("rejects deadline expiration before ACL mutation", () => {
    const f = fixture();
    let clock = 0;
    expect(() =>
      f.run(undefined, { timeoutMs: 1 }, { now: () => clock++ * 2 }),
    ).toThrow(/DEADLINE_EXCEEDED/);
    expect(f.writes).toEqual([]);
  });

  it("continues closing resources even when one close fails", () => {
    const f = fixture(),
      close = f.api.close;
    let failed = false;
    f.api.close = (handle) => {
      close(handle);
      if (!failed) {
        failed = true;
        throw Error("close");
      }
    };
    expect(() => f.run()).toThrow(/HANDLE_CLOSE_FAILED/);
    expect(f.handles.every((h) => h.closed)).toBe(true);
  });

  it("preserves missing-path and no-mutation preflight semantics", () => {
    const f = fixture();
    expect(
      f.run(["C:\\fixture\\absent"], { operation: "preflight" })[0],
    ).toMatchObject({ ok: true, exists: false });
    expect(f.writes).toEqual([]);
  });

  it.each(["C:\\", "relative", "\\\\?\\C:\\"])(
    "guards broad/device paths before native calls: %s",
    (target) => {
      const f = fixture();
      expect(() => f.run([target])).toThrow();
      expect(f.handles).toEqual([]);
    },
  );

  it("rejects malformed inputs, duplicate targets and extra fields", () => {
    const request = {
      operation: "repair",
      targets: ["C:\\fixture\\one"],
      timeoutMs: 15000,
    };
    for (const value of [
      { ...request, execute: "secret" },
      { ...request, timeoutMs: Infinity },
      { ...request, targets: [...request.targets, ...request.targets] },
      { ...request, targets: ["bad\0path"] },
      {
        ...request,
        targets: Array.from({ length: 501 }, (_, i) => `C:\\fixture\\${i}`),
      },
    ])
      expect(() => validateRequest(value)).toThrow(/INVALID_REQUEST/);
  });

  it("rejects alternate streams before opening their base object's ACL", () => {
    const f = fixture();
    expect(() => f.run(["C:\\fixture\\one:stream"])).toThrow(/UNSAFE_PATH/);
    expect(f.handles).toEqual([]);
  });

  it.each([false, true])(
    "production host routing retains Electron PowerShell (electron=%s)",
    (electron) => {
      const calls = [],
        module = { exports: {} };
      const filename = require.resolve("../lib/private-storage.js");
      const localRequire = createRequire(filename);
      vm.runInNewContext(
        fs.readFileSync(filename, "utf8"),
        {
          module,
          __dirname: path.dirname(filename),
          process: {
            ...process,
            platform: "win32",
            versions: {
              ...process.versions,
              electron: electron ? "test" : undefined,
            },
            env: {
              SystemRoot: "C:\\Windows",
              NODE_OPTIONS: "forbidden",
              NODE_PATH: "forbidden",
            },
          },
          require(name) {
            return name === "node:child_process"
              ? {
                  spawnSync(program, args, options) {
                    calls.push({ program, args, options });
                    return { status: 4, stdout: "[]" };
                  },
                }
              : localRequire(name);
          },
        },
        { filename },
      );
      const result = module.exports.inspectPrivatePaths(["C:\\fixture\\one"]);
      expect(result[0].ok).toBe(false);
      expect(calls).toHaveLength(1);
      expect(calls[0].program).toBe(
        electron ? "powershell.exe" : process.execPath,
      );
      expect(calls[0].options.timeout).toBe(30000);
      if (!electron) {
        expect(calls[0].args).toEqual([
          path.join(
            path.dirname(filename),
            "private-storage-windows-worker.cjs",
          ),
        ]);
        expect(calls[0].options.env).toEqual({ SystemRoot: "C:\\Windows" });
        expect(JSON.parse(calls[0].options.input).operation).toBe("inspect");
      }
    },
  );

  it("matches file inheritance policy but rejects noncanonical directory ACEs", () => {
    const file = secure(false);
    file.protected = false;
    file.rules[0].flags = 16;
    expect(ownerOnly(file, false, USER)).toBe(true);
    for (const flags of [0, 1, 2, 7, 11, 19]) {
      const directory = secure(true);
      directory.rules[0].flags = flags;
      expect(ownerOnly(directory, true, USER)).toBe(false);
    }
    for (const change of [
      (s) => (s.rules[0].type = 1),
      (s) => (s.rules[0].mask = 0x120089),
      (s) => (s.rules = []),
      (s) => (s.protected = false),
    ]) {
      const directory = secure(true);
      change(directory);
      expect(ownerOnly(directory, true, USER)).toBe(false);
    }
  });

  it("builds only the established SID/path digest mutex name", () => {
    const value = mutexName(USER, "\\\\?\\C:\\fixture\\one", (s) =>
      s.toUpperCase(),
    );
    expect(value).toMatch(
      /^Global\\ChainlessChain\.PrivateAcl\.[A-F0-9]{64}$/u,
    );
    expect(value).not.toContain(USER);
  });

  it("explicit dependency injection retains the PowerShell backend", () => {
    const calls = [];
    const result = inspectPrivatePaths(["C:\\fixture\\one"], {
      platform: "win32",
      deps: {
        fs: {},
        spawnSync(program, args, options) {
          calls.push({ program, timeout: options.timeout });
          return {
            status: 0,
            stdout: JSON.stringify([
              { target: "\\\\?\\C:\\fixture\\one", ok: true, exists: true },
            ]),
          };
        },
      },
    });
    expect(result[0].ok).toBe(true);
    expect(calls).toEqual([{ program: "powershell.exe", timeout: 30000 }]);
  });
});
