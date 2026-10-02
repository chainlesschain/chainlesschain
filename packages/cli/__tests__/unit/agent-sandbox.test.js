import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SANDBOX_IMAGE,
  _deps,
  assessAgentSandboxCapabilities,
  assertSandboxAvailable,
  assertSandboxCapabilities,
  enforceSandboxFailClosed,
  executeSandboxedShell,
  executeDockerEgressShell,
  isolationLevel,
  normalizeAgentSandbox,
  normalizeAgentSandboxMode,
  normalizeSandboxPolicy,
  probeSandboxAvailability,
  sandboxSummary,
} from "../../src/lib/agent-sandbox.js";
import { executeTool } from "../../src/runtime/agent-core.js";
import { PlanModeManager } from "../../src/lib/plan-mode.js";
import { WSSessionManager } from "../../src/gateways/ws/ws-session-gateway.js";
import {
  createAutoModeApprovalGate,
  resolveAutoModeDecisions,
} from "../../src/lib/auto-mode-config.js";
import approvalCore from "../../../session-core/lib/approval-gate.js";
import { containsApiKeyArgument } from "../../src/commands/agent.js";
import settingsLoader from "../../src/lib/settings-loader.cjs";
import { createPermissionRulesProvider } from "../../src/lib/permission-authority.js";
import { ScopedPermissionStore } from "../../src/lib/scoped-permission-store.js";

const { ApprovalGate, POLICY: APPROVAL_POLICY } = approvalCore;

const egressMocks = vi.hoisted(() => ({ start: vi.fn() }));
const workerMocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../../src/lib/sandbox-docker-egress.js", () => ({
  startDockerEgressSession: (...args) => egressMocks.start(...args),
}));
vi.mock("../../src/lib/sandbox-egress-worker.js", () => ({
  startEgressProxyWorker: (...args) => workerMocks.start(...args),
}));

const originalSpawnSync = _deps.spawnSync;
const originalHost = _deps.host;
afterEach(() => {
  _deps.spawnSync = originalSpawnSync;
  _deps.host = originalHost;
  egressMocks.start.mockReset();
  workerMocks.start.mockReset();
});

