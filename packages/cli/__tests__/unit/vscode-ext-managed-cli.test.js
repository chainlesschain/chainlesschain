/**
 * Managed CLI runtime (插件托管/内置 CLI) — pure-core + flow tests.
 *
 * The decision core (plan / verify / state / candidate ordering) is driven by
 * the SHARED twin fixtures in
 * packages/vscode-extension/src/__fixtures__/managed-cli/ — the JetBrains
 * plugin twin must produce byte-identical decisions on the same files.
 * Tar extraction is exercised against hand-rolled tar bytes built in-test
 * (incl. a PaxHeader long-path override, GNU @LongLink, ustar prefix, and a
 * zip-slip attack that must be rejected).
 */
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import crypto from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  planManagedInstall,
  verifyTarball,
  parseTarEntries,
  planExtraction,
  extractPackage,
  parseStateJson,
  nextState,
  rollbackPlan,
  packageBinEntry,
  resolveManagedBinary,
  buildLauncherScripts,
  shimName,
  commandForSpawn,
  managedNodeDiagnostic,
  deriveCliCandidates,
  registryMetaUrl,
  STATE_FILE,
} from "../../../vscode-extension/src/managed-cli.js";
import {
  readManagedState,
  resolveManagedCommand,
  runManagedInstall,
  runManagedRollback,
} from "../../../vscode-extension/src/managed-cli-flow.js";
import { resolveCliBinary } from "../../../vscode-extension/src/cli-binary.js";

const fixturesDir = fileURLToPath(
  new URL(
    "../../../vscode-extension/src/__fixtures__/managed-cli/",
    import.meta.url,
  ),
);
const fixture = (name) =>
  JSON.parse(readFileSync(path.join(fixturesDir, name), "utf-8"));

// ---------------------------------------------------------------------------
// Hand-rolled tar builders (test-only)
// ---------------------------------------------------------------------------

function tarHeader(name, size, type = "0", opts = {}) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf-8");
  h.write("0000644\0", 100, "latin1"); // mode
  h.write("0000000\0", 108, "latin1"); // uid
  h.write("0000000\0", 116, "latin1"); // gid
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "latin1");
  h.write("00000000000\0", 136, "latin1"); // mtime
  h.write(type, 156, "latin1");
  h.write("ustar", 257, "latin1"); // magic (NUL-terminated by the alloc)
  h.write("00", 263, "latin1"); // version
  if (opts.prefix) h.write(opts.prefix, 345, 155, "utf-8");
  h.fill(0x20, 148, 156); // checksum field = spaces while summing
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
  return h;
}

function tarEntry(name, content, type = "0", opts = {}) {
  const data = Buffer.isBuffer(content)
    ? content
    : Buffer.from(String(content), "utf-8");
  const size = type === "5" ? 0 : data.length;
  const parts = [tarHeader(name, size, type, opts)];
  if (size > 0) {
    const padded = Buffer.alloc(Math.ceil(size / 512) * 512);
    data.copy(padded);
    parts.push(padded);
  }
  return Buffer.concat(parts);
}

const makeTar = (entries) => Buffer.concat([...entries, Buffer.alloc(1024)]); // two zero blocks = EOF
const makeTgz = (entries) => zlib.gzipSync(makeTar(entries));

/** A pax extended-header record: "LEN key=value\n" with self-counting LEN. */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) {
    len = String(len).length + body.length;
  }
  return String(len) + body;
}

/** A minimal valid chainlesschain-shaped package tgz. */
function makeCliTgz(version) {
  const pkg = JSON.stringify({
    name: "chainlesschain",
    version,
    bin: {
      chainlesschain: "./bin/chainlesschain.js",
      cc: "./bin/chainlesschain.js",
    },
  });
  return makeTgz([
    tarEntry("package/", "", "5"),
    tarEntry("package/package.json", pkg),
    tarEntry("package/bin/", "", "5"),
    tarEntry(
      "package/bin/chainlesschain.js",
      `#!/usr/bin/env node\nconsole.log("${version}");\n`,
    ),
  ]);
}

