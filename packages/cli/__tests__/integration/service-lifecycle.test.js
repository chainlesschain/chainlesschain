import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findComposeFile } from "../../src/lib/service-manager.js";

describe("service lifecycle (integration)", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-svc-int-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("findComposeFile resolves from project root structure", () => {
    // Simulate project structure: backend/docker/docker-compose.yml
    const dockerDir = join(tempDir, "backend", "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(
      join(dockerDir, "docker-compose.yml"),
      'version: "3"\nservices:\n  ollama:\n    image: ollama/ollama',
    );

    const result = findComposeFile([tempDir, dockerDir]);
    expect(result).toBe(join(dockerDir, "docker-compose.yml"));
  });

  it("findComposeFile returns null for empty directory", () => {
    expect(findComposeFile([tempDir])).toBeNull();
  });
});
