import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import persistentSettings from "../../src/lib/settings-permission-authority.cjs";
import { createPermissionRulesProvider } from "../../src/lib/permission-authority.js";

describe("production persistent settings permission runtime", () => {
  it.skipIf(process.platform !== "linux")(
    "projects native CJS observations through their original brand owner in the ESM host",
    async () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-permission-esm-host-"),
      );
      const cwd = path.join(root, "workspace");
      const directory = path.join(root, "authority");
      fs.mkdirSync(cwd);
      fs.mkdirSync(path.join(cwd, ".claude"));
      fs.mkdirSync(directory, { mode: 0o700 });
      fs.writeFileSync(
        path.join(cwd, ".claude", "settings.json"),
        JSON.stringify({ permissions: { deny: ["Bash"] } }),
      );
      let binding;
      try {
        const launch = persistentSettings.initializeSettingsPermissionAuthority(
          {
            directory,
            forbiddenRoots: [cwd],
            contexts: [
              {
                contextId: "workspace",
                cwd,
                userSettingsFile: path.join(root, "user.json"),
                managedSettingsFile: path.join(root, "managed.json"),
                scopedFile: path.join(root, "scoped.json"),
              },
            ],
          },
        );
        binding = persistentSettings.openSettingsPermissionAuthority({
          launch,
          contextId: "workspace",
        });
        const provider = createPermissionRulesProvider({
          cwd,
          settingsAuthority: binding,
          env: {},
        });
        expect(provider().rules.deny).toEqual(["Bash"]);
        expect(() =>
          persistentSettings.projectSettingsPermissionObservation(
            { sources: [] },
            { env: {} },
          ),
        ).toThrow("strict settings source observation");
        const { executeTool } = await import("../../src/runtime/agent-core.js");
        const result = await executeTool(
          "run_shell",
          { command: "echo must-not-run" },
          { cwd, permissionRulesProvider: provider },
        );
        expect(result.policy.decision).toBe("deny");
      } finally {
        if (binding)
          persistentSettings.closeSettingsPermissionAuthority(binding);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
  it("uses official child/Worker writers and observes actual connection teardown, or refuses unsupported platforms", () => {
    const fixture = fileURLToPath(
      new URL(
        "../fixtures/settings-permission-runtime-probe.cjs",
        import.meta.url,
      ),
    );
    const result = spawnSync(process.execPath, [fixture], {
      encoding: "utf8",
      timeout: 90000,
      windowsHide: true,
    });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.supported).toBe(process.platform === "linux");
    if (report.supported) {
      expect(report.passed).toBeGreaterThanOrEqual(16);
      expect(report.cases).toContain(
        "scoped-worker-aba-never-restores-old-permit",
      );
      expect(report.cases).toContain(
        "controlled-host-entry-pins-runtime-and-official-writers",
      );
      expect(report.cases).toContain(
        "production-child-writer-revokes-provider",
      );
      expect(report.cases).toContain("worker-launch-domain-and-official-write");
      expect(report.cases).toContain(
        "real-proxy-connection-and-native-child-stop-ack",
      );
    } else expect(report.cases).toEqual(["unsupported-platform-denied"]);
  }, 95000);
});