/** Registry version-manifest for a tgz built above, with REAL sha512. */
function metaFor(version, tgz) {
  return {
    name: "chainlesschain",
    version,
    dist: {
      tarball: `https://registry.npmjs.org/chainlesschain/-/chainlesschain-${version}.tgz`,
      integrity:
        "sha512-" + crypto.createHash("sha512").update(tgz).digest("base64"),
    },
  };
}

/** In-memory fs fake matching the subset managed-cli-flow uses. */
function memFs() {
  const files = new Map();
  const dirs = new Set();
  const norm = (p) => path.resolve(String(p));
  const addDirChain = (p) => {
    let cur = norm(p);
    while (true) {
      dirs.add(cur);
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  };
  return {
    files,
    dirs,
    norm,
    existsSync: (p) => files.has(norm(p)) || dirs.has(norm(p)),
    readFileSync: (p, enc) => {
      const v = files.get(norm(p));
      if (v === undefined) throw new Error("ENOENT: " + p);
      return enc ? v.toString("utf-8") : v;
    },
    writeFileSync: (p, data) => {
      addDirChain(path.dirname(norm(p)));
      files.set(
        norm(p),
        Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf-8"),
      );
    },
    mkdirSync: (p) => addDirChain(p),
    rmSync: (p) => {
      const prefix = norm(p);
      for (const k of [...files.keys()]) {
        if (k === prefix || k.startsWith(prefix + path.sep)) files.delete(k);
      }
      for (const k of [...dirs]) {
        if (k === prefix || k.startsWith(prefix + path.sep)) dirs.delete(k);
      }
    },
    chmodSync: () => {},
  };
}

// ---------------------------------------------------------------------------
// Fixture-locked twin contract
// ---------------------------------------------------------------------------

describe("planManagedInstall (twin fixture: plan-cases.json)", () => {
  const registryMeta = fixture("registry-meta.json");
  for (const c of fixture("plan-cases.json")) {
    it(c.name, () => {
      const res = planManagedInstall({
        requestedVersion: c.input.requestedVersion,
        registryMeta:
          c.input.metaRef == null ? undefined : registryMeta[c.input.metaRef],
        floorVersion: c.input.floorVersion,
      });
      expect(res).toEqual(c.expected);
    });
  }
});

describe("verifyTarball (twin fixture: verify-cases.json)", () => {
  for (const c of fixture("verify-cases.json")) {
    it(c.name, () => {
      const res = verifyTarball(
        Buffer.from(c.payloadUtf8, "utf-8"),
        c.integrity,
      );
      for (const [k, v] of Object.entries(c.expected)) {
        expect(res[k], k).toEqual(v);
      }
    });
  }

  it("fails on a tampered real byte (decoded-buffer flip, not a string edit)", () => {
    const tgz = makeCliTgz("1.0.0");
    const plan = planManagedInstall({ registryMeta: metaFor("1.0.0", tgz) });
    const tampered = Buffer.from(tgz);
    tampered[0] ^= 0xff;
    expect(verifyTarball(tgz, plan.integrity).ok).toBe(true);
    expect(verifyTarball(tampered, plan.integrity).ok).toBe(false);
  });
});

describe("state machine (twin fixture: state-cases.json)", () => {
  for (const c of fixture("state-cases.json")) {
    it(c.name, () => {
      const res =
        c.op === "next"
          ? nextState(c.input)
          : rollbackPlan(
              c.input.state,
              (v) => c.input.diskVersions.includes(v),
              { now: c.input.now },
            );
      expect(res).toEqual(c.expected);
    });
  }

  it("parseStateJson survives corruption", () => {
    expect(parseStateJson("not json")).toBe(null);
    expect(parseStateJson(JSON.stringify({ nope: 1 }))).toBe(null);
    expect(
      parseStateJson(
        JSON.stringify({
          version: "1.0.0",
          installedAt: 5,
          previousVersion: null,
        }),
      ),
    ).toEqual({ version: "1.0.0", installedAt: 5, previousVersion: null });
  });
});

describe("deriveCliCandidates (twin fixture: candidate-cases.json)", () => {
  for (const c of fixture("candidate-cases.json")) {
    it(c.name, () => {
      expect(deriveCliCandidates(c.input)).toEqual(c.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Tar extraction
// ---------------------------------------------------------------------------

describe("tar extraction", () => {
  it("extracts a normal npm-layout tgz (files + dirs + modes)", () => {
    const res = extractPackage(makeCliTgz("2.0.0"));
    expect(res.error).toBeUndefined();
    const paths = res.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "package/bin/chainlesschain.js",
      "package/package.json",
    ]);
    expect(res.dirs).toContain("package/bin");
    const bin = res.files.find(
      (f) => f.path === "package/bin/chainlesschain.js",
    );
    expect(bin.data.toString("utf-8")).toContain('console.log("2.0.0")');
  });

  it("PaxHeader path override wins over the truncated header name", () => {
    const longPath =
      "package/very/long/" + "sub/".repeat(30) + "deeply-nested-file.js";
    const tgz = makeTgz([
      tarEntry("package/PaxHeader/x", paxRecord("path", longPath), "x"),
      tarEntry("package/short-truncated-name", "long path content"),
      tarEntry("package/package.json", "{}"),
    ]);
    const parsed = parseTarEntries(zlib.gunzipSync(tgz));
    const names = parsed.entries.map((e) => e.path);
    expect(names).toContain(longPath);
    expect(names).not.toContain("package/short-truncated-name");
    const res = extractPackage(tgz);
    expect(res.files.map((f) => f.path)).toContain(longPath);
  });

  it("GNU @LongLink long name applies to the following entry", () => {
    const longName = "package/gnu/" + "x".repeat(150) + ".js";
    const tgz = makeTgz([
      tarEntry("././@LongLink", longName + "\0", "L"),
      tarEntry("package/gnu-trunc", "gnu long content"),
    ]);
    const res = extractPackage(tgz);
    expect(res.error).toBeUndefined();
    expect(res.files.map((f) => f.path)).toEqual([longName]);
  });

  it("ustar prefix field is prepended to the name", () => {
    const tgz = makeTgz([
      tarEntry("file.txt", "prefixed", "0", { prefix: "package/deep/nested" }),
    ]);
    const res = extractPackage(tgz);
    expect(res.files.map((f) => f.path)).toEqual([
      "package/deep/nested/file.txt",
    ]);
  });

  it("rejects zip-slip `..` traversal", () => {
    const tgz = makeTgz([
      tarEntry("package/../../evil.txt", "pwned"),
      tarEntry("package/package.json", "{}"),
    ]);
    expect(extractPackage(tgz)).toEqual({
      error: "unsafe-path",
      path: "package/../../evil.txt",
    });
  });

  it("rejects a pax-smuggled zip-slip path too", () => {
    const tgz = makeTgz([
      tarEntry(
        "package/PaxHeader/x",
        paxRecord("path", "package/../../evil"),
        "x",
      ),
      tarEntry("package/innocent", "x"),
    ]);
    expect(extractPackage(tgz).error).toBe("unsafe-path");
  });

  it("rejects absolute paths, drive letters and backslashes", () => {
    for (const bad of ["/etc/passwd", "C:/evil.txt", "package\\evil.js"]) {
      const res = extractPackage(makeTgz([tarEntry(bad, "x")]));
      expect(res.error, bad).toBe("unsafe-path");
    }
  });

  it("rejects entries outside package/ (unexpected layout, fail-closed)", () => {
    const res = extractPackage(makeTgz([tarEntry("other/file.js", "x")]));
    expect(res.error).toBe("unexpected-layout");
  });

  it("enforces the file-count and total-size caps", () => {
    const entries = [
      tarEntry("package/a.js", "1"),
      tarEntry("package/b.js", "2"),
      tarEntry("package/c.js", "3"),
    ];
    expect(extractPackage(makeTgz(entries), { maxFiles: 2 }).error).toBe(
      "too-many-files",
    );
    expect(extractPackage(makeTgz(entries), { maxTotalBytes: 2 }).error).toBe(
      "too-large",
    );
  });

  it("skips links/devices, ignores global pax headers, flags corruption", () => {
    const linkEntry = tarEntry("package/evil-symlink", "", "2");
    const tgz = makeTgz([
      tarEntry("package/PaxHeader/g", paxRecord("comment", "hi"), "g"),
      linkEntry,
      tarEntry("package/real.js", "ok"),
    ]);
    const res = extractPackage(tgz);
    expect(res.files.map((f) => f.path)).toEqual(["package/real.js"]);

    const corrupt = makeTar([tarEntry("package/x.js", "y")]);
    corrupt[0] ^= 0xff; // breaks the header checksum
    expect(parseTarEntries(corrupt).error).toBe("tar-checksum-mismatch");
    expect(extractPackage(Buffer.from("not gzip"))).toEqual({
      error: "gunzip-failed",
    });
  });

  it("an all-dirs archive is an empty package (nothing runnable)", () => {
    expect(extractPackage(makeTgz([tarEntry("package/", "", "5")])).error).toBe(
      "empty-package",
    );
  });
});

// ---------------------------------------------------------------------------
// Binary resolution / shims / node diagnostic
// ---------------------------------------------------------------------------

describe("packageBinEntry", () => {
  it("prefers bin.cc, then the package name, then any entry", () => {
    expect(
      packageBinEntry({
        bin: {
          chainlesschain: "./bin/chainlesschain.js",
          cc: "./bin/cc-alias.js",
        },
      }),
    ).toBe("./bin/cc-alias.js");
    expect(packageBinEntry({ bin: { chainlesschain: "./bin/x.js" } })).toBe(
      "./bin/x.js",
    );
    expect(packageBinEntry({ bin: { other: "./o.js" } })).toBe("./o.js");
    expect(packageBinEntry({ bin: "./cli.js" })).toBe("./cli.js");
    expect(packageBinEntry({})).toBe(null);
    expect(packageBinEntry(null)).toBe(null);
  });
});

describe("resolveManagedBinary", () => {
  const root = path.join("/store", "managed-cli");
  const pkgJson = {
    name: "chainlesschain",
    version: "3.0.0",
    bin: { cc: "./bin/chainlesschain.js" },
  };
  const entry = path.join(root, "3.0.0", "package", "bin", "chainlesschain.js");

  it("resolves state → node entry", () => {
    const known = new Set([
      path.join(root, "3.0.0", "package", "package.json"),
      entry,
    ]);
    const res = resolveManagedBinary(
      root,
      { version: "3.0.0", installedAt: 1, previousVersion: null },
      { exists: (p) => known.has(p), readJson: () => pkgJson },
    );
    expect(res).toEqual({ version: "3.0.0", entry, nodeArgs: [entry] });
  });

  it("null on missing state / package.json / entry", () => {
    expect(resolveManagedBinary(root, null, { exists: () => true })).toBe(null);
    expect(
      resolveManagedBinary(
        root,
        { version: "3.0.0" },
        { exists: () => false, readJson: () => pkgJson },
      ),
    ).toBe(null);
    const onlyPkg = new Set([
      path.join(root, "3.0.0", "package", "package.json"),
    ]);
    expect(
      resolveManagedBinary(
        root,
        { version: "3.0.0" },
        { exists: (p) => onlyPkg.has(p), readJson: () => pkgJson },
      ),
    ).toBe(null);
  });
});

describe("launcher shims + spawn command", () => {
  it("wraps the entry in node for both platforms", () => {
    const s = buildLauncherScripts({ entryPath: "/store/v/package/bin/cc.js" });
    expect(s.windows.name).toBe("cc-managed.cmd");
    expect(s.windows.content).toBe(
      '@ECHO OFF\r\nnode "/store/v/package/bin/cc.js" %*\r\n',
    );
    expect(s.posix.name).toBe("cc-managed");
    expect(s.posix.content).toBe(
      '#!/bin/sh\nexec node "/store/v/package/bin/cc.js" "$@"\n',
    );
    expect(s.posix.mode).toBe(0o755);
  });

  it("refuses unquotable entry paths (fail-closed)", () => {
    expect(buildLauncherScripts({ entryPath: 'a"b.js' })).toEqual({
      error: "unquotable-entry-path",
    });
    expect(buildLauncherScripts({})).toEqual({
      error: "unquotable-entry-path",
    });
  });

  it("shimName + commandForSpawn quoting rules", () => {
    expect(shimName("win32")).toBe("cc-managed.cmd");
    expect(shimName("linux")).toBe("cc-managed");
    // Windows spawns use shell:true → whitespace must be pre-quoted for cmd.exe.
    expect(
      commandForSpawn("C:\\Users\\Some One\\s\\cc-managed.cmd", "win32"),
    ).toBe('"C:\\Users\\Some One\\s\\cc-managed.cmd"');
    expect(commandForSpawn("C:\\store\\cc-managed.cmd", "win32")).toBe(
      "C:\\store\\cc-managed.cmd",
    );
    // POSIX spawns have no shell → the raw path is correct even with spaces.
    expect(commandForSpawn("/a b/cc-managed", "linux")).toBe("/a b/cc-managed");
  });
});

describe("managedNodeDiagnostic (明确诊断: managed impossible without node)", () => {
  it("ok on a new-enough node", () => {
    expect(
      managedNodeDiagnostic({
        nodeVersionOutput: "v22.16.0\n",
        minNodeVersion: "22.12.0",
      }),
    ).toEqual({ ok: true, version: "22.16.0" });
  });
  it("no-node when nothing on PATH answered", () => {
    for (const out of [null, "", "'node' is not recognized"]) {
      expect(
        managedNodeDiagnostic({
          nodeVersionOutput: out,
          minNodeVersion: "22.12.0",
        }),
      ).toEqual({ ok: false, reason: "no-node" });
    }
  });
  it("node-too-old below the cc engines floor", () => {
    expect(
      managedNodeDiagnostic({
        nodeVersionOutput: "v18.19.0",
        minNodeVersion: "22.12.0",
      }),
    ).toEqual({ ok: false, reason: "node-too-old", version: "18.19.0" });
  });
});

describe("registryMetaUrl", () => {
  it("targets the version (or latest) manifest, not the packument", () => {
    expect(registryMetaUrl()).toBe(
      "https://registry.npmjs.org/chainlesschain/latest",
    );
    expect(registryMetaUrl("0.162.158")).toBe(
      "https://registry.npmjs.org/chainlesschain/0.162.158",
    );
  });
});

// ---------------------------------------------------------------------------
// cli-binary integration (candidate source ordering in the real resolver)
// ---------------------------------------------------------------------------

describe("resolveCliBinary + getManaged", () => {
  it("uses the managed command only when every global probe fails", async () => {
    const bin = await resolveCliBinary({
      configuredPath: "cc",
      getVersionOf: () => Promise.resolve(null),
      getManaged: () => ({ command: "/store/cc-managed", version: "1.0.0" }),
    });
    expect(bin).toBe("/store/cc-managed");
  });

  it("a usable global wins over managed (never consulted)", async () => {
    let consulted = 0;
    const bin = await resolveCliBinary({
      configuredPath: "cc",
      getVersionOf: (b) => Promise.resolve(b === "cc" ? "0.162.158" : null),
      getManaged: () => {
        consulted++;
        return { command: "/store/cc-managed" };
      },
    });
    expect(bin).toBe("cc");
    expect(consulted).toBe(0);
  });

  it("an explicit configured path wins and managed is NEVER consulted (iron rule)", async () => {
    let consulted = 0;
    const bin = await resolveCliBinary({
      configuredPath: "/opt/broken/cc",
      getVersionOf: () => Promise.resolve(null),
      getManaged: () => {
        consulted++;
        return { command: "/store/cc-managed" };
      },
    });
    expect(bin).toBe("/opt/broken/cc");
    expect(consulted).toBe(0);
  });

  it("falls back to cc when managed resolution yields nothing / throws", async () => {
    expect(
      await resolveCliBinary({
        configuredPath: "cc",
        getVersionOf: () => Promise.resolve(null),
        getManaged: () => null,
      }),
    ).toBe("cc");
    expect(
      await resolveCliBinary({
        configuredPath: "cc",
        getVersionOf: () => Promise.resolve(null),
        getManaged: () => {
          throw new Error("boom");
        },
      }),
    ).toBe("cc");
  });

  it("without getManaged the behavior is unchanged (backward compat)", async () => {
    expect(
      await resolveCliBinary({
        configuredPath: "cc",
        getVersionOf: () => Promise.resolve(null),
      }),
    ).toBe("cc");
  });
});

// ---------------------------------------------------------------------------
// Full install / resolve / rollback flow (injected IO, no network, no disk)
// ---------------------------------------------------------------------------

describe("runManagedInstall / runManagedRollback flow", () => {
  const root = path.join("/store", "managed-cli");

  function ioFor(fs, byVersion, requested = "latest") {
    return {
      fetchJson: async (url) => {
        // "latest" resolves to the highest version we stubbed
        const versions = Object.keys(byVersion);
        const v =
          requested === "latest" ? versions[versions.length - 1] : requested;
        expect(url).toContain("registry.npmjs.org/chainlesschain/");
        return byVersion[v]?.meta || null;
      },
      fetchBuffer: async (url) => {
        const hit = Object.values(byVersion).find(
          (x) => x.meta.dist.tarball === url,
        );
        return hit ? hit.tgz : null;
      },
      fs,
      now: () => 1111,
      platform: "linux",
    };
  }

  function stub(version) {
    const tgz = makeCliTgz(version);
    return { tgz, meta: metaFor(version, tgz) };
  }

  it("install → state + shims + immediately resolvable command", async () => {
    const fs = memFs();
    const byVersion = { "9.9.9": stub("9.9.9") };
    const res = await runManagedInstall({
      rootDir: root,
      io: ioFor(fs, byVersion),
    });
    expect(res.ok).toBe(true);
    expect(res.version).toBe("9.9.9");
    const state = readManagedState(root, fs);
    expect(state).toEqual({
      version: "9.9.9",
      installedAt: 1111,
      previousVersion: null,
    });
    // Both shims exist and point at the extracted entry via PATH `node`.
    const posixShim = fs.readFileSync(path.join(root, "cc-managed"), "utf-8");
    expect(posixShim).toContain("exec node ");
    expect(posixShim).toContain("chainlesschain.js");
    expect(fs.existsSync(path.join(root, "cc-managed.cmd"))).toBe(true);
    // The session can use it immediately.
    const resolved = resolveManagedCommand(root, { fs, platform: "linux" });
    expect(resolved.version).toBe("9.9.9");
    expect(resolved.command).toBe(path.join(root, "cc-managed"));
    expect(res.command).toBe(resolved.command);
  });

  it("a tampered download is rejected at verify and writes NOTHING", async () => {
    const fs = memFs();
    const { tgz, meta } = stub("9.9.9");
    const evil = Buffer.from(tgz);
    evil[evil.length - 1] ^= 0x01;
    const res = await runManagedInstall({
      rootDir: root,
      io: {
        fetchJson: async () => meta,
        fetchBuffer: async () => evil,
        fs,
        now: () => 1,
        platform: "linux",
      },
    });
    expect(res).toMatchObject({
      ok: false,
      step: "verify",
      error: "integrity-mismatch",
    });
    expect(fs.files.size).toBe(0);
    expect(readManagedState(root, fs)).toBe(null);
  });

  it("a below-floor registry version is refused at plan time", async () => {
    const fs = memFs();
    const { meta } = stub("0.1.0");
    const res = await runManagedInstall({
      rootDir: root,
      floorVersion: "0.162.47",
      io: {
        fetchJson: async () => meta,
        fetchBuffer: async () => {
          throw new Error("must not download");
        },
        fs,
        now: () => 1,
        platform: "linux",
      },
    });
    expect(res).toMatchObject({
      ok: false,
      step: "plan",
      error: "below-floor",
    });
  });

  it("upgrade records the rollback target; rollback restores it one step", async () => {
    const fs = memFs();
    await runManagedInstall({
      rootDir: root,
      io: ioFor(fs, { "9.9.9": stub("9.9.9") }),
    });
    await runManagedInstall({
      rootDir: root,
      io: ioFor(fs, { "9.9.10": stub("9.9.10") }),
    });
    expect(readManagedState(root, fs)).toEqual({
      version: "9.9.10",
      installedAt: 1111,
      previousVersion: "9.9.9",
    });
    // Shim now targets 9.9.10…
    expect(fs.readFileSync(path.join(root, "cc-managed"), "utf-8")).toContain(
      path.join(root, "9.9.10", "package", "bin", "chainlesschain.js"),
    );
    // …rollback flips it back to 9.9.9 and consumes the slot.
    const rb = runManagedRollback({
      rootDir: root,
      io: { fs, now: () => 2222, platform: "linux" },
    });
    expect(rb.ok).toBe(true);
    expect(rb.version).toBe("9.9.9");
    expect(readManagedState(root, fs)).toEqual({
      version: "9.9.9",
      installedAt: 2222,
      previousVersion: null,
    });
    expect(fs.readFileSync(path.join(root, "cc-managed"), "utf-8")).toContain(
      path.join(root, "9.9.9", "package", "bin", "chainlesschain.js"),
    );
    // A second rollback is gated: nothing to go back to.
    expect(
      runManagedRollback({
        rootDir: root,
        io: { fs, now: () => 3, platform: "linux" },
      }),
    ).toEqual({ ok: false, reason: "no-previous" });
  });

  it("rollback refuses when the previous version dir was wiped", async () => {
    const fs = memFs();
    await runManagedInstall({
      rootDir: root,
      io: ioFor(fs, { "9.9.9": stub("9.9.9") }),
    });
    await runManagedInstall({
      rootDir: root,
      io: ioFor(fs, { "9.9.10": stub("9.9.10") }),
    });
    fs.rmSync(path.join(root, "9.9.9"));
    expect(
      runManagedRollback({
        rootDir: root,
        io: { fs, now: () => 3, platform: "linux" },
      }),
    ).toEqual({ ok: false, reason: "previous-missing" });
  });

  it("resolveManagedCommand quotes a whitespace shim path on win32 only", async () => {
    const spacedRoot = path.join("/Users", "Some One", "managed-cli");
    const fs = memFs();
    await runManagedInstall({
      rootDir: spacedRoot,
      io: { ...ioFor(fs, { "9.9.9": stub("9.9.9") }), platform: "win32" },
    });
    const win = resolveManagedCommand(spacedRoot, { fs, platform: "win32" });
    expect(win.command).toBe(`"${path.join(spacedRoot, "cc-managed.cmd")}"`);
    const nix = resolveManagedCommand(spacedRoot, { fs, platform: "linux" });
    expect(nix.command).toBe(path.join(spacedRoot, "cc-managed"));
  });

  it("resolveManagedCommand is null with no install / corrupt state / missing shim", () => {
    const fs = memFs();
    expect(resolveManagedCommand(root, { fs, platform: "linux" })).toBe(null);
    fs.writeFileSync(path.join(root, STATE_FILE), "corrupt{{{");
    expect(resolveManagedCommand(root, { fs, platform: "linux" })).toBe(null);
  });

  it("missing fetch IO is an explicit plan-step failure (no defaults sneak network in)", async () => {
    const res = await runManagedInstall({ rootDir: root, io: { fs: memFs() } });
    expect(res).toMatchObject({
      ok: false,
      step: "plan",
      error: "no-fetch-io",
    });
  });
});
