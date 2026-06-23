/**
 * 主进程日志管理器测试 — src/main/utils/logger.js
 *
 * 回归点（与 @chainlesschain/shared-logger 同源的两处缺陷）：
 * 1) cleanup() 早先 readdirSync 整个日志目录后按 mtime 删除任意文件，缺少
 *    chainlesschain-*.log 过滤 → 会误删共享目录里的无关文件，且对子目录
 *    unlinkSync 抛 EISDIR 中断循环，使真正的旧日志反而残留。
 * 2) rotateLogsIfNeeded() 用 currentFile.replace(".log", …) 取轮转名，replace
 *    命中第一个 ".log"，当日志目录路径自身含 ".log" 时会改坏重命名目标路径。
 *
 * Logger 构造在非 Electron 环境下经 getApp() 回退到临时目录，故可单测；
 * 每个用例覆盖 instance.logDir 到独立临时目录以隔离。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// A global test setup mocks this logger module; pull the real Logger so we
// exercise the actual cleanup()/rotateLogsIfNeeded() implementations.
const { Logger } = await vi.importActual("../../../src/main/utils/logger.js");

let dirCounter = 0;
function freshDir() {
  const d = path.join(
    os.tmpdir(),
    `cc-logger-test-${process.pid}-${dirCounter++}`,
  );
  fs.mkdirSync(d, { recursive: true });
  return d;
}

describe("main logger — cleanup", () => {
  let logger;
  let dir;

  beforeEach(() => {
    logger = new Logger("test");
    logger.setConfig({ console: false });
    dir = freshDir();
    logger.logDir = dir;
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("only deletes old chainlesschain log files, leaving other files untouched", () => {
    const oldMtime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const oldLog = path.join(dir, "chainlesschain-2000-01-01.log");
    const recentLog = path.join(dir, "chainlesschain-2999-01-01.log");
    const unrelated = path.join(dir, "config.json");
    fs.writeFileSync(oldLog, "old", "utf8");
    fs.writeFileSync(recentLog, "recent", "utf8");
    fs.writeFileSync(unrelated, "{}", "utf8");
    fs.utimesSync(oldLog, oldMtime, oldMtime);
    fs.utimesSync(unrelated, oldMtime, oldMtime);

    const deleted = logger.cleanup(7);

    expect(deleted).toBe(1);
    expect(fs.existsSync(oldLog)).toBe(false);
    expect(fs.existsSync(recentLog)).toBe(true);
    // An unrelated old file must NOT be deleted by log cleanup.
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it("does not abort on a subdirectory in the log dir", () => {
    const oldMtime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const oldLog = path.join(dir, "chainlesschain-2000-01-01.log");
    const subDir = path.join(dir, "archive");
    fs.writeFileSync(oldLog, "old", "utf8");
    fs.mkdirSync(subDir);
    fs.utimesSync(oldLog, oldMtime, oldMtime);
    fs.utimesSync(subDir, oldMtime, oldMtime);

    // Previously unlinkSync on the subdir threw EISDIR and the old log
    // survived; now cleanup ignores the subdir and removes the log.
    const deleted = logger.cleanup(7);

    expect(deleted).toBe(1);
    expect(fs.existsSync(oldLog)).toBe(false);
    expect(fs.existsSync(subDir)).toBe(true);
  });
});

describe("main logger — rotation", () => {
  it("rotates without corrupting a log dir whose path contains '.log'", () => {
    const base = freshDir();
    const trickyDir = path.join(base, "my.log.archive");
    fs.mkdirSync(trickyDir, { recursive: true });

    const logger = new Logger("tricky");
    logger.setConfig({
      console: false,
      fileConfig: { maxSize: 1, maxFiles: 10 },
    });
    logger.logDir = trickyDir;

    // Make the current daily log exceed maxSize so rotation triggers.
    fs.writeFileSync(logger.getCurrentLogFile(), "xxxxxxxxxx", "utf8");
    logger.rotateLogsIfNeeded();

    const files = fs.readdirSync(trickyDir);
    // Rotated file carries a 13+ digit ms-epoch suffix and must land directly
    // inside trickyDir — proving the extension-only replacement didn't mangle
    // the "my.log.archive" directory segment.
    const rotated = files.filter((f) => /-\d{13,}\.log$/.test(f));
    expect(rotated.length).toBeGreaterThanOrEqual(1);

    fs.rmSync(base, { recursive: true, force: true });
  });
});
