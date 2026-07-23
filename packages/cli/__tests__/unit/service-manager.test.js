import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  _deps,
  findComposeFile,
  getServiceStatus,
  servicesDown,
  servicesLogs,
  servicesUp,
} from "../../src/lib/service-manager.js";

describe("service-manager", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-svc-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("findComposeFile returns null when no compose file exists", () => {
    expect(findComposeFile([tempDir])).toBeNull();
  });

  it("findComposeFile finds docker-compose.yml", () => {
    const filePath = join(tempDir, "docker-compose.yml");
    writeFileSync(filePath, 'version: "3"');
    expect(findComposeFile([tempDir])).toBe(filePath);
  });

  it("findComposeFile finds docker-compose.yaml", () => {
    const filePath = join(tempDir, "docker-compose.yaml");
    writeFileSync(filePath, 'version: "3"');
    expect(findComposeFile([tempDir])).toBe(filePath);
  });

  it("findComposeFile finds compose.yml", () => {
    const filePath = join(tempDir, "compose.yml");
    writeFileSync(filePath, 'version: "3"');
    expect(findComposeFile([tempDir])).toBe(filePath);
  });

  it("findComposeFile searches multiple directories", () => {
    const subDir = join(tempDir, "sub");
    mkdirSync(subDir);
    const filePath = join(subDir, "docker-compose.yml");
    writeFileSync(filePath, 'version: "3"');
    expect(findComposeFile([tempDir, subDir])).toBe(filePath);
  });

  it("findComposeFile prefers docker-compose.yml over compose.yml", () => {
    writeFileSync(join(tempDir, "docker-compose.yml"), "v1");
    writeFileSync(join(tempDir, "compose.yml"), "v2");
    const result = findComposeFile([tempDir]);
    expect(result).toBe(join(tempDir, "docker-compose.yml"));
  });
});

describe("service-manager Broker boundary", () => {
  const originalExecFileSync = _deps.execFileSync;
  const originalSpawn = _deps.spawn;

  afterEach(() => {
    _deps.execFileSync = originalExecFileSync;
    _deps.spawn = originalSpawn;
  });

  it("passes compose paths and service names as verbatim argv", () => {
    const composePath = 'C:\\tmp\\compose "unsafe"; stop.yml';
    const service = "api; shutdown";
    _deps.execFileSync = vi.fn(() => "");

    expect(servicesUp(composePath, { services: [service] })).toBe(true);
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      1,
      "docker",
      ["compose", "version"],
      expect.objectContaining({
        origin: "service:docker",
        scope: "service",
        shell: false,
      }),
    );
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["compose", "-f", composePath, "up", "-d", service],
      expect.objectContaining({
        origin: "service:compose",
        policy: "allow",
        scope: "service",
        shell: false,
      }),
    );
  });

  it("falls back to the standalone docker-compose executable", () => {
    _deps.execFileSync = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("compose plugin unavailable");
      })
      .mockReturnValueOnce("");

    expect(servicesDown("/tmp/compose.yml")).toBe(true);
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      2,
      "docker-compose",
      ["-f", "/tmp/compose.yml", "down"],
      expect.objectContaining({ origin: "service:compose", shell: false }),
    );
  });

  it("parses status output while keeping the compose path out of a shell", () => {
    const composePath = '/tmp/compose "quoted".yml';
    _deps.execFileSync = vi.fn((_command, args) =>
      args.includes("ps") ? '{"Service":"api","State":"running"}\n' : "",
    );

    expect(getServiceStatus(composePath)).toEqual([
      { Service: "api", State: "running" },
    ]);
    expect(_deps.execFileSync).toHaveBeenLastCalledWith(
      "docker",
      ["compose", "-f", composePath, "ps", "--format", "json"],
      expect.objectContaining({
        origin: "service:compose-status",
        shell: false,
      }),
    );
  });

  it("routes streaming logs through the async Broker path", async () => {
    const child = new EventEmitter();
    _deps.execFileSync = vi.fn(() => "");
    _deps.spawn = vi.fn(() => child);

    const done = servicesLogs("/tmp/compose.yml", {
      follow: true,
      tail: 20,
      services: ["api"],
    });
    child.emit("close", 0);

    await expect(done).resolves.toBeUndefined();
    expect(_deps.spawn).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "-f",
        "/tmp/compose.yml",
        "logs",
        "-f",
        "--tail",
        "20",
        "api",
      ],
      expect.objectContaining({
        origin: "service:compose-logs",
        policy: "allow",
        scope: "service",
        shell: false,
      }),
    );
  });
});
