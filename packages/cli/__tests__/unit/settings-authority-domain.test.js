import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

describe("pinned persistent settings authority domain", () => {
  it("validates real child/worker transactions and crash recovery on Linux, or refuses unsupported platforms", () => {
    const fixture = fileURLToPath(
      new URL(
        "../fixtures/settings-authority-domain-probe.cjs",
        import.meta.url,
      ),
    );
    const result = spawnSync(process.execPath, [fixture], {
      encoding: "utf8",
      timeout: 60000,
    });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.schema).toBe("settings-authority-domain-probe/v1");
    expect(report.supported).toBe(process.platform === "linux");
    if (report.supported) {
      expect(report.passed).toBeGreaterThanOrEqual(58);
      expect(report.cases).toContain("fresh-process-official-aba");
      expect(report.cases).toContain("worker-reopen-after-aba");
      expect(report.cases).toContain("kill-ready:directory-fsync");
      expect(report.cases).toContain("fault-cleanup:directory-fsync");
    } else {
      expect(report.cases).toEqual(["unsupported-platform-denied"]);
    }
  }, 65000);
});
