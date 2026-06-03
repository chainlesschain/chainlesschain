import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { computeSha256, verifySha256 } from "../../src/lib/checksum.js";

describe("checksum", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-checksum-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("computeSha256 returns correct hash for known content", async () => {
    const filePath = join(tempDir, "test.txt");
    const content = "hello chainlesschain";
    writeFileSync(filePath, content);

    const expected = createHash("sha256").update(content).digest("hex");
    const result = await computeSha256(filePath);
    expect(result).toBe(expected);
  });

  it("computeSha256 returns consistent results", async () => {
    const filePath = join(tempDir, "test.bin");
    writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0xff]));

    const hash1 = await computeSha256(filePath);
    const hash2 = await computeSha256(filePath);
    expect(hash1).toBe(hash2);
  });

  it("verifySha256 returns valid for matching hash", async () => {
    const filePath = join(tempDir, "test.txt");
    const content = "verify me";
    writeFileSync(filePath, content);

    const expectedHash = createHash("sha256").update(content).digest("hex");
    const result = await verifySha256(filePath, expectedHash);
    expect(result.valid).toBe(true);
    expect(result.actual).toBe(result.expected);
  });

  it("verifySha256 returns invalid for wrong hash", async () => {
    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "some content");

    const result = await verifySha256(filePath, "deadbeef".repeat(8));
    expect(result.valid).toBe(false);
    expect(result.actual).not.toBe(result.expected);
  });

  it("verifySha256 handles uppercase expected hash", async () => {
    const filePath = join(tempDir, "test.txt");
    const content = "case test";
    writeFileSync(filePath, content);

    const expectedHash = createHash("sha256")
      .update(content)
      .digest("hex")
      .toUpperCase();
    const result = await verifySha256(filePath, expectedHash);
    expect(result.valid).toBe(true);
  });

  it("computeSha256 rejects for nonexistent file", async () => {
    await expect(computeSha256(join(tempDir, "nope.txt"))).rejects.toThrow();
  });
});
