/**
 * file-integrity 单元测试 —— 魔数类型校验、哈希计算/校验(+损坏事件)、checkFile
 * 多路径、备份创建/恢复往返、保留裁剪、最新有效备份查找(校验和回退)。
 */

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { FileIntegrityChecker } = require("../file-integrity.js");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

let dir;
let checker;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-integrity-"));
  checker = new FileIntegrityChecker({ backupDir: dir, maxBackups: 2 });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name, content) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};

describe("_validateFileType", () => {
  it("matches known magic numbers and rejects mismatches", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
    expect(checker._validateFileType(png, "png")).toBe(true);
    expect(checker._validateFileType(png, "pdf")).toBe(false);
    const pdf = Buffer.from("%PDF-1.4");
    expect(checker._validateFileType(pdf, "pdf")).toBe(true);
  });

  it("passes unknown types and rejects too-short content", () => {
    expect(checker._validateFileType(Buffer.from("abcd"), "weird")).toBe(true);
    expect(checker._validateFileType(Buffer.from([1, 2]), "png")).toBe(false);
  });
});

describe("calculateFileHash / verifyFile", () => {
  it("hashes a file and verifies a matching hash", async () => {
    const p = write("a.txt", "hello");
    const hash = await checker.calculateFileHash(p);
    expect(hash).toBe(sha256("hello"));
    expect(await checker.verifyFile(p, hash)).toBe(true);
  });

  it("returns false and emits corruption-detected on a hash mismatch", async () => {
    const p = write("a.txt", "hello");
    const spy = vi.fn();
    checker.on("corruption-detected", spy);
    expect(await checker.verifyFile(p, "deadbeef")).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: p, expectedHash: "deadbeef" }),
    );
  });

  it("returns false when the file cannot be read", async () => {
    expect(
      await checker.verifyFile(path.join(dir, "missing"), "x"),
    ).toBe(false);
  });
});

describe("checkFile", () => {
  it("flags a non-existent file", async () => {
    const r = await checker.checkFile(path.join(dir, "nope"));
    expect(r.exists).toBe(false);
    expect(r.issues).toContain("文件不存在");
  });

  it("flags an empty file as corrupt unless allowEmpty", async () => {
    const p = write("empty.bin", "");
    expect((await checker.checkFile(p)).corrupt).toBe(true);
    expect((await checker.checkFile(p, { allowEmpty: true })).corrupt).toBe(false);
  });

  it("flags a file-type magic-number mismatch", async () => {
    const p = write("fake.png", "not really a png");
    const r = await checker.checkFile(p, { fileType: "png" });
    expect(r.corrupt).toBe(true);
    expect(r.issues.some((i) => i.includes("文件类型不匹配"))).toBe(true);
  });

  it("passes a healthy file and flags a hash mismatch", async () => {
    const p = write("ok.txt", "data");
    expect((await checker.checkFile(p)).corrupt).toBe(false);
    const bad = await checker.checkFile(p, { expectedHash: "nope" });
    expect(bad.corrupt).toBe(true);
    expect(bad.issues).toContain("文件校验和不匹配");
  });
});

describe("backup create / restore", () => {
  it("creates a backup with a checksum sidecar", async () => {
    const p = write("data.bin", "v1");
    const backupPath = await checker.createBackup(p);
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(`${backupPath}.checksum`, "utf8")).toBe(sha256("v1"));
  });

  it("restores the original content from the latest valid backup", async () => {
    const p = write("data.bin", "v1");
    await checker.createBackup(p);
    fs.writeFileSync(p, "corrupted"); // simulate corruption
    const res = await checker.restoreFromBackup(p);
    expect(res.success).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toBe("v1");
  });
});

describe("_cleanOldBackups retention", () => {
  it("keeps the newest maxBackups and deletes older ones", async () => {
    for (const ts of [1, 2, 3]) {
      write(`f.backup.${ts}`, `c${ts}`);
      write(`f.backup.${ts}.checksum`, sha256(`c${ts}`));
    }
    await checker._cleanOldBackups(dir, "f"); // maxBackups = 2
    expect(fs.existsSync(path.join(dir, "f.backup.1"))).toBe(false); // oldest gone
    expect(fs.existsSync(path.join(dir, "f.backup.3"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "f.backup.1.checksum"))).toBe(false);
  });
});

describe("_findLatestValidBackup", () => {
  it("returns the newest backup with a valid checksum", async () => {
    write("f.backup.1", "a");
    write("f.backup.1.checksum", sha256("a"));
    write("f.backup.2", "b");
    write("f.backup.2.checksum", sha256("b"));
    const found = await checker._findLatestValidBackup(dir, "f");
    expect(found).toBe(path.join(dir, "f.backup.2"));
  });

  it("falls back to an older backup when the newest checksum is invalid", async () => {
    write("f.backup.1", "a");
    write("f.backup.1.checksum", sha256("a"));
    write("f.backup.2", "b");
    write("f.backup.2.checksum", "wronghash"); // newest is invalid
    const found = await checker._findLatestValidBackup(dir, "f");
    expect(found).toBe(path.join(dir, "f.backup.1"));
  });
});
