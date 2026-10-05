import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  runControlledHost,
  registerControlledHostCommand,
} from "../../src/commands/agent-controlled-host.js";
import { initializePermissionAuthorityHost } from "../../src/runtime/permission-authority-host.js";

const roots = [];
const originalExitCode = process.exitCode;
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-controlled-host-"));
  roots.push(root);
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  const launch = path.join(root, "launch.json");
  fs.writeFileSync(launch, "{}");
  const sandboxSettings = path.join(root, "sandbox.json");
  fs.writeFileSync(
    sandboxSettings,
    JSON.stringify({
      engine: "docker-egress",
      image: `node@sha256:${"a".repeat(64)}`,
      relayImage: `node@sha256:${"b".repeat(64)}`,
      network: { allowedDomains: ["example.com"] },
    }),
  );
  const host = {
    runtimeOptions: vi.fn((options) => options),
    capabilities: vi.fn(() => ({
      execution: { started: false },
      backend: { available: null },
    })),
    runHeadless: vi.fn(async () => ({ exitCode: 0 })),
    close: vi.fn(),
  };
  return {
    root,
    cwd,
    host,
    options: { launch, sandboxSettings, context: "workspace", check: true },
    deps: {
      platform: "linux",
      cwd,
      env: {},
      openHost: vi.fn(() => host),
      writeOut: vi.fn(),
      assertAvailable: vi.fn(),
    },
  };
}

function task(options) {
  return {
    ...options,
    check: false,
    prompt: "Inspect this project",
    provider: "ollama",
    model: "fixture-only",
    baseUrl: "http://127.0.0.1:11434",
  };
}

describe("explicit controlled-host CLI entry", () => {
  it.each(["win32", "darwin"])(
    "refuses %s before any file or host access",
    async (platform) => {
      const openHost = vi.fn();
      await expect(
        runControlledHost({}, { platform, openHost }),
      ).rejects.toMatchObject({
        code: "CC_SETTINGS_AUTHORITY_PLATFORM_UNSUPPORTED",
      });
      expect(openHost).not.toHaveBeenCalled();
    },
  );
  it("checks identity without a backend probe or model request, then closes", async () => {
    const f = fixture();
    const result = await runControlledHost(f.options, f.deps);
    expect(result.report).toMatchObject({
      authorityIdentityVerified: true,
      backendExecutionVerified: false,
      backendAvailabilityProbed: false,
    });
    expect(f.host.runtimeOptions).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: f.cwd }),
    );
    expect(f.deps.assertAvailable).not.toHaveBeenCalled();
    expect(f.host.runHeadless).not.toHaveBeenCalled();
    expect(f.host.close).toHaveBeenCalledOnce();
  });
  it("refuses a hermetic environment that would suppress the durable provider", async () => {
    const f = fixture();
    await expect(
      runControlledHost(f.options, {
        ...f.deps,
        env: {
          CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
          CHAINLESSCHAIN_HOME: path.join(f.root, "home"),
        },
      }),
    ).rejects.toThrow("suppresses permission providers");
    expect(f.deps.openHost).not.toHaveBeenCalled();
  });
  it("refuses missing launch bytes and never creates or provisions them", async () => {
    const f = fixture();
    fs.unlinkSync(f.options.launch);
    await expect(runControlledHost(f.options, f.deps)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(fs.existsSync(f.options.launch)).toBe(false);
    expect(f.deps.openHost).not.toHaveBeenCalled();
  });
  it.each(["relative.json", null])(
    "refuses nonabsolute launch %s",
    async (launch) => {
      const f = fixture();
      await expect(
        runControlledHost({ ...f.options, launch }, f.deps),
      ).rejects.toThrow("absolute");
      expect(f.deps.openHost).not.toHaveBeenCalled();
    },
  );
  it("bounds descriptor reads", async () => {
    const f = fixture();
    fs.writeFileSync(f.options.launch, " ".repeat(1024 * 1024 + 1));
    await expect(runControlledHost(f.options, f.deps)).rejects.toThrow("size");
    expect(f.deps.openHost).not.toHaveBeenCalled();
  });
  it("rejects disabled or unsupported sandbox before opening authority", async () => {
    const f = fixture();
    fs.writeFileSync(
      f.options.sandboxSettings,
      JSON.stringify({ engine: "docker" }),
    );
    await expect(runControlledHost(f.options, f.deps)).rejects.toThrow(
      "docker-egress",
    );
    expect(f.deps.openHost).not.toHaveBeenCalled();
  });
  it("closes on workspace/authority validation failure without running", async () => {
    const f = fixture();
    f.host.runtimeOptions.mockImplementation(() => {
      throw new Error("workspace mismatch");
    });
    await expect(runControlledHost(task(f.options), f.deps)).rejects.toThrow(
      "workspace mismatch",
    );
    expect(f.deps.assertAvailable).not.toHaveBeenCalled();
    expect(f.host.runHeadless).not.toHaveBeenCalled();
    expect(f.host.close).toHaveBeenCalledOnce();
  });
  it("fails backend preflight before credentials or provider execution", async () => {
    const f = fixture();
    f.deps.assertAvailable.mockImplementation(() => {
      throw new Error("backend unavailable");
    });
    await expect(
      runControlledHost(
        { ...task(f.options), apiKeyEnv: "INVALID-key" },
        f.deps,
      ),
    ).rejects.toThrow("backend unavailable");
    expect(f.host.runHeadless).not.toHaveBeenCalled();
    expect(f.host.close).toHaveBeenCalledOnce();
  });
  it("uses the host runner with fixed dontAsk and closes after rejection", async () => {
    const f = fixture();
    f.host.runHeadless.mockRejectedValue(new Error("runtime failed"));
    await expect(
      runControlledHost(
        { ...task(f.options), permissionMode: "bypassPermissions" },
        f.deps,
      ),
    ).rejects.toThrow("runtime failed");
    expect(f.host.runHeadless).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionMode: "dontAsk",
        cwd: f.cwd,
        sandbox: expect.objectContaining({ engine: "docker-egress" }),
      }),
      undefined,
    );
    expect(f.host.close).toHaveBeenCalledOnce();
  });
  it("routes Commander child options and refuses parent permission overrides", async () => {
    const f = fixture();
    const parse = async (prefix) => {
      const program = new Command().exitOverride();
      const agent = program.command("agent").option("--yolo");
      registerControlledHostCommand(agent, f.deps);
      await program.parseAsync(
        [
          "agent",
          ...prefix,
          "controlled-host",
          "--launch",
          f.options.launch,
          "--context",
          "workspace",
          "--sandbox-settings",
          f.options.sandboxSettings,
          "--check",
        ],
        { from: "user" },
      );
    };
    await parse([]);
    expect(process.exitCode).toBe(0);
    expect(f.host.close).toHaveBeenCalledOnce();
    const errors = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await parse(["--yolo"]);
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("parent agent flags"),
    );
    expect(f.deps.openHost).toHaveBeenCalledOnce();
  });
});

