"use strict";

// Native-process evidence for the import-only Linux persistence layer. This
// probe exercises real files and child/worker readers; it does not claim that
// a production shell has been revoked before a remote writer returns.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("node:worker_threads");
const domain = require("../../src/lib/settings-authority-domain.cjs");
const record = require("../../src/lib/settings-authority-record.cjs");
const {
  observeSettingsSources,
} = require("../../src/lib/settings-source-observation.cjs");

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const allow = '{"permissions":{"allow":["Bash"]}}\n';
const deny = '{"permissions":{"deny":["Bash"]}}\n';

function observe(contexts) {
  return contexts.map((context) =>
    record.createManifest({
      contextId: context.contextId,
      discovery: context.discovery,
      sources: observeSettingsSources(
        context.sources.map((source) => source.logicalPath),
      ),
    }),
  );
}

function replace(file, bytes) {
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  const parent = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}

function change(handle, bytes, options = {}) {
  const descriptor = domain.exportSettingsAuthorityDomain(handle);
  const file = path.join(
    descriptor.forbiddenRoots[0].logicalPath,
    "settings.json",
  );
  return domain.transitionSettingsAuthority(handle, {
    intent: {
      kind: "write",
      physicalPath: file,
      after: {
        exists: true,
        byteLength: Buffer.byteLength(bytes),
        digest: digest(bytes),
      },
    },
    observeContexts: observe,
    replace: () => replace(file, bytes),
    revokeLocal: () => {},
    ...options,
  });
}

