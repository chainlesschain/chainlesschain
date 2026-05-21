/**
 * database.js 包装层 passthrough regression
 *
 * 历史背景：8 处复制粘贴 anti-pattern `(arg = DEFAULT)` 把入参用默认值覆盖
 * 后再传给内部函数。最先发现的实例 (getKnowledgeItems) 让
 * markdown-exporter.exportAll(9999) 真实只导 100 条，git provider 同步
 * 默默漏数据。详见 docs/design/Phase3c_OSS_WebDAV_网盘_设计文档.md §6。
 *
 * 本测试用 **source-pattern regression** 防 re-introduction：8 个针对性
 * regex，每个验证一个 wrapper 方法的 call-site 没有 assignment-as-arg
 * anti-pattern + 真在原样传 var 名。
 *
 * 为什么不用 vi.mock + behavior test：database.js 用 createRequire 加载
 * inner CJS 模块，vi.mock 走 ESM loader → 跨边界 spy 不能共享模块实例
 * （见 memory `vi_mock_cjs_interop_systemic.md`）。source regex 100% 稳定
 * 且足够防 re-introduction。
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(__dirname, "..", "database.js");

function readSource() {
  return fs.readFileSync(databasePath, "utf-8");
}

describe("database.js · 包装层 passthrough — source regression", () => {
  it("source file exists + is non-empty", () => {
    const src = readSource();
    expect(src.length).toBeGreaterThan(1000);
  });

  it("getKnowledgeItems passes limit / offset (no assignment override)", () => {
    const src = readSource();
    expect(src).toMatch(
      /_getKnowledgeItems\(this,\s*logger,\s*limit,\s*offset\)/,
    );
    // Anti-bug: should NOT contain (limit = 100)
    expect(src).not.toMatch(
      /_getKnowledgeItems\(this,\s*logger,\s*\(limit\s*=/,
    );
  });

  it("cleanupSoftDeleted passes olderThanDays (no override)", () => {
    const src = readSource();
    expect(src).toMatch(
      /_cleanupSoftDeleted\(this,\s*logger,\s*tableName,\s*olderThanDays\)/,
    );
    expect(src).not.toMatch(
      /_cleanupSoftDeleted\(this,\s*logger,\s*tableName,\s*\(olderThanDays/,
    );
  });

  it("cleanupAllSoftDeleted passes olderThanDays (no override)", () => {
    const src = readSource();
    expect(src).toMatch(
      /_cleanupAllSoftDeleted\(this,\s*logger,\s*olderThanDays\)/,
    );
    expect(src).not.toMatch(
      /_cleanupAllSoftDeleted\(this,\s*logger,\s*\(olderThanDays/,
    );
  });

  it("startPeriodicCleanup passes intervalHours / retentionDays (no override)", () => {
    const src = readSource();
    expect(src).toMatch(
      /_startPeriodicCleanup\(this,\s*logger,\s*intervalHours,\s*retentionDays\)/,
    );
    // Anti-bug: assignment-as-arg inside _startPeriodicCleanup call only;
    // method signature `startPeriodicCleanup(intervalHours = 24, ...)` is legit
    expect(src).not.toMatch(/_startPeriodicCleanup\([^)]*\(intervalHours\s*=/s);
    expect(src).not.toMatch(/_startPeriodicCleanup\([^)]*\(retentionDays\s*=/s);
  });

  it("addRelation passes weight / metadata (no override)", () => {
    const src = readSource();
    expect(src).toMatch(
      /sourceId,\s*targetId,\s*type,\s*weight,\s*metadata,?/s,
    );
    expect(src).not.toMatch(/_addRelation\([^)]*\(weight\s*=/s);
    expect(src).not.toMatch(/_addRelation\([^)]*\(metadata\s*=/s);
  });

  it("findRelationPath passes maxDepth (no override)", () => {
    const src = readSource();
    expect(src).toMatch(
      /_findRelationPath\(this,\s*logger,\s*sourceId,\s*targetId,\s*maxDepth\)/,
    );
    expect(src).not.toMatch(/_findRelationPath\([^)]*\(maxDepth\s*=/s);
  });

  it("getKnowledgeNeighbors passes depth (no override)", () => {
    const src = readSource();
    expect(src).toMatch(
      /_getKnowledgeNeighbors\(this,\s*logger,\s*knowledgeId,\s*depth\)/,
    );
    expect(src).not.toMatch(/_getKnowledgeNeighbors\([^)]*\(depth\s*=/s);
  });

  it("buildTemporalRelations passes windowDays (no override)", () => {
    const src = readSource();
    expect(src).toMatch(
      /_buildTemporalRelations\(this,\s*logger,\s*windowDays\)/,
    );
    expect(src).not.toMatch(/_buildTemporalRelations\([^)]*\(windowDays\s*=/s);
  });

  it("DELETED bug patterns absent in fixed source (all 8 sites)", () => {
    const src = readSource();
    // 全 8 处禁用的赋值表达式 — 任何 re-introduction 必 fail
    const forbidden = [
      /_getKnowledgeItems\([^)]*\(limit\s*=/,
      /_cleanupSoftDeleted\([^)]*\(olderThanDays\s*=/,
      /_cleanupAllSoftDeleted\([^)]*\(olderThanDays\s*=/,
      /_startPeriodicCleanup\([^)]*\(intervalHours\s*=/s,
      /_startPeriodicCleanup\([^)]*\(retentionDays\s*=/s,
      /_addRelation\([^)]*\(weight\s*=/s,
      /_addRelation\([^)]*\(metadata\s*=/s,
      /_findRelationPath\([^)]*\(maxDepth\s*=/s,
      /_getKnowledgeNeighbors\([^)]*\(depth\s*=/s,
      /_buildTemporalRelations\([^)]*\(windowDays\s*=/s,
    ];
    const hits = forbidden
      .map((re) => ({ re: re.source, hit: re.test(src) }))
      .filter((h) => h.hit);
    expect(hits, JSON.stringify(hits, null, 2)).toHaveLength(0);
  });
});
