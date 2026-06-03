import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findComposeFile } from "../../src/lib/service-manager.js";

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