describe.skipIf(process.platform !== "linux")(
  "real Linux authority at the CLI boundary",
  () => {
    function provision() {
      const f = fixture();
      fs.mkdirSync(path.join(f.cwd, ".claude"));
      fs.writeFileSync(
        path.join(f.cwd, ".claude", "settings.json"),
        JSON.stringify({
          permissions: { allow: ["Read"], deny: [] },
        }),
      );
      const directory = path.join(f.root, "authority");
      fs.mkdirSync(directory, { mode: 0o700 });
      const launch = initializePermissionAuthorityHost({
        directory,
        forbiddenRoots: [f.cwd],
        contexts: [
          {
            contextId: "workspace",
            cwd: f.cwd,
            userSettingsFile: path.join(f.root, "user.json"),
            managedSettingsFile: path.join(f.root, "managed.json"),
            scopedFile: path.join(f.root, "scoped.json"),
          },
        ],
      });
      fs.writeFileSync(f.options.launch, JSON.stringify(launch));
      delete f.deps.openHost;
      return { ...f, directory, launch };
    }
    it("reopens a real identity for check; rejects other cwd/context and missing ledger", async () => {
      const f = provision();
      const checked = await runControlledHost(f.options, f.deps);
      expect(checked.report.capabilities.support.permissionSource).toBe(
        "durable-controlled-host",
      );
      expect(
        checked.report.capabilities.support.persistentNetworkRevocation
          .executionObserved,
      ).toBe(false);
      await expect(
        runControlledHost(f.options, { ...f.deps, cwd: f.root }),
      ).rejects.toThrow("mismatch");
      await expect(
        runControlledHost({ ...f.options, context: "other" }, f.deps),
      ).rejects.toThrow();
      fs.unlinkSync(path.join(f.directory, "ledger.json"));
      await expect(runControlledHost(f.options, f.deps)).rejects.toThrow();
      expect(fs.existsSync(path.join(f.directory, "ledger.json"))).toBe(false);
    });
    it("passes the real durable provider to headless and observes an official writer revision", async () => {
      const f = provision();
      let observed = false;
      const diagnostics = [];
      const outcome = await runControlledHost(task(f.options), {
        ...f.deps,
        runtimeDependencies: {
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => null,
          writeOut(text) {
            diagnostics.push(text);
          },
          writeErr(text) {
            diagnostics.push(text);
          },
          agentLoop: async function* (_messages, options) {
            expect(options.permissionRulesProvider().rules.deny).not.toContain(
              "Bash",
            );
            // A native writer process owns its CJS brand registry, exactly
            // as deployed; do not mix Vite-transformed/native WeakMaps.
            const writer = spawnSync(
              process.execPath,
              [
                fileURLToPath(
                  new URL(
                    "../fixtures/settings-permission-runtime-probe.cjs",
                    import.meta.url,
                  ),
                ),
                "--child",
              ],
              {
                input: JSON.stringify({
                  launch: f.launch,
                  command: "write",
                  kind: "deny",
                  rule: "Bash",
                }),
                encoding: "utf8",
                timeout: 15000,
                windowsHide: true,
              },
            );
            expect(writer.error).toBeUndefined();
            expect(writer.status, writer.stderr).toBe(0);
            const receipt = JSON.parse(writer.stdout);
            expect(receipt.after).not.toEqual(receipt.before);
            expect(options.permissionRulesProvider().rules.deny).toContain(
              "Bash",
            );
            observed = true;
            yield { type: "response-complete", content: "done" };
            yield { type: "run-ended", reason: "complete" };
          },
        },
      });
      expect(outcome.exitCode, JSON.stringify({ outcome, diagnostics })).toBe(
        0,
      );
      expect(observed).toBe(true);
    });
  },
);
