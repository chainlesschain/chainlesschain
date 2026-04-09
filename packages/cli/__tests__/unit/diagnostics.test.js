/**
 * Unit tests for runtime/diagnostics.js
 *
 * These lock in the JSON schema contract for `doctor --json` and
 * `status --json` so external consumers (IDE integrations, monitoring)
 * can rely on stable shapes.
 */

import { describe, it, expect } from "vitest";
import {
  collectDoctorReport,
  collectStatusReport,
  checkPort,
} from "../../src/runtime/diagnostics.js";

describe("diagnostics.collectDoctorReport", { timeout: 60000 }, () => {
  it("returns a report with the doctor v1 schema tag", async () => {
    const report = await collectDoctorReport();
    expect(report.schema).toBe("chainlesschain.doctor.v1");
    expect(typeof report.version).toBe("string");
    expect(() => new Date(report.generatedAt).toISOString()).not.toThrow();
  });

  it("includes all expected check ids", async () => {
    const report = await collectDoctorReport();
    const ids = report.checks.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "node",
        "npm",
        "docker",
        "docker-compose",
        "git",
        "config-dir",
        "config-file",
        "desktop-binary",
        "setup-completed",
      ]),
    );
  });

  it("marks optional checks with optional=true", async () => {
    const report = await collectDoctorReport();
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.docker.optional).toBe(true);
    expect(byId["docker-compose"].optional).toBe(true);
    expect(byId["desktop-binary"].optional).toBe(true);
    expect(byId.node.optional).toBe(false);
    expect(byId.npm.optional).toBe(false);
    expect(byId.git.optional).toBe(false);
  });

  it("each check has ok/name/detail fields", async () => {
    const report = await collectDoctorReport();
    for (const check of report.checks) {
      expect(typeof check.id).toBe("string");
      expect(typeof check.name).toBe("string");
      expect(typeof check.ok).toBe("boolean");
      expect(typeof check.optional).toBe("boolean");
      expect(typeof check.detail).toBe("string");
    }
  });

  it("returns ports with name/port/open shape", async () => {
    const report = await collectDoctorReport();
    expect(Array.isArray(report.ports)).toBe(true);
    for (const p of report.ports) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.port).toBe("number");
      expect(typeof p.open).toBe("boolean");
    }
  });

  it("summary counts match checks array", async () => {
    const report = await collectDoctorReport();
    const failed = report.checks.filter((c) => !c.ok).length;
    const criticalFailed = report.checks.filter(
      (c) => !c.ok && !c.optional,
    ).length;
    expect(report.summary.total).toBe(report.checks.length);
    expect(report.summary.failed).toBe(failed);
    expect(report.summary.passed).toBe(report.checks.length - failed);
    expect(report.summary.criticalFailed).toBe(criticalFailed);
  });

  it("disk field is either null or has homeDir/freeGB", async () => {
    const report = await collectDoctorReport();
    if (report.disk !== null) {
      expect(typeof report.disk.homeDir).toBe("string");
      expect(typeof report.disk.freeGB).toBe("number");
    }
  });
});

describe("diagnostics.collectStatusReport", () => {
  it("returns a report with the status v1 schema tag", async () => {
    const report = await collectStatusReport();
    expect(report.schema).toBe("chainlesschain.status.v1");
    expect(typeof report.version).toBe("string");
    expect(() => new Date(report.generatedAt).toISOString()).not.toThrow();
  });

  it("app section has running/pid fields", async () => {
    const report = await collectStatusReport();
    expect(typeof report.app.running).toBe("boolean");
    // pid is number when running, null when not
    if (report.app.running) {
      expect(typeof report.app.pid).toBe("number");
    } else {
      expect(report.app.pid).toBeNull();
    }
  });

  it("setup section always has completed boolean", async () => {
    const report = await collectStatusReport();
    expect(typeof report.setup.completed).toBe("boolean");
  });

  it("docker section has available/composePath/services/note", async () => {
    const report = await collectStatusReport();
    expect(typeof report.docker.available).toBe("boolean");
    expect(
      report.docker.composePath === null ||
        typeof report.docker.composePath === "string",
    ).toBe(true);
    expect(
      report.docker.services === null || Array.isArray(report.docker.services),
    ).toBe(true);
  });

  it("ports array has name/port/open shape", async () => {
    const report = await collectStatusReport();
    for (const p of report.ports) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.port).toBe("number");
      expect(typeof p.open).toBe("boolean");
    }
  });
});

describe("diagnostics.checkPort", () => {
  it("resolves false for a port that is almost certainly closed", async () => {
    // Port 1 on localhost — reserved, should always be closed
    const open = await checkPort(1, "127.0.0.1", 500);
    expect(open).toBe(false);
  });

  it("resolves a boolean within timeout", async () => {
    const result = await checkPort(65535, "127.0.0.1", 500);
    expect(typeof result).toBe("boolean");
  });
});
