import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

describe("production persistent settings permission runtime", () => {
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