describe("explicit Docker egress configuration and execution evidence", () => {
  const host = { platform: "linux", release: "test", arch: "x64" };
  const image = `node@sha256:${"a".repeat(64)}`;
  const config = () =>
    normalizeAgentSandbox(true, {
      network: true,
      settings: {
        engine: "docker-egress",
        image,
        relayImage: image,
        network: { allowedDomains: ["example.test"] },
      },
    });

  it("preserves explicit image pins and reports preflight without applied or unrestricted networking", () => {
    const sandbox = config();
    expect(sandbox.relayImage).toBe(image);
    expect(sandbox.policy).toMatchObject({
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
    });
    expect(isolationLevel(sandbox)).toBe("container");
    expect(sandboxSummary(sandbox).relayImage).toBe(image);
    const report = assessAgentSandboxCapabilities(sandbox, { host });
    expect(report.status).toBe("ready");
    expect(report.applied).toEqual([]);
    expect(report.enforceable.map((entry) => entry.id)).toContain(
      "network.domain-policy",
    );
    expect(report.requested.map((entry) => entry.id)).not.toContain(
      "network.unrestricted",
    );
    expect(
      assessAgentSandboxCapabilities(sandbox, {
        host,
        execution: {
          started: true,
          attempted: true,
          receipt: { kind: "docker-egress-execution/v1" },
        },
      }).applied,
    ).toEqual([]);
  });

  it.each([
    [
      "platform",
      (s) => s,
      { ...host, platform: "win32" },
      "docker_egress_requires_linux",
    ],
    [
      "network",
      (s) => ({ ...s, network: false }),
      host,
      "docker_egress_network_disabled",
    ],
    [
      "strict",
      (s) => ({ ...s, mode: "strict" }),
      host,
      "docker_egress_network_disabled",
    ],
    [
      "domains",
      (s) => ({ ...s, policy: { ...s.policy, allowedDomains: [] } }),
      host,
      "docker_egress_domain_policy_required",
    ],
    [
      "target pin",
      (s) => ({ ...s, image: "node:22" }),
      host,
      "docker_egress_image_digest_required",
    ],
    [
      "relay pin",
      (s) => ({ ...s, relayImage: null }),
      host,
      "docker_egress_image_digest_required",
    ],
    [
      "file rules",
      (s) => ({ ...s, policy: { ...s.policy, denyRead: ["secret"] } }),
      host,
      "docker_fine_grained_filesystem_unsupported",
    ],
    [
      "excluded commands",
      (s) => ({ ...s, policy: { ...s.policy, excludedCommands: ["curl"] } }),
      host,
      "docker_egress_exclusions_prohibited",
    ],
  ])(
    "rejects unsupported %s before any execution",
    (_name, transform, machine, reason) => {
      const report = assessAgentSandboxCapabilities(transform(config()), {
        host: machine,
        execution: { started: true },
      });
      expect(report.status).toBe("unsupported");
      expect(report.unsupported.map((entry) => entry.reason)).toContain(reason);
      expect(report.applied).toEqual([]);
      expect(report.enforceable).toEqual([]);
    },
  );

  it("keeps strict mode network off and synchronous execution fail-closed", () => {
    const strict = normalizeAgentSandboxMode("strict", true, {
      network: true,
      settings: { engine: "docker-egress", image, relayImage: image },
    });
    expect(strict.network).toBe(false);
    _deps.host = () => host;
    _deps.spawnSync = vi.fn();
    const result = executeSandboxedShell("echo forbidden", config());
    expect(result.failedToStart).toBe(true);
    expect(result.sandboxCapabilities.applied).toEqual([]);
    expect(_deps.spawnSync).not.toHaveBeenCalled();
  });

  it("binds applied evidence to an owned completed asynchronous session and exact configuration", async () => {
    _deps.host = () => host;
    const events = [];
    const session = {
      close: vi.fn(async () => events.push("close")),
      run: vi.fn(async (_command, options) => {
        await options.beforeStart();
        events.push("run");
        return { stdout: "result", stderr: "", exitCode: 7 };
      }),
    };
    egressMocks.start.mockResolvedValue(session);
    const sandbox = config();
    const result = await executeDockerEgressShell("exit 7", sandbox, {
      brokerSocketPath: "/private/broker.sock",
      auditContext: { sessionId: "test" },
      env: { CC_SESSION_ID: "test" },
      onSession(value) {
        expect(value).toBe(session);
        events.push("session");
      },
      beforeStart: async () => events.push("authorize"),
    });
    expect(events).toEqual(["session", "authorize", "run", "close"]);
    expect(result.exitCode).toBe(7);
    expect(session.run.mock.calls[0][1].env).toEqual({ CC_SESSION_ID: "test" });
    expect(result.sandboxCapabilities.status).toBe("applied");
    expect(egressMocks.start.mock.calls[0][0].auditContext).toEqual({
      sessionId: "test",
    });
    expect(result).not.toHaveProperty("sandboxExecutionReceipt");
    expect(
      assessAgentSandboxCapabilities(sandbox, {
        host,
        execution: {
          started: true,
          attempted: true,
          receipt: result.sandboxCapabilities,
        },
      }).applied,
    ).toEqual([]);
  });

  it("returns environment failures but preserves authority errors and closes sessions", async () => {
    _deps.host = () => host;
    egressMocks.start.mockRejectedValueOnce(
      new Error("daemon failed: /private/secret-path TOKEN=secret"),
    );
    const environmentFailure = await executeDockerEgressShell("true", config());
    expect(environmentFailure).toMatchObject({
      failedToStart: true,
      exitCode: 1,
    });
    expect(JSON.stringify(environmentFailure)).not.toContain("secret");
    const denied = Object.assign(new Error("revoked"), {
      code: "AUTHORITY_REVOKED",
    });
    const session = {
      close: vi.fn(async () => {}),
      run: vi.fn(async (_command, options) => options.beforeStart()),
    };
    egressMocks.start.mockResolvedValue(session);
    await expect(
      executeDockerEgressShell("true", config(), {
        beforeStart: async () => {
          throw denied;
        },
      }),
    ).rejects.toBe(denied);
    expect(session.close).toHaveBeenCalled();
    const sandbox = config();
    await expect(
      executeDockerEgressShell("true", sandbox, {
        onSession() {
          sandbox.policy.allowedDomains = ["changed.test"];
        },
      }),
    ).rejects.toMatchObject({ code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" });
  });

  it("does not attest a session that omitted the final dispatch fence", async () => {
    _deps.host = () => host;
    const close = vi.fn(async () => {});
    egressMocks.start.mockResolvedValue({
      close,
      run: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    const result = await executeDockerEgressShell("true", config());
    expect(result.failedToStart).toBe(true);
    expect(result.sandboxCapabilities.applied).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it("reports an unknown outcome after the final start fence without a retry-safe claim", async () => {
    _deps.host = () => host;
    egressMocks.start.mockResolvedValue({
      close: vi.fn(async () => {}),
      run: async (_command, options) => {
        await options.beforeStart();
        throw new Error("attach timeout after target execution");
      },
    });
    const result = await executeDockerEgressShell(
      "write side effect",
      config(),
    );
    expect(result).toMatchObject({
      executionOutcome: "unknown",
      retrySafe: false,
      sandboxCapabilities: { status: "outcome-unknown", applied: [] },
    });
    expect(result).not.toHaveProperty("failedToStart");
    expect(JSON.stringify(result)).not.toContain("attach timeout");
  });

  it("never issues applied evidence when authority is revoked after target completion", async () => {
    _deps.host = () => host;
    const denied = Object.assign(new Error("policy changed"), {
      code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
    });
    egressMocks.start.mockResolvedValue({
      close: vi.fn(async () => {}),
      run: async (_command, options) => {
        await options.beforeStart();
        return { stdout: "side effect done", stderr: "", exitCode: 0 };
      },
    });
    const result = await executeDockerEgressShell(
      "write side effect",
      config(),
      {
        beforeReceipt: async () => {
          throw denied;
        },
      },
    );
    expect(result).toMatchObject({
      exitCode: 1,
      stdout: "side effect done",
      executionOutcome: "completed-cleanup-unknown",
      retrySafe: false,
      authorityFailure: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
      sandboxCapabilities: { status: "outcome-unknown", applied: [] },
    });
  });

  it("retains observed output while marking cleanup failure as uncertain", async () => {
    _deps.host = () => host;
    egressMocks.start.mockResolvedValue({
      close: vi.fn(async () => {
        throw new Error("cleanup failed: /private/recovery-path");
      }),
      run: async (_command, options) => {
        await options.beforeStart();
        return { stdout: "side effect done", stderr: "", exitCode: 0 };
      },
    });
    const result = await executeDockerEgressShell(
      "write side effect",
      config(),
    );
    expect(result).toMatchObject({
      stdout: "side effect done",
      executionOutcome: "completed-cleanup-unknown",
      retrySafe: false,
      sandboxCapabilities: { status: "outcome-unknown", applied: [] },
    });
    expect(result).not.toHaveProperty("failedToStart");
    expect(JSON.stringify(result)).not.toContain("recovery-path");
  });

  it.each(["permission", "sandbox"])(
    "revokes a running product shell when live %s authority tightens",
    async (authority) => {
      _deps.host = () => host;
      const abort = vi.fn(async () => {});
      const proxyClose = vi.fn(async () => {});
      workerMocks.start.mockResolvedValue({
        socketPath: "/private/broker.sock",
        revision: 0,
        abort,
        close: proxyClose,
      });
      let started;
      let finishRun;
      const startedPromise = new Promise((resolve) => {
        started = resolve;
      });
      const session = {
        close: vi.fn(async () => {}),
        run: vi.fn(async (_command, options) => {
          await options.beforeStart();
          started();
          return new Promise((resolve) => {
            finishRun = resolve;
          });
        }),
      };
      egressMocks.start.mockResolvedValue(session);
      let denied = false;
      const permissionRulesProvider = async () => ({
        rules: { allow: [], ask: [], deny: denied ? ["run_shell"] : [] },
        sources: {},
        scoped: { rules: [] },
      });
      const sandbox = config();
      const pending = executeTool(
        "run_shell",
        { command: "echo side-effect" },
        {
          sandbox,
          permissionRulesProvider,
          approvalGate: {
            decide: async () => ({
              decision: "allow",
              via: "policy",
              policy: "autopilot",
            }),
          },
        },
      );
      await startedPromise;
      if (authority === "permission") denied = true;
      else sandbox.policy.allowedDomains = ["changed.test"];
      await vi.waitFor(() => expect(abort).toHaveBeenCalledOnce(), {
        timeout: 3_000,
      });
      finishRun({ stdout: "side-effect", stderr: "", exitCode: 0 });
      const result = await pending;
      expect(session.close).toHaveBeenCalled();
      expect(proxyClose).toHaveBeenCalled();
      expect(result.exitCode).toBe(1);
      expect(result.executionOutcome).toBe("completed-cleanup-unknown");
      expect(result.retrySafe).toBe(false);
      expect(result.sandboxCapabilities.applied).toEqual([]);
    },
  );

  it("revokes a running Docker shell when plan mode enters and exits between polls", async () => {
    _deps.host = () => host;
    const manager = new PlanModeManager({ memoryOnly: true });
    const abort = vi.fn(async () => {});
    workerMocks.start.mockResolvedValue({
      socketPath: "/private/broker.sock",
      revision: 0,
      abort,
      close: vi.fn(async () => {}),
    });
    let started;
    let finishRun;
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    const session = {
      close: vi.fn(async () => {}),
      run: vi.fn(async (_command, options) => {
        await options.beforeStart();
        started();
        return new Promise((resolve) => {
          finishRun = resolve;
        });
      }),
    };
    egressMocks.start.mockResolvedValue(session);

    const pending = executeTool(
      "run_shell",
      { command: "echo stale-plan-authority" },
      {
        sandbox: config(),
        planManager: manager,
        approvalGate: {
          decide: async () => ({
            decision: "allow",
            via: "policy",
            policy: "autopilot",
          }),
        },
      },
    );
    await startedPromise;
    expect(manager.enterPlanMode()).not.toHaveProperty("error");
    expect(abort).toHaveBeenCalledOnce();
    expect(manager.exitPlanMode()).not.toHaveProperty("error");
    finishRun({ stdout: "side-effect", stderr: "", exitCode: 0 });

    const result = await pending;
    expect(manager.isActive()).toBe(false);
    expect(manager.revision).toBe(2);
    expect(session.close).toHaveBeenCalled();
    expect(manager.listenerCount("revision-changed")).toBe(0);
    expect(result).toMatchObject({
      exitCode: 1,
      retrySafe: false,
      authorityFailure: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
      sandboxCapabilities: { applied: [] },
    });
  });

  it.each(
    [
      "permission-read",
      "approval",
      "broker-start",
      "container-create",
      "running",
      "receipt",
    ].flatMap((phase) =>
      ["revoke-grant", "deny-then-revoke"].map((operation) => [
        phase,
        operation,
      ]),
    ),
  )(
    "revokes scoped %s authority synchronously for %s",
    async (phase, operation) => {
      _deps.host = () => host;
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-scoped-shell-"));
      const cwd = path.join(root, "workspace");
      fs.mkdirSync(cwd);
      const settings = path.join(cwd, ".claude", "settings.json");
      fs.mkdirSync(path.dirname(settings));
      fs.writeFileSync(
        settings,
        JSON.stringify({
          permissions: phase === "approval" ? { ask: ["Bash"] } : {},
        }),
      );
      const filePath = path.join(root, "rules.json");
      const scopedStore = new ScopedPermissionStore({ cwd, filePath });
      const grant = scopedStore.add({
        decision: "allow",
        rule: "Bash",
        expiresAt: Date.now() + 60_000,
      });
      const provider = createPermissionRulesProvider({
        cwd,
        env: {},
        managedSettingsFile: path.join(root, "managed.json"),
        scopedStore,
      });
      let release;
      let finishRun;
      let deliverSession;
      const wait = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      const abort = vi.fn(async () => {});
      const proxy = {
        socketPath: "/private/broker.sock",
        revision: 0,
        abort,
        close: vi.fn(async () => {}),
      };
      workerMocks.start.mockImplementation(
        phase === "broker-start" ? wait : async () => proxy,
      );
      const running = ["container-create", "running", "receipt"].includes(
        phase,
      );
      const change = () => {
        const writer = new ScopedPermissionStore({ cwd, filePath });
        if (operation === "revoke-grant") {
          writer.revoke({ id: grant.id });
          if (running) expect(abort).toHaveBeenCalledOnce();
          writer.add({
            decision: "allow",
            rule: "Bash",
            expiresAt: Date.now() + 60_000,
          });
        } else {
          const deny = writer.add({
            decision: "deny",
            rule: "Bash",
            expiresAt: Date.now() + 60_000,
          });
          if (running) expect(abort).toHaveBeenCalledOnce();
          writer.revoke({ id: deny.id });
        }
        expect(provider().rules.deny).toEqual([]);
        expect(provider().rules.allow).toContain("Bash");
      };
      const dockerSession = {
        close: vi.fn(async () => {}),
        run: vi.fn(async (_command, options) => {
          await options.beforeStart();
          const result = await new Promise((resolve) => {
            finishRun = resolve;
          });
          if (phase === "receipt") change();
          return result;
        }),
      };
      egressMocks.start.mockImplementation(
        phase === "container-create"
          ? () =>
              new Promise((resolve) => {
                deliverSession = resolve;
              })
          : async () => dockerSession,
      );
      try {
        const pending = executeTool(
          "run_shell",
          { command: "echo scoped-authority" },
          {
            cwd,
            sandbox: config(),
            sessionId: "scoped-authority",
            permissionRulesProvider: provider,
            permissionConfirm: phase === "approval" ? wait : async () => true,
            approvalGate: new ApprovalGate({
              defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
            }),
          },
        );
        if (phase !== "permission-read")
          await vi.waitFor(() =>
            expect(
              running
                ? phase === "container-create"
                  ? deliverSession
                  : finishRun
                : release,
            ).toBeTypeOf("function"),
          );
        if (phase !== "receipt") change();
        if (running) {
          if (phase === "container-create") deliverSession(dockerSession);
          else finishRun({ stdout: "late success", stderr: "", exitCode: 0 });
        } else if (release) release(phase === "approval" ? true : proxy);
        if (["broker-start", "container-create"].includes(phase))
          await expect(pending).rejects.toMatchObject({
            code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
          });
        else if (running)
          expect(await pending).toMatchObject({
            exitCode: 1,
            retrySafe: false,
            authorityFailure: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
            sandboxCapabilities: { applied: [] },
          });
        else
          expect((await pending).policy.code).toBe(
            "CC_SHELL_POLICY_AUTHORITY_CHANGED",
          );
        if (running) {
          expect(dockerSession.close).toHaveBeenCalled();
          if (phase === "container-create")
            expect(dockerSession.run).not.toHaveBeenCalled();
          scopedStore.add({
            decision: "deny",
            rule: "Read",
            expiresAt: Date.now() + 60_000,
          });
          expect(abort).toHaveBeenCalledOnce();
        } else expect(egressMocks.start).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("unsubscribes both permission owners after successful Docker execution", async () => {
    _deps.host = () => host;
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-scoped-shell-success-"),
    );
    const cwd = path.join(root, "workspace");
    fs.mkdirSync(cwd);
    const scopedStore = new ScopedPermissionStore({
      cwd,
      filePath: path.join(root, "rules.json"),
    });
    const provider = createPermissionRulesProvider({
      cwd,
      env: {},
      scopedStore,
      managedSettingsFile: path.join(root, "missing.json"),
    });
    const abort = vi.fn(async () => {});
    workerMocks.start.mockResolvedValue({
      socketPath: "/private/broker.sock",
      revision: 0,
      abort,
      close: vi.fn(async () => {}),
    });
    egressMocks.start.mockResolvedValue({
      close: vi.fn(async () => {}),
      run: async (_command, options) => {
        await options.beforeStart();
        return { stdout: "authorized", stderr: "", exitCode: 0 };
      },
    });
    try {
      expect(
        await executeTool(
          "run_shell",
          { command: "echo authorized" },
          {
            cwd,
            sandbox: config(),
            permissionRulesProvider: provider,
            approvalGate: new ApprovalGate({
              defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
            }),
          },
        ),
      ).toMatchObject({ stdout: "authorized", exitCode: 0 });
      scopedStore.add({
        decision: "deny",
        rule: "Bash",
        expiresAt: Date.now() + 60_000,
      });
      settingsLoader.addRule({ cwd, kind: "deny", rule: "Bash" });
      expect(abort).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["permission-read", "approval", "broker-start"])(
    "rejects an Auto Mode ABA while waiting for %s",
    async (phase) => {
      _deps.host = () => host;
      const gate = createAutoModeApprovalGate(
        new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.AUTOPILOT }),
        resolveAutoModeDecisions({
          decisions: { medium: phase === "approval" ? "ask" : "allow" },
        }),
      );
      let release;
      const wait = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      gate.setConfirmer(phase === "approval" ? wait : async () => true);
      workerMocks.start.mockImplementation(
        phase === "broker-start"
          ? wait
          : async () => ({
              socketPath: "/private/broker.sock",
              revision: 0,
              abort: vi.fn(async () => {}),
              close: vi.fn(async () => {}),
            }),
      );
      const pending = executeTool(
        "run_shell",
        { command: "echo stale-auto-authority" },
        {
          sandbox: config(),
          sessionId: "auto-s1",
          approvalGate: gate,
          ...(phase === "permission-read"
            ? { permissionRulesProvider: wait }
            : {}),
        },
      );
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      gate.setActive(false);
      gate.setActive(true);
      expect(
        gate.getAuthorizationPolicySnapshot("auto-s1").activeRevision,
      ).toBe(2);
      release(
        phase === "permission-read"
          ? { rules: { allow: [], ask: [], deny: [] } }
          : phase === "approval"
            ? true
            : {
                socketPath: "/private/broker.sock",
                revision: 0,
                abort: vi.fn(async () => {}),
                close: vi.fn(async () => {}),
              },
      );
      if (phase === "permission-read") {
        expect((await pending).policy).toMatchObject({
          decision: "blocked",
          code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
        });
      } else {
        await expect(pending).rejects.toMatchObject({
          code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
        });
      }
      expect(egressMocks.start).not.toHaveBeenCalled();
    },
  );

  it.each(["running", "container-create"])(
    "immediately revokes Auto Mode ABA during %s and never releases a success receipt",
    async (phase) => {
      _deps.host = () => host;
      const inner = new ApprovalGate({
        defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
      });
      const gate = createAutoModeApprovalGate(
        inner,
        resolveAutoModeDecisions({ decisions: { medium: "allow" } }),
      );
      const abort = vi.fn(async () => {});
      workerMocks.start.mockResolvedValue({
        socketPath: "/private/broker.sock",
        revision: 0,
        abort,
        close: vi.fn(async () => {}),
      });
      let finishRun;
      let deliverSession;
      const session = {
        close: vi.fn(async () => {}),
        run: vi.fn(async (_command, options) => {
          await options.beforeStart();
          return new Promise((resolve) => {
            finishRun = resolve;
          });
        }),
      };
      egressMocks.start.mockImplementation(
        phase === "running"
          ? async () => session
          : () =>
              new Promise((resolve) => {
                deliverSession = resolve;
              }),
      );
      const pending = executeTool(
        "run_shell",
        { command: "echo stale-auto-authority" },
        { sandbox: config(), sessionId: "auto-s1", approvalGate: gate },
      );
      await vi.waitFor(() =>
        expect(phase === "running" ? finishRun : deliverSession).toBeTypeOf(
          "function",
        ),
      );
      gate.setActive(false);
      expect(abort).toHaveBeenCalledOnce();
      gate.setActive(true);
      if (phase === "running")
        finishRun({ stdout: "side-effect", stderr: "", exitCode: 0 });
      else deliverSession(session);
      if (phase === "running") {
        expect(await pending).toMatchObject({
          exitCode: 1,
          retrySafe: false,
          authorityFailure: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
          sandboxCapabilities: { applied: [] },
        });
      } else {
        await expect(pending).rejects.toMatchObject({
          code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
        });
        expect(session.run).not.toHaveBeenCalled();
      }
      expect(session.close).toHaveBeenCalled();
      expect(inner._policyRevisionListeners.size).toBe(0);
      gate.setActive(false);
      expect(abort).toHaveBeenCalledOnce();
    },
  );

  it.each(["permission-read", "approval", "broker-start"])(
    "rejects a WS host-policy ABA while waiting for %s",
    async (phase) => {
      _deps.host = () => host;
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-ws-shell-policy-"),
      );
      const manager = new WSSessionManager({ defaultProjectRoot: root });
      const allowed = { tools: { run_shell: { allowed: true } } };
      const { sessionId } = manager.createSession({
        hostManagedToolPolicy: allowed,
      });
      const session = manager.getSession(sessionId);
      try {
        let release;
        const wait = () =>
          new Promise((resolve) => {
            release = resolve;
          });
        const gate = createAutoModeApprovalGate(
          new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.AUTOPILOT }),
          resolveAutoModeDecisions({
            decisions: { medium: phase === "approval" ? "ask" : "allow" },
          }),
        );
        gate.setConfirmer(phase === "approval" ? wait : async () => true);
        const proxy = {
          socketPath: "/private/broker.sock",
          revision: 0,
          abort: vi.fn(async () => {}),
          close: vi.fn(async () => {}),
        };
        workerMocks.start.mockImplementation(
          phase === "broker-start" ? wait : async () => proxy,
        );
        const pending = executeTool(
          "run_shell",
          { command: "echo stale-host-policy" },
          {
            cwd: root,
            sandbox: config(),
            sessionId,
            approvalGate: gate,
            hostManagedToolPolicy: session.hostManagedToolPolicy,
            hostManagedToolPolicyAuthority:
              session.hostManagedToolPolicyAuthority,
            ...(phase === "permission-read"
              ? { permissionRulesProvider: wait }
              : {}),
          },
        );
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        manager.updateSessionPolicy(sessionId, {
          tools: { run_shell: { allowed: false } },
        });
        manager.updateSessionPolicy(sessionId, allowed);
        release(
          phase === "permission-read"
            ? { rules: { allow: [], ask: [], deny: [] } }
            : phase === "approval"
              ? true
              : proxy,
        );
        if (phase === "permission-read")
          expect((await pending).policy.code).toBe(
            "CC_SHELL_POLICY_AUTHORITY_CHANGED",
          );
        else
          await expect(pending).rejects.toMatchObject({
            code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
          });
        expect(egressMocks.start).not.toHaveBeenCalled();
      } finally {
        manager.closeSession(sessionId);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["running", "container-create"])(
    "immediately revokes WS host-policy ABA during %s and removes the subscription",
    async (phase) => {
      _deps.host = () => host;
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-ws-shell-live-policy-"),
      );
      const manager = new WSSessionManager({ defaultProjectRoot: root });
      const allowed = { tools: { run_shell: { allowed: true } } };
      const { sessionId } = manager.createSession({
        hostManagedToolPolicy: allowed,
      });
      const session = manager.getSession(sessionId);
      try {
        const abort = vi.fn(async () => {});
        workerMocks.start.mockResolvedValue({
          socketPath: "/private/broker.sock",
          revision: 0,
          abort,
          close: vi.fn(async () => {}),
        });
        let finishRun;
        let deliverSession;
        const dockerSession = {
          close: vi.fn(async () => {}),
          run: vi.fn(async (_command, options) => {
            await options.beforeStart();
            return new Promise((resolve) => {
              finishRun = resolve;
            });
          }),
        };
        egressMocks.start.mockImplementation(
          phase === "running"
            ? async () => dockerSession
            : () =>
                new Promise((resolve) => {
                  deliverSession = resolve;
                }),
        );
        const pending = executeTool(
          "run_shell",
          { command: "echo stale-host-policy" },
          {
            cwd: root,
            sandbox: config(),
            sessionId,
            hostManagedToolPolicy: session.hostManagedToolPolicy,
            hostManagedToolPolicyAuthority:
              session.hostManagedToolPolicyAuthority,
            approvalGate: new ApprovalGate({
              defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
            }),
          },
        );
        await vi.waitFor(() =>
          expect(phase === "running" ? finishRun : deliverSession).toBeTypeOf(
            "function",
          ),
        );
        manager.updateSessionPolicy(sessionId, {
          tools: { run_shell: { allowed: false } },
        });
        expect(abort).toHaveBeenCalledOnce();
        manager.updateSessionPolicy(sessionId, allowed);
        if (phase === "running")
          finishRun({ stdout: "side-effect", stderr: "", exitCode: 0 });
        else deliverSession(dockerSession);
        if (phase === "running")
          expect(await pending).toMatchObject({
            exitCode: 1,
            retrySafe: false,
            authorityFailure: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
            sandboxCapabilities: { applied: [] },
          });
        else {
          await expect(pending).rejects.toMatchObject({
            code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
          });
          expect(dockerSession.run).not.toHaveBeenCalled();
        }
        expect(dockerSession.close).toHaveBeenCalled();
        manager.updateSessionPolicy(sessionId, null);
        expect(abort).toHaveBeenCalledOnce();
      } finally {
        manager.closeSession(sessionId);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["permission-read", "approval", "broker-start"])(
    "rejects official settings ABA while waiting for %s",
    async (phase) => {
      _deps.host = () => host;
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-settings-shell-policy-"),
      );
      const settings = path.join(root, ".claude", "settings.json");
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      const original = JSON.stringify({
        permissions: phase === "approval" ? { ask: ["Bash"] } : {},
      });
      fs.writeFileSync(settings, original);
      const provider = createPermissionRulesProvider({
        cwd: root,
        env: {},
        managedSettingsFile: path.join(root, "managed.json"),
        scopedStore: { list: () => ({ rules: [] }) },
      });
      let release;
      const wait = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      const proxy = {
        socketPath: "/private/broker.sock",
        revision: 0,
        abort: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
      workerMocks.start.mockImplementation(
        phase === "broker-start" ? wait : async () => proxy,
      );
      try {
        const pending = executeTool(
          "run_shell",
          { command: "echo stale-settings" },
          {
            cwd: root,
            sandbox: config(),
            sessionId: "settings-aba",
            permissionRulesProvider: provider,
            permissionConfirm: phase === "approval" ? wait : async () => true,
            approvalGate: new ApprovalGate({
              defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
            }),
          },
        );
        // Official providers are synchronous: permission-read is the first
        // await immediately after the rules have been read, before admission.
        if (phase !== "permission-read")
          await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        settingsLoader.addRule({ cwd: root, kind: "deny", rule: "Bash" });
        fs.writeFileSync(settings, original);
        if (release) release(phase === "approval" ? true : proxy);
        if (phase === "broker-start") {
          await expect(pending).rejects.toMatchObject({
            code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
          });
        } else {
          expect((await pending).policy.code).toBe(
            "CC_SHELL_POLICY_AUTHORITY_CHANGED",
          );
        }
        expect(egressMocks.start).not.toHaveBeenCalled();
        expect(provider().rules.deny).toEqual([]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["container-create", "running", "receipt"])(
    "synchronously revokes official settings ABA during %s",
    async (phase) => {
      _deps.host = () => host;
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-settings-shell-live-"),
      );
      const settings = path.join(root, ".claude", "settings.json");
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      fs.writeFileSync(settings, "{}");
      const provider = createPermissionRulesProvider({
        cwd: root,
        env: {},
        managedSettingsFile: path.join(root, "managed.json"),
        scopedStore: { list: () => ({ rules: [] }) },
      });
      const abort = vi.fn(async () => {});
      workerMocks.start.mockResolvedValue({
        socketPath: "/private/broker.sock",
        revision: 0,
        abort,
        close: vi.fn(async () => {}),
      });
      const change = () => {
        settingsLoader.addRule({ cwd: root, kind: "deny", rule: "Bash" });
        expect(abort).toHaveBeenCalledOnce(); // No tick/await/poll is needed.
        fs.writeFileSync(settings, "{}");
      };
      let finishRun;
      let deliverSession;
      const dockerSession = {
        close: vi.fn(async () => {}),
        run: vi.fn(async (_command, options) => {
          await options.beforeStart();
          const result = await new Promise((resolve) => {
            finishRun = resolve;
          });
          if (phase === "receipt") change();
          return result;
        }),
      };
      egressMocks.start.mockImplementation(
        phase === "container-create"
          ? () =>
              new Promise((resolve) => {
                deliverSession = resolve;
              })
          : async () => dockerSession,
      );
      try {
        const pending = executeTool(
          "run_shell",
          { command: "echo stale-settings" },
          {
            cwd: root,
            sandbox: config(),
            sessionId: "settings-live-aba",
            permissionRulesProvider: provider,
            approvalGate: new ApprovalGate({
              defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
            }),
          },
        );
        await vi.waitFor(() =>
          expect(
            phase === "container-create" ? deliverSession : finishRun,
          ).toBeTypeOf("function"),
        );
        if (phase !== "receipt") change();
        if (phase === "container-create") deliverSession(dockerSession);
        else finishRun({ stdout: "late success", stderr: "", exitCode: 0 });
        if (phase === "container-create") {
          await expect(pending).rejects.toMatchObject({
            code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
          });
          expect(dockerSession.run).not.toHaveBeenCalled();
        } else {
          expect(await pending).toMatchObject({
            exitCode: 1,
            retrySafe: false,
            authorityFailure: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
            sandboxCapabilities: { applied: [] },
          });
        }
        expect(dockerSession.close).toHaveBeenCalled();
        settingsLoader.addRule({ cwd: root, kind: "deny", rule: "Write" });
        expect(abort).toHaveBeenCalledOnce(); // The old revocation stays latched.
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("removes the settings subscription after an authorized successful session", async () => {
    _deps.host = () => host;
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-settings-shell-cleanup-"),
    );
    const provider = createPermissionRulesProvider({
      cwd: root,
      env: {},
      managedSettingsFile: path.join(root, "managed.json"),
      scopedStore: { list: () => ({ rules: [] }) },
    });
    const abort = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    workerMocks.start.mockResolvedValue({
      socketPath: "/private/broker.sock",
      revision: 0,
      abort,
      close,
    });
    const session = {
      close: vi.fn(async () => {}),
      run: vi.fn(async (_command, options) => {
        await options.beforeStart();
        return { stdout: "authorized", stderr: "", exitCode: 0 };
      }),
    };
    egressMocks.start.mockResolvedValue(session);
    try {
      const result = await executeTool(
        "run_shell",
        { command: "echo authorized" },
        {
          cwd: root,
          sandbox: config(),
          sessionId: "settings-success",
          permissionRulesProvider: provider,
          approvalGate: new ApprovalGate({
            defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
          }),
        },
      );
      expect(result).toMatchObject({ stdout: "authorized", exitCode: 0 });
      expect(result.sandboxCapabilities.status).toBe("applied");
      expect(session.close).toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();
      settingsLoader.addRule({ cwd: root, kind: "deny", rule: "Bash" });
      expect(abort).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a brief approval policy change during the first permission read", async () => {
    _deps.host = () => host;
    const gate = new ApprovalGate({
      defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
    });
    let releasePermissionRead;
    let permissionReadStarted;
    const started = new Promise((resolve) => {
      permissionReadStarted = resolve;
    });
    const pending = executeTool(
      "run_shell",
      { command: "echo stale-approval-authority" },
      {
        sandbox: config(),
        sessionId: "approval-s1",
        approvalGate: gate,
        permissionRulesProvider: () => {
          permissionReadStarted();
          return new Promise((resolve) => {
            releasePermissionRead = resolve;
          });
        },
      },
    );
    await started;
    gate.setSessionPolicy("approval-s1", APPROVAL_POLICY.STRICT);
    gate.setSessionPolicy("approval-s1", APPROVAL_POLICY.AUTOPILOT);
    releasePermissionRead({ rules: { allow: [], ask: [], deny: [] } });
    const result = await pending;
    expect(result.policy).toMatchObject({
      decision: "blocked",
      via: "shell-policy-authority",
      code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
    });
    expect(egressMocks.start).not.toHaveBeenCalled();
  });

  it("rejects a brief plan change during the first permission read", async () => {
    _deps.host = () => host;
    const manager = new PlanModeManager({ memoryOnly: true });
    let releasePermissionRead;
    let permissionReadStarted;
    const started = new Promise((resolve) => {
      permissionReadStarted = resolve;
    });
    const pending = executeTool(
      "run_shell",
      { command: "echo stale-plan-authority" },
      {
        sandbox: config(),
        planManager: manager,
        approvalGate: {
          decide: async () => ({
            decision: "allow",
            via: "policy",
            policy: "autopilot",
          }),
        },
        permissionRulesProvider: () => {
          permissionReadStarted();
          return new Promise((resolve) => {
            releasePermissionRead = resolve;
          });
        },
      },
    );
    await started;
    expect(manager.enterPlanMode()).not.toHaveProperty("error");
    expect(manager.exitPlanMode()).not.toHaveProperty("error");
    releasePermissionRead({ rules: { allow: [], ask: [], deny: [] } });
    const result = await pending;
    expect(result.policy).toMatchObject({
      decision: "blocked",
      via: "shell-policy-authority",
      code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
    });
    expect(egressMocks.start).not.toHaveBeenCalled();
  });

  it("rejects a brief approval policy change while the broker starts", async () => {
    _deps.host = () => host;
    const gate = new ApprovalGate({
      defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
    });
    let releaseBroker;
    workerMocks.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseBroker = resolve;
        }),
    );
    const pending = executeTool(
      "run_shell",
      { command: "echo stale-broker-authority" },
      { sandbox: config(), sessionId: "approval-s1", approvalGate: gate },
    );
    await vi.waitFor(() => expect(workerMocks.start).toHaveBeenCalledOnce());
    gate.setSessionPolicy("approval-s1", APPROVAL_POLICY.STRICT);
    gate.setSessionPolicy("approval-s1", APPROVAL_POLICY.AUTOPILOT);
    releaseBroker({
      socketPath: "/private/broker.sock",
      revision: 0,
      abort: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    });
    await expect(pending).rejects.toMatchObject({
      code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
    });
    expect(egressMocks.start).not.toHaveBeenCalled();
  });

  it("immediately revokes a running Docker shell on a brief approval policy change", async () => {
    _deps.host = () => host;
    const gate = new ApprovalGate({
      defaultPolicy: APPROVAL_POLICY.AUTOPILOT,
    });
    const abort = vi.fn(async () => {});
    workerMocks.start.mockResolvedValue({
      socketPath: "/private/broker.sock",
      revision: 0,
      abort,
      close: vi.fn(async () => {}),
    });
    let started;
    let finishRun;
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    const session = {
      close: vi.fn(async () => {}),
      run: vi.fn(async (_command, options) => {
        await options.beforeStart();
        started();
        return new Promise((resolve) => {
          finishRun = resolve;
        });
      }),
    };
    egressMocks.start.mockResolvedValue(session);
    const pending = executeTool(
      "run_shell",
      { command: "echo stale-approval-authority" },
      { sandbox: config(), sessionId: "approval-s1", approvalGate: gate },
    );
    await Promise.race([
      startedPromise,
      pending.then((result) => {
        throw new Error(
          `Docker shell ended before start: ${JSON.stringify(result)}`,
        );
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Docker shell did not start")),
          5_000,
        ),
      ),
    ]);
    gate.setSessionPolicy("approval-s1", APPROVAL_POLICY.STRICT);
    expect(abort).toHaveBeenCalledOnce();
    gate.setSessionPolicy("approval-s1", APPROVAL_POLICY.AUTOPILOT);
    finishRun({ stdout: "side-effect", stderr: "", exitCode: 0 });
    const result = await pending;
    expect(session.close).toHaveBeenCalled();
    expect(gate._policyRevisionListeners.has("approval-s1")).toBe(false);
    expect(result).toMatchObject({
      exitCode: 1,
      retrySafe: false,
      authorityFailure: { code: "CC_SHELL_POLICY_AUTHORITY_CHANGED" },
      sandboxCapabilities: { applied: [] },
    });
  });

  it("closes a product session delivered after authority was revoked", async () => {
    _deps.host = () => host;
    const abort = vi.fn(async () => {});
    workerMocks.start.mockResolvedValue({
      socketPath: "/private/broker.sock",
      revision: 0,
      abort,
      close: vi.fn(async () => {}),
    });
    let deliverSession;
    egressMocks.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          deliverSession = resolve;
        }),
    );
    const session = {
      close: vi.fn(async () => {}),
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    let denied = false;
    const pending = executeTool(
      "run_shell",
      { command: "echo never-start" },
      {
        sandbox: config(),
        permissionRulesProvider: async () => ({
          rules: { allow: [], ask: [], deny: denied ? ["run_shell"] : [] },
          sources: {},
          scoped: { rules: [] },
        }),
        approvalGate: {
          decide: async () => ({
            decision: "allow",
            via: "policy",
            policy: "autopilot",
          }),
        },
      },
    );
    await vi.waitFor(() => expect(egressMocks.start).toHaveBeenCalledOnce());
    denied = true;
    await vi.waitFor(() => expect(abort).toHaveBeenCalledOnce(), {
      timeout: 3_000,
    });
    deliverSession(session);
    await expect(pending).rejects.toMatchObject({
      code: "CC_SHELL_POLICY_AUTHORITY_CHANGED",
    });
    expect(session.close).toHaveBeenCalled();
    expect(session.run).not.toHaveBeenCalled();
  });
});

describe("agent sandbox", () => {
  it("detects both supported API-key argv spellings for deprecation warnings", () => {
    expect(containsApiKeyArgument(["node", "cc", "--api-key", "secret"])).toBe(
      true,
    );
    expect(containsApiKeyArgument(["node", "cc", "--api-key=secret"])).toBe(
      true,
    );
    expect(containsApiKeyArgument(["node", "cc", "--api-key-helper=x"])).toBe(
      false,
    );
  });

  it("is opt-in and defaults to network isolation", () => {
    expect(normalizeAgentSandbox(undefined)).toBeNull();
    const sandbox = normalizeAgentSandbox(true, { cwd: "." });
    expect(sandbox.image).toBe(DEFAULT_SANDBOX_IMAGE);
    expect(sandbox.network).toBe(false);
  });

  it("loads an enabled settings policy without a CLI flag", () => {
    const sandbox = normalizeAgentSandbox(undefined, {
      cwd: ".",
      settings: {
        enabled: true,
        failIfUnavailable: true,
        filesystem: { denyRead: [".secrets"] },
        network: { allowedDomains: ["registry.npmjs.org"] },
      },
    });
    expect(sandbox).not.toBeNull();
    expect(sandbox.policy.failIfUnavailable).toBe(true);
    expect(sandbox.policy.denyRead[0]).toMatch(/\.secrets$/);
    expect(sandbox.policy.allowedDomains).toEqual(["registry.npmjs.org"]);
  });

  it("turns hard sandbox policy into fail-closed default isolation", () => {
    for (const settings of [
      { requireSandbox: true },
      { allowUnsandboxedCommands: false },
    ]) {
      const sandbox = normalizeAgentSandbox(undefined, { cwd: ".", settings });
      expect(sandbox).not.toBeNull();
      expect(sandbox.policy).toMatchObject({
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
      });
      expect(() =>
        normalizeAgentSandbox(false, { cwd: ".", settings }),
      ).toThrow(/prohibited/);
    }
  });

  it("does not let a CLI flag override managed network isolation", () => {
    const sandbox = normalizeAgentSandboxMode(undefined, true, {
      network: true,
      settings: { enabled: true, network: false },
      managedSettings: { enabled: true, network: false },
    });
    expect(sandbox.network).toBe(false);
  });

  it("does not require Docker when no container sandbox was requested", () => {
    expect(
      normalizeAgentSandboxMode(undefined, undefined, { cwd: "." }),
    ).toBeNull();
  });

  it("still honors settings that explicitly enable a fail-closed sandbox", () => {
    const sandbox = normalizeAgentSandboxMode(undefined, undefined, {
      cwd: ".",
      settings: { enabled: true, failIfUnavailable: true },
    });
    expect(sandbox).toMatchObject({ engine: "docker", network: false });
    expect(sandbox.policy.failIfUnavailable).toBe(true);
  });

  it("clamps an enabled sandbox for safe/auto runs", () => {
    const sandbox = enforceSandboxFailClosed(
      normalizeAgentSandbox(true),
      "auto",
    );
    expect(sandbox.failClosedReason).toBe("auto");
    expect(sandbox.policy).toMatchObject({
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
    });
  });

  it("maps explicit sandbox modes to fail-closed policies", () => {
    expect(normalizeAgentSandboxMode("off", true)).toBeNull();
    const workspace = normalizeAgentSandboxMode("workspace-write", true, {
      network: true,
    });
    expect(workspace).toMatchObject({ mode: "workspace-write", network: true });
    expect(workspace.policy).toMatchObject({
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
    });
    const strict = normalizeAgentSandboxMode("strict", true, {
      network: true,
    });
    expect(strict).toMatchObject({ mode: "strict", network: false });
    expect(strict.policy.failIfUnavailable).toBe(true);
  });

  it("rejects invalid modes and a policy-prohibited off mode", () => {
    expect(() => normalizeAgentSandboxMode("maybe", true)).toThrow(
      /Invalid sandbox mode/,
    );
    expect(() =>
      normalizeAgentSandboxMode("off", true, {
        settings: { allowUnsandboxedCommands: false },
      }),
    ).toThrow(/prohibited/);
    expect(() =>
      normalizeAgentSandboxMode("off", true, {
        settings: { enabled: true, allowUnsandboxedCommands: true },
        managedSettings: { enabled: true },
      }),
    ).toThrow(/prohibited/);
  });

  it("normalizes and de-duplicates policy entries", () => {
    const policy = normalizeSandboxPolicy(
      {
        filesystem: { allowWrite: ["tmp", "tmp"] },
        excludedCommands: ["docker", "docker"],
      },
      process.cwd(),
    );
    expect(policy.allowWrite).toHaveLength(1);
    expect(policy.excludedCommands).toEqual(["docker"]);
  });

  it("executes Docker with argv and only forwards agent identity", () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "ok\n",
      stderr: "",
      signal: null,
    }));
    const sandbox = normalizeAgentSandbox("node:22-alpine");
    const result = executeSandboxedShell("npm test && echo done", sandbox, {
      timeout: 1000,
      env: { CLAUDECODE: "1", SECRET: "must-not-cross" },
    });
    expect(result.exitCode).toBe(0);
    const [file, args, opts] = _deps.spawnSync.mock.calls[0];
    expect(file).toBe("docker");
    expect(args).toContain("none");
    expect(args).toContain("node:22-alpine");
    expect(args.at(-1)).toBe("npm test && echo done");
    expect(args.join(" ")).not.toContain("SECRET");
    expect(opts).toMatchObject({
      origin: "agent-sandbox:docker",
      scope: "sandbox",
      policy: "allow",
      shell: false,
      requirePersistentAudit: true,
      auditRedactArgIndexes: [args.length - 1],
    });
    expect(opts.timeout).toBe(1000);
  });

  it("fails closed when Docker is unavailable", () => {
    const error = new Error("spawn docker ENOENT");
    error.code = "ENOENT";
    _deps.spawnSync = vi.fn(() => ({
      error,
      status: null,
      stdout: "",
      stderr: "",
    }));
    const result = executeSandboxedShell(
      "echo unsafe",
      normalizeAgentSandbox(true),
    );
    expect(result.exitCode).toBe(1);
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/not installed/i);
  });

  it("reports the effective boundary without host paths", () => {
    expect(sandboxSummary(normalizeAgentSandbox(true))).toEqual({
      engine: "docker",
      image: DEFAULT_SANDBOX_IMAGE,
      isolationLevel: "container",
      network: "disabled",
      workspace: "read-write",
      policy: {
        additionalReadPaths: 0,
        additionalWritePaths: 0,
        networkRestricted: false,
        failIfUnavailable: false,
      },
    });
  });

  it("separates requested, enforceable, and applied capabilities", () => {
    const sandbox = normalizeAgentSandbox(true);
    const preflight = assessAgentSandboxCapabilities(sandbox, {
      host: { platform: "linux", release: "6.8.0", arch: "x64" },
      availability: { available: true, reason: null },
    });
    expect(preflight).toMatchObject({
      schema: "chainlesschain.agent-sandbox-capabilities/v1",
      host: { platform: "linux", release: "6.8.0", arch: "x64" },
      backend: {
        engine: "docker",
        isolationLevel: "container",
        availabilityChecked: true,
        available: true,
      },
      status: "ready",
      execution: { observed: false, attempted: false, started: false },
      unsupported: [],
      applied: [],
    });
    expect(preflight.requested.map(({ id }) => id)).toEqual([
      "isolation.container",
      "filesystem.workspace-read-write",
      "network.none",
    ]);
    expect(preflight.enforceable.map(({ id }) => id)).toEqual([
      "isolation.container",
      "filesystem.workspace-read-write",
      "network.none",
    ]);

    _deps.spawnSync = vi.fn(() => ({
      status: 7,
      stdout: "",
      stderr: "task failed",
      signal: null,
    }));
    const executed = executeSandboxedShell("exit 7", sandbox);
    expect(executed.exitCode).toBe(7);
    expect(executed.sandboxCapabilities).toMatchObject({
      status: "applied",
      execution: { observed: true, attempted: true, started: true },
      backend: { available: true },
    });
    expect(executed.sandboxCapabilities.applied.map(({ id }) => id)).toEqual([
      "isolation.container",
      "filesystem.workspace-read-write",
      "network.none",
    ]);
  });

  it("reports unsupported policy combinations before spawning", () => {
    const docker = normalizeAgentSandbox(true, {
      settings: { filesystem: { denyRead: [".secrets"] } },
    });
    const dockerReport = assessAgentSandboxCapabilities(docker, {
      host: { platform: "linux", release: "6.8.0", arch: "x64" },
    });
    expect(dockerReport.status).toBe("unsupported");
    expect(dockerReport.unsupported).toEqual([
      expect.objectContaining({
        id: "filesystem.deny-read",
        reason: "docker_fine_grained_filesystem_unsupported",
      }),
    ]);
    expect(() => assertSandboxCapabilities(docker)).toThrow(
      /filesystem\.deny-read/,
    );

    const restrictedNetwork = normalizeAgentSandbox(true, {
      network: true,
      settings: { network: { allowedDomains: ["registry.npmjs.org"] } },
    });
    expect(
      assessAgentSandboxCapabilities(restrictedNetwork).unsupported,
    ).toEqual([
      expect.objectContaining({
        id: "network.domain-policy",
        reason: "domain_policy_has_no_non_bypassable_backend",
      }),
    ]);
    _deps.spawnSync = vi.fn();
    const result = executeSandboxedShell("npm view chalk", restrictedNetwork);
    expect(result.failedToStart).toBe(true);
    expect(result.sandboxCapabilities.applied).toEqual([]);
    expect(_deps.spawnSync).not.toHaveBeenCalled();
  });

  it("reports host/backend mismatches without extrapolating support", () => {
    const bubblewrap = normalizeAgentSandbox(true, {
      settings: { engine: "bubblewrap" },
    });
    const report = assessAgentSandboxCapabilities(bubblewrap, {
      host: { platform: "win32", release: "10.0.26100", arch: "x64" },
    });
    expect(report.status).toBe("unsupported");
    expect(report.enforceable).toEqual([]);
    expect(report.unsupported).toEqual([
      expect.objectContaining({
        id: "backend.platform",
        reason: "bubblewrap_requires_linux",
      }),
    ]);
  });

  it("fails closed instead of pretending domain filtering is active", () => {
    const result = executeSandboxedShell(
      "npm view chalk version",
      normalizeAgentSandbox(true, {
        network: true,
        settings: { network: { allowedDomains: ["registry.npmjs.org"] } },
      }),
    );
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/no non-bypassable backend enforcement/i);
  });

  it("does not mistake Docker proxy env for domain enforcement", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "ok\n", stderr: "" }));
    const sandbox = normalizeAgentSandbox(true, {
      network: true,
      settings: { network: { allowedDomains: ["registry.npmjs.org"] } },
    });
    const result = executeSandboxedShell("npm view chalk version", sandbox, {
      egressProxy: { port: 54321 },
    });
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/no non-bypassable backend enforcement/i);
    expect(_deps.spawnSync).not.toHaveBeenCalled();
  });

  it("does not mistake bubblewrap proxy env for domain enforcement", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "ok\n", stderr: "" }));
    _deps.host = () => ({ platform: "linux", release: "test", arch: "x64" });
    const sandbox = normalizeAgentSandbox(true, {
      cwd: process.cwd(),
      network: true,
      settings: {
        engine: "bubblewrap",
        network: { allowedDomains: ["registry.npmjs.org"] },
      },
    });
    const result = executeSandboxedShell("npm test", sandbox, {
      egressProxy: { port: 45678 },
    });
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/no non-bypassable backend enforcement/i);
    expect(_deps.spawnSync).not.toHaveBeenCalled();
  });

  it("builds a bubblewrap invocation with a read-only host and writable workspace", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "ok\n", stderr: "" }));
    _deps.host = () => ({ platform: "linux", release: "test", arch: "x64" });
    const sandbox = normalizeAgentSandbox(true, {
      cwd: process.cwd(),
      settings: { engine: "bubblewrap" },
    });
    const result = executeSandboxedShell("npm test", sandbox, {
      timeout: 2000,
    });
    expect(result.exitCode).toBe(0);
    const [file, args, opts] = _deps.spawnSync.mock.calls[0];
    expect(file).toBe("bwrap");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--ro-bind");
    expect(args).toContain("--bind");
    expect(args).not.toContain("--share-net");
    expect(args.at(-1)).toBe("npm test");
    expect(opts).toMatchObject({
      origin: "agent-sandbox:bubblewrap",
      scope: "sandbox",
      policy: "allow",
      shell: false,
    });
  });

  it("fails closed when bubblewrap is unavailable", () => {
    const error = new Error("spawn bwrap ENOENT");
    error.code = "ENOENT";
    _deps.spawnSync = vi.fn(() => ({
      error,
      status: null,
      stdout: "",
      stderr: "",
    }));
    _deps.host = () => ({ platform: "linux", release: "test", arch: "x64" });
    const result = executeSandboxedShell(
      "echo unsafe",
      normalizeAgentSandbox(true, { settings: { engine: "bubblewrap" } }),
    );
    expect(result.failedToStart).toBe(true);
    expect(result.stderr).toMatch(/bubblewrap is not installed/i);
  });

  it("is enforced by run_shell and returns a decision trace", async () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "sandboxed\n",
      stderr: "",
      signal: null,
    }));
    const result = await executeTool(
      "run_shell",
      { command: "echo sandboxed" },
      {
        sandbox: normalizeAgentSandbox(true),
        approvalGate: {
          decide: async () => ({
            decision: "allow",
            via: "policy",
            policy: "autopilot",
          }),
        },
      },
    );
    expect(result.stdout).toBe("sandboxed\n");
    expect(result.sandbox.network).toBe("disabled");
    expect(result.policyTrace).toEqual(["shell-policy", "approval", "sandbox"]);
  });

  it("denies the real run_shell path when ApprovalGate is unavailable", async () => {
    _deps.spawnSync = vi.fn();
    const result = await executeTool(
      "run_shell",
      { command: "echo must-not-run" },
      { sandbox: normalizeAgentSandbox(true) },
    );

    expect(result).toMatchObject({
      approval: {
        decision: "deny",
        via: "approval-gate-unavailable",
      },
    });
    expect(result.error).toMatch(/ApprovalGate/);
    expect(_deps.spawnSync).not.toHaveBeenCalled();
  });
});

