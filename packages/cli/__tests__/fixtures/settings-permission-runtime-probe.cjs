"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("node:worker_threads");
const binding = require("../../src/lib/settings-permission-authority.cjs");
const loader = require("../../src/lib/settings-loader.cjs");
const domain = require("../../src/lib/settings-authority-domain.cjs");
const records = require("../../src/lib/settings-authority-record.cjs");
const { createHash } = require("node:crypto");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out: " + label);
    await delay(20);
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-runtime-"));
  const cwd = path.join(root, "workspace");
  const external = path.join(root, "external");
  fs.mkdirSync(cwd, { mode: 0o700 });
  fs.mkdirSync(path.join(cwd, ".claude"), { mode: 0o700 });
  fs.mkdirSync(external, { mode: 0o700 });
  const context = {
    contextId: "workspace",
    cwd,
    userSettingsFile: path.join(root, "user.json"),
    managedSettingsFile: path.join(root, "managed.json"),
    scopedFile: path.join(root, "scoped.json"),
  };
  const file = path.join(cwd, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      permissions: { allow: ["Read"] },
      unrelated: { keep: true },
    }),
    { mode: 0o600 },
  );
  try {
    const launch = binding.initializeSettingsPermissionAuthority({
      directory: external,
      forbiddenRoots: [
        cwd,
        context.userSettingsFile,
        context.managedSettingsFile,
      ],
      contexts: [context],
    });
    const authority = binding.openSettingsPermissionAuthority({
      launch,
      contextId: "workspace",
    });
    return {
      root,
      cwd,
      file,
      launch,
      authority,
      close() {
        binding.closeSettingsPermissionAuthority(authority);
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

async function makeProvider(f, options = {}) {
  const { createPermissionRulesProvider, permissionRulesProviderAuthority } =
    await import("../../src/lib/permission-authority.js");
  const { ScopedPermissionStore } =
    await import("../../src/lib/scoped-permission-store.js");
  const provider = createPermissionRulesProvider({
    cwd: f.cwd,
    settingsAuthority: f.authority,
    scopedStore: new ScopedPermissionStore({
      cwd: f.cwd,
      filePath: path.join(f.root, "scoped.json"),
      settingsAuthority: f.authority,
    }),
    env: {},
    ...options,
  });
  return { provider, owner: permissionRulesProviderAuthority(provider) };
}

async function child(payload) {
  const authority = binding.openSettingsPermissionAuthority({
    launch: payload.launch,
    contextId: "workspace",
  });
  try {
    const cwd = binding.settingsPermissionAuthorityOptions(authority).cwd;
    const before = binding.readSettingsPermissionAuthority(authority).snapshot;
    if (payload.command === "write") {
      const result = loader.addRule({
        cwd,
        kind: payload.kind || "deny",
        rule: payload.rule || "Bash",
        settingsAuthority: authority,
      });
      return {
        result,
        before,
        after: binding.readSettingsPermissionAuthority(authority).snapshot,
      };
    }
    if (payload.command.startsWith("scoped-")) {
      const { ScopedPermissionStore } =
        await import("../../src/lib/scoped-permission-store.js");
      const store = new ScopedPermissionStore({
        cwd,
        filePath:
          binding.settingsPermissionAuthorityOptions(authority).scopedFile,
        settingsAuthority: authority,
      });
      let result;
      if (payload.command === "scoped-revoke")
        result = store.revoke({ id: payload.id });
      else {
        result = store.add({
          decision: payload.kind || "deny",
          rule: payload.rule || "Bash",
          expiresAt: Date.now() + 300000,
        });
        if (payload.command === "scoped-aba") store.revoke({ id: result.id });
      }
      return {
        result,
        before,
        after: binding.readSettingsPermissionAuthority(authority).snapshot,
      };
    }
    return {
      before,
      launch: binding.exportSettingsPermissionAuthority(authority),
    };
  } finally {
    binding.closeSettingsPermissionAuthority(authority);
  }
}

function childSync(f, command = "write", rest = {}) {
  const result = spawnSync(process.execPath, [__filename, "--child"], {
    input: JSON.stringify({ launch: f.launch, command, ...rest }),
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function childAsync(f, rule) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [__filename, "--child"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      processChild.kill();
      reject(new Error("child timeout"));
    }, 15000);
    processChild.stdout.on("data", (chunk) => {
      out += chunk;
    });
    processChild.stderr.on("data", (chunk) => {
      err += chunk;
    });
    processChild.once("error", reject);
    processChild.once("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err));
    });
    processChild.stdin.end(
      JSON.stringify({ launch: f.launch, command: "write", rule }),
    );
  });
}

async function probe() {
  const cases = [];
  if (process.platform !== "linux") {
    assert.throws(fixture, {
      code: "CC_SETTINGS_AUTHORITY_PLATFORM_UNSUPPORTED",
    });
    return {
      schema: "settings-permission-runtime-probe/v1",
      supported: false,
      cases: ["unsupported-platform-denied"],
      passed: 1,
    };
  }
  async function check(name, test) {
    const f = fixture();
    try {
      await test(f);
      cases.push(name);
    } finally {
      f.close();
    }
  }
  await check("production-child-writer-revokes-provider", async (f) => {
    const { provider, owner } = await makeProvider(f);
    const before = owner.getSnapshot();
    const local = loader.getSettingsPermissionRevision();
    const result = childSync(f);
    assert.equal(result.result.added, true);
    assert.equal(result.after.generation, before.durable.generation + 1);
    assert.equal(loader.getSettingsPermissionRevision(), local);
    assert.notEqual(owner.getSnapshot(), before);
    assert.deepEqual(provider().rules.deny, ["Bash"]);
    assert.equal(JSON.parse(fs.readFileSync(f.file)).unrelated.keep, true);
  });
  await check("worker-launch-domain-and-official-write", async (f) => {
    const { owner } = await makeProvider(f);
    const before = owner.getSnapshot();
    const worker = new Worker(__filename, {
      workerData: { launch: f.launch, command: "write" },
    });
    const result = await Promise.race([
      once(worker, "message").then(([value]) => value),
      once(worker, "error").then(([error]) => {
        throw error;
      }),
    ]);
    assert.equal(result.result.added, true);
    await once(worker, "exit");
    assert.notEqual(owner.getSnapshot(), before);
  });
  await check("concurrent-official-writers-preserve-all-rules", async (f) => {
    await Promise.all(
      ["Read", "Write", "Bash", "WebFetch"].map((rule) => childAsync(f, rule)),
    );
    const data = JSON.parse(fs.readFileSync(f.file));
    assert.deepEqual([...data.permissions.deny].sort(), [
      "Bash",
      "Read",
      "WebFetch",
      "Write",
    ]);
    assert.equal(data.unrelated.keep, true);
    assert.equal(
      binding.readSettingsPermissionAuthority(f.authority).snapshot.generation,
      4,
    );
  });
  await check(
    "scoped-child-add-and-revoke-invalidate-durable-provider",
    async (f) => {
      const { provider, owner } = await makeProvider(f);
      const { getScopedPermissionRevision } =
        await import("../../src/lib/scoped-permission-store.js");
      const local = getScopedPermissionRevision();
      const before = owner.getSnapshot();
      const added = childSync(f, "scoped-add", { kind: "allow", rule: "Bash" });
      assert.equal(getScopedPermissionRevision(), local);
      assert.notEqual(owner.getSnapshot(), before);
      assert(provider().rules.allow.includes("Bash"));
      const granted = owner.getSnapshot();
      childSync(f, "scoped-revoke", { id: added.result.id });
      assert.notEqual(owner.getSnapshot(), granted);
      assert(!provider().rules.allow.includes("Bash"));
      assert.equal(
        owner.getSnapshot().durable.generation,
        before.durable.generation + 2,
      );
      const revoked = owner.getSnapshot();
      childSync(f, "scoped-revoke", { id: added.result.id });
      assert.equal(owner.getSnapshot(), revoked);
    },
  );
  await check("scoped-worker-aba-never-restores-old-permit", async (f) => {
    const { provider, owner } = await makeProvider(f);
    const beforeRules = provider().rules;
    const before = owner.getSnapshot();
    const worker = new Worker(__filename, {
      workerData: { launch: f.launch, command: "scoped-aba" },
    });
    const exited = once(worker, "exit");
    await once(worker, "message");
    await exited;
    assert.deepEqual(provider().rules, beforeRules);
    assert.notEqual(owner.getSnapshot(), before);
    assert.equal(
      owner.getSnapshot().durable.generation,
      before.durable.generation + 2,
    );
  });
  await check(
    "local-scoped-notification-and-poll-never-reauthorize",
    async (f) => {
      const { owner } = await makeProvider(f);
      const { ScopedPermissionStore } =
        await import("../../src/lib/scoped-permission-store.js");
      const { createDockerEgressAuthorityMonitor } =
        await import("../../src/lib/sandbox-egress-authority-monitor.js");
      const store = new ScopedPermissionStore({
        cwd: f.cwd,
        filePath: f.launch.contexts[0].scopedFile,
        settingsAuthority: f.authority,
      });
      const initial = owner.getSnapshot();
      const monitor = createDockerEgressAuthorityMonitor({
        revalidate() {
          assert.equal(owner.getSnapshot(), initial);
        },
        abortProxy() {},
      });
      monitor.attachSession({ close() {} });
      const remove = owner.subscribePolicyRevision(() =>
        monitor.revoke(new Error("local revoke")),
      );
      try {
        const rule = store.add({
          decision: "deny",
          rule: "Bash",
          expiresAt: Date.now() + 300000,
        });
        assert.throws(() => monitor.assertAuthorized(), /local revoke/);
        store.revoke({ id: rule.id });
        await delay(220);
        assert.throws(() => monitor.assertAuthorized(), /local revoke/);
        assert.notEqual(owner.getSnapshot(), initial);
      } finally {
        remove();
        monitor.stop();
        await monitor.awaitCleanup();
      }
    },
  );
  await check(
    "admitted-writable-root-cannot-contain-durable-anchor",
    async (f) => {
      const { owner } = await makeProvider(f);
      owner.assertWritableRoots([f.cwd]);
      assert.throws(() => owner.assertWritableRoots([f.root]), {
        code: "CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP",
      });
      assert.throws(
        () => owner.assertWritableRoots([f.launch.domain.directory]),
        { code: "CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP" },
      );
      assert.throws(
        () =>
          owner.assertWritableRoots([
            path.join(f.launch.domain.directory, "ledger.json"),
          ]),
        { code: "CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP" },
      );
    },
  );
  await check(
    "controlled-host-entry-pins-runtime-and-official-writers",
    async (f) => {
      const { openPermissionAuthorityHost } =
        await import("../../src/runtime/permission-authority-host.js");
      const host = openPermissionAuthorityHost({
        launch: f.launch,
        contextId: "workspace",
        env: {},
      });
      try {
        assert.equal(host.runtimeOptions({}).cwd, f.cwd);
        assert.throws(() => host.runtimeOptions({ cwd: f.root }), /mismatch/);
        assert.throws(
          () => host.runtimeOptions({ additionalDirectories: [f.root] }),
          { code: "CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP" },
        );
        const grant = host.addScopedRule({
          decision: "allow",
          rule: "Bash",
          expiresAt: Date.now() + 300000,
        });
        assert(host.readPermissions().rules.allow.includes("Bash"));
        host.revokeScopedRule({ id: grant.id });
        assert(!host.readPermissions().rules.allow.includes("Bash"));
        host.addRule({ kind: "deny", rule: "Bash" });
        assert(
          host
            .runtimeOptions({})
            .permissionRulesProvider()
            .rules.deny.includes("Bash"),
        );
        const { executeTool } = await import("../../src/runtime/agent-core.js");
        const admitted = host.runtimeOptions({});
        const blocked = await executeTool(
          "run_shell",
          { command: "echo must-not-run" },
          admitted,
        );
        assert.equal(blocked.policy.decision, "deny");
        const wrongWorkspace = await executeTool(
          "run_shell",
          { command: "echo must-not-run" },
          { ...admitted, cwd: f.root },
        );
        assert.equal(
          wrongWorkspace.policy.code,
          "CC_SETTINGS_AUTHORITY_BINDING_CHANGED",
        );
        const target = path.join(f.root, "must-not-write");
        const overlap = await executeTool(
          "write_file",
          { path: target, content: "forbidden" },
          { ...admitted, additionalDirectories: [f.root] },
        );
        assert.equal(
          overlap.policy.code,
          "CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP",
        );
        assert.equal(fs.existsSync(target), false);
        let loopOptions;
        const outcome = await host.runHeadless(
          {
            prompt: "Inspect this project",
            permissionMode: "plan",
            useRegisteredMcp: false,
          },
          {
            bootstrap: async () => ({ db: null }),
            getApprovalGate: async () => null,
            writeOut() {},
            writeErr() {},
            agentLoop: async function* (_messages, options) {
              loopOptions = options;
              yield { type: "response-complete", content: "done" };
              yield { type: "run-ended", reason: "complete" };
            },
          },
        );
        assert.equal(outcome.exitCode, 0);
        assert(loopOptions.enabledToolNames.includes("read_file"));
        assert(!loopOptions.enabledToolNames.includes("run_shell"));
        assert(!loopOptions.enabledToolNames.includes("write_file"));
        assert(loopOptions.permissionRules.deny.includes("Bash"));
        assert.equal(
          loopOptions.permissionRulesProvider,
          admitted.permissionRulesProvider,
        );
        assert.deepEqual(host.exportLaunch(), f.launch);
      } finally {
        host.close();
      }
      assert.throws(() => host.runtimeOptions({}), {
        code: "CC_SETTINGS_PERMISSION_BINDING_INVALID",
      });
    },
  );
  await check("idempotent-official-write-keeps-token-and-bytes", async (f) => {
    const { owner } = await makeProvider(f);
    loader.addRule({
      cwd: f.cwd,
      kind: "deny",
      rule: "Bash",
      settingsAuthority: f.authority,
    });
    const before = owner.getSnapshot();
    const bytes = fs.readFileSync(f.file);
    assert.equal(
      loader.addRule({
        cwd: f.cwd,
        kind: "deny",
        rule: "Bash",
        settingsAuthority: f.authority,
      }).added,
      false,
    );
    assert.equal(owner.getSnapshot(), before);
    assert.deepEqual(fs.readFileSync(f.file), bytes);
  });
  await check(
    "stale-snapshot-cas-refuses-before-revoke-or-replace",
    async (f) => {
      const current = binding.readSettingsPermissionAuthority(f.authority);
      const handle = domain.reopenSettingsAuthorityDomain({
        descriptor: f.launch.domain,
      });
      const bytes = Buffer.from(
        JSON.stringify({ permissions: { deny: ["Write"] } }),
      );
      childSync(f);
      let called = false;
      const observeContexts = () =>
        f.launch.contexts.map((context) =>
          records.createManifest({
            contextId: context.contextId,
            discovery: [
              context.cwd,
              context.userSettingsFile,
              context.managedSettingsFile,
              context.scopedFile,
            ],
            sources: [
              ...loader.inspectSettingsSources(context).sources,
              require("../../src/lib/settings-source-observation.cjs").observeSettingsSources(
                [context.scopedFile],
              )[0],
            ],
          }),
        );
      try {
        assert.throws(
          () =>
            domain.transitionSettingsAuthority(handle, {
              expectedSnapshot: current.snapshot,
              observeContexts,
              intent: {
                kind: "write",
                physicalPath: f.file,
                after: {
                  exists: true,
                  byteLength: bytes.length,
                  digest: createHash("sha256").update(bytes).digest("hex"),
                },
              },
              revokeLocal() {
                called = true;
              },
              replace() {
                called = true;
              },
            }),
          (error) =>
            error.cause?.code === "CC_SETTINGS_AUTHORITY_CONFLICT" &&
            error.commitState === "not-committed",
        );
        assert.equal(called, false);
        assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).permissions.deny, [
          "Bash",
        ]);
      } finally {
        domain.closeSettingsAuthorityDomain(handle);
      }
    },
  );
  await check("launch-is-fixed-across-cwd-and-input-mutation", async (f) => {
    const launch = JSON.parse(JSON.stringify(f.launch));
    const reopened = binding.openSettingsPermissionAuthority({
      launch,
      contextId: "workspace",
    });
    const original = process.cwd();
    try {
      launch.contexts[0].cwd = "/wrong";
      process.chdir(f.root);
      childSync(f);
      assert.equal(
        binding.readSettingsPermissionAuthority(reopened).snapshot.generation,
        1,
      );
      assert.equal(
        binding.settingsPermissionAuthorityOptions(reopened).cwd,
        f.cwd,
      );
    } finally {
      process.chdir(original);
      binding.closeSettingsPermissionAuthority(reopened);
    }
  });
  await check(
    "unregistered-context-forged-binding-and-option-mismatch-denied",
    async (f) => {
      assert.throws(() =>
        binding.openSettingsPermissionAuthority({
          launch: f.launch,
          contextId: "other",
        }),
      );
      assert.throws(() => binding.readSettingsPermissionAuthority({}));
      await assert.rejects(makeProvider(f, { cwd: f.root }), /mismatch/);
      assert.throws(
        () =>
          loader.addRule({
            cwd: f.root,
            kind: "deny",
            rule: "Bash",
            settingsAuthority: f.authority,
          }),
        /mismatch/,
      );
    },
  );
  await check(
    "projection-rechecks-cross-process-write-during-env-sampling",
    async (f) => {
      let changed = false;
      const env = {
        get CC_PERMISSIONS_ALLOW() {
          if (!changed) {
            changed = true;
            childSync(f);
          }
          return "";
        },
      };
      const { provider } = await makeProvider(f, { env });
      assert.throws(provider, {
        code: "CC_SETTINGS_PERMISSION_AUTHORITY_CHANGED",
      });
      assert.deepEqual(provider().rules.deny, ["Bash"]);
    },
  );
  await check(
    "raw-restoration-does-not-revive-old-domain-permit",
    async (f) => {
      const { owner } = await makeProvider(f);
      owner.getSnapshot();
      const original = fs.readFileSync(f.file);
      childSync(f);
      fs.writeFileSync(f.file, original);
      assert.throws(() => owner.getSnapshot());
    },
  );
  await check(
    "discovery-change-refuses-instead-of-registering-new-context",
    async (f) => {
      const { owner } = await makeProvider(f);
      fs.mkdirSync(path.join(f.root, ".git"));
      assert.throws(() => owner.getSnapshot());
    },
  );
  await check("real-proxy-connection-and-native-child-stop-ack", async (f) => {
    const { startEgressProxyWorker } =
      await import("../../src/lib/sandbox-egress-worker.js");
    const { createDockerEgressAuthorityMonitor } =
      await import("../../src/lib/sandbox-egress-authority-monitor.js");
    const { owner } = await makeProvider(f);
    const initial = owner.getSnapshot();
    const sockets = new Set();
    let received = 0;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("data", (chunk) => {
        received += chunk.length;
      });
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const proxy = await startEgressProxyWorker({
      allowedDomains: ["127.0.0.1"],
      allowPrivate: true,
    });
    const heartbeat = path.join(f.cwd, "heartbeat");
    const clientCode = `const net=require('node:net'),fs=require('node:fs');
const socket=net.connect(Number(process.argv[1]),'127.0.0.1');let ready=false,header='';
socket.on('connect',()=>socket.write('CONNECT 127.0.0.1:'+process.argv[2]+' HTTP/1.1\\r\\nHost: 127.0.0.1:'+process.argv[2]+'\\r\\n\\r\\n'));
socket.on('data',chunk=>{header+=chunk;if(header.includes('\\r\\n\\r\\n'))ready=/200/.test(header)});
socket.on('error',()=>{});setInterval(()=>{fs.writeFileSync(process.argv[3],String(Date.now()));if(ready&&!socket.destroyed)socket.write('ping')},20);`;
    const target = spawn(
      process.execPath,
      [
        "-e",
        clientCode,
        String(proxy.port),
        String(server.address().port),
        heartbeat,
      ],
      { stdio: "ignore", windowsHide: true },
    );
    const targetClosed = once(target, "close");
    let targetExited = false;
    targetClosed.then(() => {
      targetExited = true;
    });
    const monitor = createDockerEgressAuthorityMonitor({
      sessionId: "native-live-session",
      policyVersion: JSON.stringify(initial.durable),
      revalidate() {
        if (owner.getSnapshot() !== initial)
          throw new Error("persistent authority revoked");
      },
      abortProxy: () => proxy.abort(),
    });
    monitor.attachSession({
      async close() {
        target.kill();
        await targetClosed;
      },
    });
    const unsubscribe = owner.subscribePolicyRevision(() =>
      monitor.revoke(new Error("persistent authority revoked")),
    );
    try {
      await until(() => received > 0, "traffic positive control");
      assert.equal(monitor.getStopAcknowledgement(), null);
      childSync(f);
      await until(
        () => monitor.revocationError !== null,
        "receiver observes remote revision",
      );
      monitor.stop();
      await monitor.awaitCleanup();
      const ack = monitor.getStopAcknowledgement();
      assert.equal(ack?.schema, "chainlesschain.egress-stop-ack/v1");
      assert.deepEqual(
        {
          receiverId: ack.receiverId,
          sessionId: ack.sessionId,
          policyVersion: ack.policyVersion,
        },
        monitor.stopIdentity,
      );
      assert.equal(ack.policyVersion, JSON.stringify(initial.durable));
      assert.equal(targetExited, true);
      await until(
        () => sockets.size === 0,
        "upstream observes connection close",
      );
      const bytesAtAck = received;
      const heartbeatAtAck = fs.readFileSync(heartbeat, "utf8");
      await delay(200);
      assert.equal(received, bytesAtAck);
      assert.equal(fs.readFileSync(heartbeat, "utf8"), heartbeatAtAck);
    } finally {
      unsubscribe();
      monitor.stop();
      target.kill();
      await targetClosed;
      await proxy.close();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  return {
    schema: "settings-permission-runtime-probe/v1",
    supported: true,
    node: process.version,
    platform: process.platform,
    passed: cases.length,
    cases,
  };
}

if (!isMainThread) {
  child(workerData)
    .then((result) => parentPort.postMessage(result))
    .catch((error) => {
      throw error;
    });
} else if (process.argv[2] === "--child") {
  child(JSON.parse(fs.readFileSync(0, "utf8")))
    .then((result) => process.stdout.write(JSON.stringify(result)))
    .catch((error) => {
      process.stderr.write(error.stack + "\n");
      process.exitCode = 1;
    });
} else {
  probe()
    .then((report) => process.stdout.write(JSON.stringify(report) + "\n"))
    .catch((error) => {
      process.stderr.write(error.stack + "\n");
      process.exitCode = 1;
    });
}