function fixture({ exists = true, runtimeFs = fs } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-domain-"));
  const directory = path.join(base, "external");
  const config = path.join(base, "config");
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.mkdirSync(config, { mode: 0o700 });
  const file = path.join(config, "settings.json");
  if (exists) fs.writeFileSync(file, allow, { mode: 0o600 });
  const manifest = record.createManifest({
    contextId: "project-a",
    discovery: [config],
    sources: observeSettingsSources([
      file,
      path.join(config, "settings.local.json"),
    ]),
  });
  const options = {
    directory,
    forbiddenRoots: [config],
    contexts: [manifest],
    observeContexts: observe,
    _fs: runtimeFs,
  };
  const handle = domain.initializeSettingsAuthorityDomain(options);
  return {
    base,
    directory,
    config,
    file,
    options,
    handle,
    descriptor: domain.exportSettingsAuthorityDomain(handle),
    cleanup() {
      try {
        domain.closeSettingsAuthorityDomain(handle);
      } catch {
        /* may already be closed */
      }
      assert.equal(path.dirname(base), fs.realpathSync(os.tmpdir()));
      assert.ok(path.basename(base).startsWith("cc-settings-domain-"));
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function childRequest(descriptor, command = "read", data = {}) {
  const result = spawnSync(process.execPath, [__filename, command], {
    input: JSON.stringify({ descriptor, ...data }),
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      CHAINLESSCHAIN_HOME: "/unrelated-home",
      CC_MACHINE_SECURITY_ANCHOR: "/unrelated-anchor",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return { result: JSON.parse(result.stdout), stderr: result.stderr };
}

function serve(payload, command) {
  let handle;
  try {
    handle = domain.reopenSettingsAuthorityDomain({
      descriptor: payload.descriptor,
    });
    if (command === "write") change(handle, payload.bytes);
    if (command === "recover")
      domain.recoverSettingsAuthority(handle, {
        transactionId: payload.transactionId,
        observeContexts: observe,
        outcome: payload.outcome,
      });
    const { snapshot } = domain.readSettingsAuthority(handle, {
      observeContexts: observe,
    });
    return {
      status: "ready",
      generation: snapshot.generation,
      digest: snapshot.digest,
    };
  } catch (error) {
    return { status: "denied", code: error.code };
  } finally {
    if (handle) domain.closeSettingsAuthorityDomain(handle);
  }
}

function faultFs() {
  let armed = null;
  let activePhase = null;
  let ledgerOpens = 0;
  let operation = "throw";
  const descriptors = new Map();
  function hit(point, action) {
    if (armed !== point) return action();
    armed = null;
    if (operation === "kill") process.kill(process.pid, "SIGKILL");
    throw Object.assign(new Error(`injected ${point}`), { code: "EIO" });
  }
  const runtimeFs = {
    ...fs,
    openSync(file, ...args) {
      const name = typeof file === "string" ? path.basename(file) : "";
      let phase = null;
      if (name.startsWith(".guard.json.")) phase = "guard";
      if (name.startsWith(".ledger.json."))
        phase = ++ledgerOpens === 1 ? "prepared" : "ready";
      if (name.startsWith(".namespace.json.")) phase = "namespace";
      const fd = phase
        ? hit(`${phase}:open`, () => fs.openSync(file, ...args))
        : fs.openSync(file, ...args);
      if (phase) descriptors.set(fd, phase);
      return fd;
    },
    writeFileSync(fd, ...args) {
      const phase = descriptors.get(fd);
      return phase
        ? hit(`${phase}:write`, () => fs.writeFileSync(fd, ...args))
        : fs.writeFileSync(fd, ...args);
    },
    fsyncSync(fd) {
      const phase = descriptors.get(fd);
      if (phase) return hit(`${phase}:file-fsync`, () => fs.fsyncSync(fd));
      if (activePhase && fs.fstatSync(fd).isDirectory()) {
        const current = activePhase;
        activePhase = null;
        return hit(`${current}:directory-fsync`, () => fs.fsyncSync(fd));
      }
      return fs.fsyncSync(fd);
    },
    closeSync(fd) {
      descriptors.delete(fd);
      return fs.closeSync(fd);
    },
    renameSync(from, to) {
      const name = path.basename(from);
      let phase = name.startsWith(".guard.json.")
        ? "guard"
        : name.startsWith(".namespace.json.")
          ? "namespace"
          : name.startsWith(".ledger.json.")
            ? ledgerOpens === 1
              ? "prepared"
              : "ready"
            : null;
      if (!phase) return fs.renameSync(from, to);
      return hit(`${phase}:rename`, () => {
        fs.renameSync(from, to);
        activePhase = phase;
      });
    },
    unlinkSync(file) {
      if (path.basename(file) !== "guard.json") return fs.unlinkSync(file);
      return hit("cleanup:unlink", () => {
        fs.unlinkSync(file);
        activePhase = "cleanup";
      });
    },
  };
  return {
    runtimeFs,
    arm(point, kind = "throw") {
      armed = point;
      activePhase = null;
      ledgerOpens = 0;
      operation = kind;
    },
  };
}

async function runProbe() {
  if (process.platform !== "linux") {
    assert.throws(() => domain.pinSettingsAuthorityDomain({}), {
      code: "CC_SETTINGS_AUTHORITY_PLATFORM_UNSUPPORTED",
    });
    return {
      schema: "settings-authority-domain-probe/v1",
      supported: false,
      passed: 1,
      cases: ["unsupported-platform-denied"],
    };
  }
  const cases = [];
  async function check(name, callback, options) {
    const f = fixture(options);
    try {
      await callback(f);
      cases.push(name);
    } finally {
      f.cleanup();
    }
  }
  await check("pinned-fresh-reader-and-quiet-cjs", (f) => {
    const before = domain.readSettingsAuthority(f.handle, {
      observeContexts: observe,
    });
    assert.equal(
      before.snapshot,
      domain.readSettingsAuthority(f.handle, { observeContexts: observe })
        .snapshot,
    );
    const child = childRequest(f.descriptor);
    assert.deepEqual(child.result, {
      status: "ready",
      generation: 0,
      digest: before.snapshot.digest,
    });
    assert.equal(child.stderr, "");
    assert.throws(
      () => domain.readSettingsAuthority({}, { observeContexts: observe }),
      { code: "CC_SETTINGS_AUTHORITY_DOMAIN_INVALID" },
    );
  });
  await check("true-noop-and-reentry", (f) => {
    let revoked = 0;
    const before = domain.readSettingsAuthority(f.handle, {
      observeContexts: observe,
    }).snapshot;
    assert.equal(
      change(f.handle, allow, {
        revokeLocal() {
          revoked++;
        },
      }).changed,
      false,
    );
    assert.equal(revoked, 0);
    assert.equal(
      domain.readSettingsAuthority(f.handle, { observeContexts: observe })
        .snapshot,
      before,
    );
    change(f.handle, deny, {
      revokeLocal() {
        assert.throws(() => change(f.handle, allow), {
          code: "CC_SETTINGS_AUTHORITY_TRANSITION_FAILED",
        });
      },
    });
  });
  await check("fresh-process-official-aba", (f) => {
    const permit = domain.readSettingsAuthority(f.handle, {
      observeContexts: observe,
    }).snapshot;
    assert.equal(
      childRequest(f.descriptor, "write", { bytes: deny }).result.generation,
      1,
    );
    assert.equal(
      childRequest(f.descriptor, "write", { bytes: allow }).result.generation,
      2,
    );
    const current = domain.readSettingsAuthority(f.handle, {
      observeContexts: observe,
    }).snapshot;
    assert.notEqual(current, permit);
    assert.equal(current.generation, 2);
  });
  await check("worker-reopen-after-aba", async (f) => {
    change(f.handle, deny);
    change(f.handle, allow);
    const worker = new Worker(__filename, {
      workerData: { descriptor: f.descriptor },
    });
    const result = await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code) reject(new Error(`worker ${code}`));
      });
    });
    assert.equal(result.status, "ready");
    assert.equal(result.generation, 2);
    await worker.terminate();
  });
  await check("concurrent-writers-serialized", async (f) => {
    const launch = (bytes) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename, "write"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code) reject(new Error(stderr));
          else resolve(JSON.parse(stdout));
        });
        child.stdin.end(JSON.stringify({ descriptor: f.descriptor, bytes }));
      });
    const results = await Promise.all([
      launch(deny),
      launch('{"permissions":{"ask":["Bash"]}}\n'),
    ]);
    assert.ok(results.every((entry) => entry.status === "ready"));
    assert.equal(
      domain.readSettingsAuthority(f.handle, { observeContexts: observe })
        .snapshot.generation,
      2,
    );
  });
  await check(
    "absent-source-created-with-existing-parent",
    (f) => {
      change(f.handle, allow);
      assert.equal(childRequest(f.descriptor).result.generation, 1);
    },
    { exists: false },
  );
  await check("official-source-removal-consumes-generation", (f) => {
    const before = domain.readSettingsAuthority(f.handle, {
      observeContexts: observe,
    }).snapshot;
    domain.transitionSettingsAuthority(f.handle, {
      intent: {
        kind: "write",
        physicalPath: f.file,
        after: { exists: false, byteLength: 0, digest: null },
      },
      observeContexts: observe,
      revokeLocal() {},
      replace() {
        fs.unlinkSync(f.file);
        const parent = fs.openSync(f.config, "r");
        try {
          fs.fsyncSync(parent);
        } finally {
          fs.closeSync(parent);
        }
      },
    });
    const current = domain.readSettingsAuthority(f.handle, {
      observeContexts: observe,
    }).snapshot;
    assert.notEqual(current, before);
    assert.equal(current.generation, 1);
    assert.equal(childRequest(f.descriptor).result.generation, 1);
  });
  await check("missing-parent-write-denied-before-creation", (f) => {
    const missing = path.join(f.config, "missing", "settings.json");
    const manifest = record.createManifest({
      contextId: "missing-parent",
      discovery: [f.config],
      sources: observeSettingsSources([missing]),
    });
    domain.transitionSettingsAuthority(f.handle, {
      intent: { kind: "register", manifest },
      observeContexts: observe,
      revokeLocal() {},
    });
    assert.throws(
      () =>
        domain.transitionSettingsAuthority(f.handle, {
          intent: {
            kind: "write",
            physicalPath: missing,
            after: {
              exists: true,
              byteLength: Buffer.byteLength(deny),
              digest: digest(deny),
            },
          },
          observeContexts: observe,
          revokeLocal() {
            assert.fail("unsupported parent revoked");
          },
          replace() {
            assert.fail("unsupported parent created");
          },
        }),
      {
        code: "CC_SETTINGS_AUTHORITY_TRANSITION_FAILED",
        authorityState: "unchanged",
      },
    );
    assert.equal(fs.existsSync(path.dirname(missing)), false);
    assert.equal(childRequest(f.descriptor).result.generation, 1);
  });
  await check("new-context-register-and-alias-rollback-refused", (f) => {
    const alias = path.join(f.base, "alias");
    fs.symlinkSync(f.config, alias, "dir");
    const manifest = record.createManifest({
      contextId: "alias-context",
      discovery: [alias],
      sources: observeSettingsSources([path.join(alias, "settings.json")]),
    });
    assert.equal(
      domain.transitionSettingsAuthority(f.handle, {
        intent: { kind: "register", manifest },
        observeContexts: observe,
        revokeLocal() {},
      }).generation,
      1,
    );
    assert.equal(
      domain.transitionSettingsAuthority(f.handle, {
        intent: { kind: "register", manifest },
        observeContexts: observe,
        revokeLocal() {
          assert.fail("no-op revoked");
        },
      }).changed,
      false,
    );
    const stale = manifest;
    change(f.handle, deny);
    assert.throws(
      () =>
        domain.transitionSettingsAuthority(f.handle, {
          intent: {
            kind: "register",
            manifest: { ...stale, contextId: "stale-context" },
          },
          observeContexts: observe,
          revokeLocal() {},
        }),
      { code: "CC_SETTINGS_AUTHORITY_TRANSITION_FAILED" },
    );
  });
  await check("raw-rollback-and-source-removal-denied", (f) => {
    replace(f.file, deny);
    replace(f.file, allow);
    assert.equal(childRequest(f.descriptor).result.status, "denied");
    fs.unlinkSync(f.file);
    assert.equal(childRequest(f.descriptor).result.status, "denied");
  });
  await check("discovery-and-local-revision-bracket", (f) => {
    const revision = {};
    let now = revision;
    const options = { observeContexts: observe, localRevision: () => now };
    const original = domain.readSettingsAuthority(f.handle, options).snapshot;
    now = {};
    const advanced = domain.readSettingsAuthority(f.handle, options).snapshot;
    assert.notEqual(advanced, original);
    now = revision;
    assert.notEqual(
      domain.readSettingsAuthority(f.handle, options).snapshot,
      original,
    );
    assert.throws(
      () =>
        domain.readSettingsAuthority(f.handle, {
          localRevision: () => now,
          observeContexts(contexts) {
            now = {};
            return observe(contexts);
          },
        }),
      { code: "CC_SETTINGS_AUTHORITY_CHANGED" },
    );
    assert.throws(
      () =>
        domain.readSettingsAuthority(f.handle, {
          observeContexts(contexts) {
            return observe(contexts).map((entry) => ({
              ...entry,
              discovery: [f.base],
            }));
          },
        }),
      { code: "CC_SETTINGS_AUTHORITY_BINDING_CHANGED" },
    );
  });
  await check("context-cannot-enroll-authority-domain", (f) => {
    const manifest = record.createManifest({
      contextId: "external-context",
      discovery: [f.directory],
      sources: observeSettingsSources([
        path.join(f.directory, "namespace.json"),
      ]),
    });
    assert.throws(
      () =>
        domain.transitionSettingsAuthority(f.handle, {
          intent: { kind: "register", manifest },
          observeContexts: observe,
          revokeLocal() {
            assert.fail("invalid enrollment revoked");
          },
        }),
      {
        code: "CC_SETTINGS_AUTHORITY_TRANSITION_FAILED",
        authorityState: "unchanged",
      },
    );
    assert.equal(childRequest(f.descriptor).result.generation, 0);
  });
  await check("unregistered-write-cannot-touch-source-lock", (f) => {
    const unrelated = path.join(f.base, "unrelated.json");
    const runtimeFs = {
      ...fs,
      mkdirSync(file, ...args) {
        assert.ok(
          !String(file).startsWith(`${unrelated}.lock`),
          "unregistered path touched",
        );
        return fs.mkdirSync(file, ...args);
      },
    };
    const handle = domain.reopenSettingsAuthorityDomain({
      descriptor: f.descriptor,
      _fs: runtimeFs,
    });
    try {
      assert.throws(
        () =>
          domain.transitionSettingsAuthority(handle, {
            intent: {
              kind: "write",
              physicalPath: unrelated,
              after: {
                exists: true,
                byteLength: Buffer.byteLength(deny),
                digest: digest(deny),
              },
            },
            observeContexts: observe,
            replace() {
              assert.fail("unregistered replace");
            },
            revokeLocal() {
              assert.fail("unregistered revoke");
            },
          }),
        {
          code: "CC_SETTINGS_AUTHORITY_TRANSITION_FAILED",
          authorityState: "unchanged",
        },
      );
      assert.equal(fs.existsSync(unrelated), false);
      assert.equal(fs.existsSync(`${unrelated}.lock`), false);
    } finally {
      domain.closeSettingsAuthorityDomain(handle);
    }
  });
  await check("missing-ledger-surviving-witness-never-bootstraps", (f) => {
    fs.unlinkSync(path.join(f.directory, "ledger.json"));
    assert.equal(childRequest(f.descriptor).result.status, "denied");
    assert.throws(() => domain.initializeSettingsAuthorityDomain(f.options), {
      code: "CC_SETTINGS_AUTHORITY_ALREADY_INITIALIZED",
    });
  });
  for (const name of ["namespace.json", "ledger.json"]) {
    await check(`corrupt-${name}-denied`, (f) => {
      fs.writeFileSync(path.join(f.directory, name), "{", { mode: 0o600 });
      assert.equal(childRequest(f.descriptor).result.status, "denied");
      assert.throws(() => domain.initializeSettingsAuthorityDomain(f.options), {
        code: "CC_SETTINGS_AUTHORITY_ALREADY_INITIALIZED",
      });
    });
    await check(`unreadable-${name}-is-not-absence`, (f) => {
      const runtimeFs = {
        ...fs,
        lstatSync(file, ...args) {
          if (path.basename(file) === name)
            throw Object.assign(new Error("read unavailable"), {
              code: "EACCES",
            });
          return fs.lstatSync(file, ...args);
        },
      };
      if (name === "namespace.json")
        assert.throws(
          () =>
            domain.reopenSettingsAuthorityDomain({
              descriptor: f.descriptor,
              _fs: runtimeFs,
            }),
          { code: "EACCES" },
        );
      else {
        const handle = domain.reopenSettingsAuthorityDomain({
          descriptor: f.descriptor,
          _fs: runtimeFs,
        });
        try {
          assert.throws(
            () =>
              domain.readSettingsAuthority(handle, {
                observeContexts: observe,
              }),
            { code: "EACCES" },
          );
        } finally {
          domain.closeSettingsAuthorityDomain(handle);
        }
      }
    });
  }
  await check("descriptor-tampering-and-storage-redirection-denied", (f) => {
    assert.equal(
      childRequest({
        ...f.descriptor,
        epoch: "00000000-0000-0000-0000-000000000000",
      }).result.status,
      "denied",
    );
    assert.equal(
      childRequest({ ...f.descriptor, directory: f.config }).result.status,
      "denied",
    );
    const alias = path.join(f.base, "config-alias");
    fs.symlinkSync(f.config, alias, "dir");
    assert.throws(
      () =>
        domain.pinSettingsAuthorityDomain({
          directory: f.directory,
          forbiddenRoots: [alias],
        }),
      { code: "CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED" },
    );
  });
  await check("namespace-data-key-order-does-not-change-authority", (f) => {
    function reordered(value) {
      if (Array.isArray(value)) return value.map(reordered);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.keys(value)
          .reverse()
          .map((key) => [key, reordered(value[key])]),
      );
    }
    const descriptor = reordered(f.descriptor);
    replace(
      path.join(f.directory, "namespace.json"),
      `${JSON.stringify(descriptor)}\n`,
    );
    assert.equal(childRequest(descriptor).result.generation, 0);
    assert.equal(
      domain.readSettingsAuthority(f.handle, { observeContexts: observe })
        .snapshot.generation,
      0,
    );
  });
  for (const phase of ["namespace", "prepared"]) {
    for (const step of [
      "open",
      "write",
      "file-fsync",
      "rename",
      "directory-fsync",
    ]) {
      await check(
        `initialize-fault-${phase === "prepared" ? "ledger" : phase}:${step}`,
        (f) => {
          const faults = faultFs();
          const directory = path.join(f.base, "initialization-fault");
          fs.mkdirSync(directory, { mode: 0o700 });
          const options = { ...f.options, directory, _fs: faults.runtimeFs };
          faults.arm(`${phase}:${step}`);
          assert.throws(
            () => domain.initializeSettingsAuthorityDomain(options),
            {
              code: "CC_SETTINGS_AUTHORITY_PERSIST_FAILED",
            },
          );
          if (fs.existsSync(path.join(directory, "namespace.json"))) {
            assert.throws(
              () =>
                domain.initializeSettingsAuthorityDomain({
                  ...options,
                  _fs: fs,
                }),
              { code: "CC_SETTINGS_AUTHORITY_ALREADY_INITIALIZED" },
            );
            const descriptor = JSON.parse(
              fs.readFileSync(path.join(directory, "namespace.json"), "utf8"),
            );
            const fresh = childRequest(descriptor).result;
            if (phase === "prepared" && step === "directory-fsync")
              assert.equal(fresh.status, "ready");
            else assert.equal(fresh.status, "denied");
          } else
            assert.throws(
              () =>
                domain.pinSettingsAuthorityDomain({
                  directory,
                  forbiddenRoots: [f.config],
                }),
              { code: "CC_SETTINGS_AUTHORITY_WITNESS_MISSING" },
            );
        },
      );
    }
  }
  for (const kind of [
    "corrupt",
    "link",
    "hardlink",
    "oversize",
    "permissions",
  ]) {
    await check(`guard-${kind}-denied`, (f) => {
      const guard = path.join(f.directory, "guard.json");
      if (kind === "link") fs.symlinkSync(f.file, guard);
      else if (kind === "hardlink") fs.linkSync(f.file, guard);
      else
        fs.writeFileSync(
          guard,
          kind === "oversize" ? Buffer.alloc(5 * 1024 * 1024) : "{",
          { mode: kind === "permissions" ? 0o644 : 0o600 },
        );
      assert.equal(childRequest(f.descriptor).result.status, "denied");
    });
  }
  await check("external-domain-overlap-and-replacement-denied", (f) => {
    assert.throws(
      () =>
        domain.pinSettingsAuthorityDomain({
          directory: f.directory,
          forbiddenRoots: [f.base],
        }),
      { code: "CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP" },
    );
    domain.closeSettingsAuthorityDomain(f.handle);
    fs.renameSync(f.directory, `${f.directory}.old`);
    fs.mkdirSync(f.directory, { mode: 0o700 });
    for (const name of ["namespace.json", "ledger.json"])
      fs.copyFileSync(
        path.join(`${f.directory}.old`, name),
        path.join(f.directory, name),
      );
    assert.equal(childRequest(f.descriptor).result.status, "denied");
  });
  const points = ["guard", "prepared", "ready"]
    .flatMap((phase) =>
      ["open", "write", "file-fsync", "rename", "directory-fsync"].map(
        (step) => `${phase}:${step}`,
      ),
    )
    .concat(["cleanup:unlink", "cleanup:directory-fsync"]);
  for (const point of points) {
    const faults = faultFs();
    await check(
      `fault-${point}`,
      (f) => {
        faults.arm(point);
        let error;
        try {
          change(f.handle, deny, { transactionId: "fault-txn" });
        } catch (cause) {
          error = cause;
        }
        assert.ok(error, point);
        assert.equal(error.code, "CC_SETTINGS_AUTHORITY_TRANSITION_FAILED");
        const actualNew = fs.readFileSync(f.file, "utf8") === deny;
        assert.equal(
          error.commitState,
          actualNew ? "committed" : "not-committed",
        );
        const fresh = childRequest(f.descriptor).result;
        if (fs.existsSync(path.join(f.directory, "guard.json"))) {
          assert.equal(fresh.status, "denied");
          const recovered = childRequest(f.descriptor, "recover", {
            transactionId: "fault-txn",
            outcome: actualNew ? "after" : "before",
          }).result;
          assert.equal(recovered.status, "ready", JSON.stringify(recovered));
          assert.equal(recovered.generation, 1);
        } else {
          assert.equal(fresh.status, "ready");
          assert.equal(fresh.generation, actualNew ? 1 : 0);
        }
      },
      { runtimeFs: faults.runtimeFs },
    );
  }
  await check("recovery-neither-and-wrong-transaction-denied", (f) => {
    assert.throws(
      () =>
        change(f.handle, deny, {
          transactionId: "proof-txn",
          replace() {
            throw Object.assign(new Error("before replace"), {
              commitState: "not-committed",
            });
          },
        }),
      {
        code: "CC_SETTINGS_AUTHORITY_TRANSITION_FAILED",
        commitState: "not-committed",
        authorityState: "blocked",
      },
    );
    assert.equal(
      childRequest(f.descriptor, "recover", {
        transactionId: "wrong",
        outcome: "before",
      }).result.status,
      "denied",
    );
    replace(f.file, '{"permissions":{}}\n');
    for (const outcome of ["before", "after"])
      assert.equal(
        childRequest(f.descriptor, "recover", {
          transactionId: "proof-txn",
          outcome,
        }).result.status,
        "denied",
      );
    assert.equal(childRequest(f.descriptor).result.status, "denied");
  });
  for (const point of [
    "guard:directory-fsync",
    "prepared:directory-fsync",
    "ready:directory-fsync",
    "cleanup:directory-fsync",
  ]) {
    await check(`kill-${point}`, (f) => {
      const result = spawnSync(process.execPath, [__filename, "kill"], {
        input: JSON.stringify({ descriptor: f.descriptor, point }),
        encoding: "utf8",
        timeout: 20000,
      });
      assert.equal(result.signal, "SIGKILL");
      const actualNew = fs.readFileSync(f.file, "utf8") === deny;
      const fresh = childRequest(f.descriptor).result;
      if (fs.existsSync(path.join(f.directory, "guard.json"))) {
        assert.equal(fresh.status, "denied");
        assert.equal(
          childRequest(f.descriptor, "recover", {
            transactionId: "kill-txn",
            outcome: actualNew ? "after" : "before",
          }).result.status,
          "ready",
        );
      } else assert.equal(fresh.status, "ready");
    });
  }
  return {
    schema: "settings-authority-domain-probe/v1",
    supported: true,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      kernel: os.release(),
    },
    productionIntegration: false,
    sourceFiles: [
      "src/lib/settings-authority-record.cjs",
      "src/lib/settings-authority-domain.cjs",
      "src/lib/settings-source-observation.cjs",
      "src/lib/with-file-lock.js",
      "__tests__/fixtures/settings-authority-domain-probe.cjs",
    ].map((file) => ({
      file,
      sha256: digest(fs.readFileSync(path.join(__dirname, "../..", file))),
    })),
    passed: cases.length,
    cases,
  };
}

if (!isMainThread) parentPort.postMessage(serve(workerData, "read"));
else if (process.argv[2]) {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  if (process.argv[2] === "kill") {
    const faults = faultFs();
    const handle = domain.reopenSettingsAuthorityDomain({
      descriptor: input.descriptor,
      _fs: faults.runtimeFs,
    });
    faults.arm(input.point, "kill");
    change(handle, deny, { transactionId: "kill-txn" });
    assert.fail("kill point did not fire");
  } else process.stdout.write(JSON.stringify(serve(input, process.argv[2])));
} else
  runProbe()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack}\n`);
      process.exitCode = 1;
    });