describe("strict sandbox mode (gap 2026-07-11: failIfUnavailable + isolation level)", () => {
  it("isolationLevel maps engines to the true confinement tier", () => {
    expect(isolationLevel(null)).toBe("policy-only");
    expect(isolationLevel(normalizeAgentSandbox(true, { settings: {} }))).toBe(
      "container",
    );
    expect(
      isolationLevel(
        normalizeAgentSandbox(true, { settings: { engine: "bubblewrap" } }),
      ),
    ).toBe("os-sandbox");
  });

  it("sandboxSummary surfaces isolationLevel", () => {
    const summary = sandboxSummary(normalizeAgentSandbox(true));
    expect(summary.isolationLevel).toBe("container");
  });

  it("probeSandboxAvailability reports a missing engine binary", () => {
    const error = new Error("spawn docker ENOENT");
    error.code = "ENOENT";
    const deps = { spawnSync: vi.fn(() => ({ error, status: null })) };
    const probe = probeSandboxAvailability(normalizeAgentSandbox(true), deps);
    expect(probe.available).toBe(false);
    expect(probe.reason).toMatch(/docker is not installed/i);
    // docker installed but daemon down (probe exits non-zero)
    const daemonDown = {
      spawnSync: vi.fn(() => ({
        status: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
      })),
    };
    const probe2 = probeSandboxAvailability(
      normalizeAgentSandbox(true),
      daemonDown,
    );
    expect(probe2.available).toBe(false);
    expect(probe2.reason).toMatch(/daemon/i);
  });

  it("routes the default availability probe through the broker", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "27", stderr: "" }));

    expect(probeSandboxAvailability(normalizeAgentSandbox(true))).toEqual({
      available: true,
      reason: null,
    });
    expect(_deps.spawnSync).toHaveBeenCalledWith(
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      expect.objectContaining({
        origin: "agent-sandbox:probe",
        scope: "sandbox",
        policy: "allow",
        shell: false,
      }),
    );
  });

  it("assertSandboxAvailable refuses to start ONLY under failIfUnavailable", () => {
    const error = new Error("spawn bwrap ENOENT");
    error.code = "ENOENT";
    const deps = { spawnSync: vi.fn(() => ({ error, status: null })) };
    const strict = normalizeAgentSandbox(true, {
      settings: { engine: "bubblewrap", failIfUnavailable: true },
    });
    expect(() => assertSandboxAvailable(strict, deps)).toThrow(
      /refusing to start/i,
    );
    // Same broken engine WITHOUT the flag → no throw (per-command degradation)
    const lax = normalizeAgentSandbox(true, {
      settings: { engine: "bubblewrap" },
    });
    expect(() => assertSandboxAvailable(lax, deps)).not.toThrow();
    // Healthy engine + flag → no throw
    const healthy = { spawnSync: vi.fn(() => ({ status: 0, stdout: "27" })) };
    expect(() => assertSandboxAvailable(strict, healthy)).not.toThrow();
    // No sandbox at all → no probe, no throw
    expect(() => assertSandboxAvailable(null, deps)).not.toThrow();
  });
});
