#!/usr/bin/env node
/**
 * TODO/FIXME 治理扫描器
 *
 * 用法:
 *   node scripts/scan-todos.js               # 默认报告
 *   node scripts/scan-todos.js --json        # JSON 输出（CI 用）
 *   node scripts/scan-todos.js --strict      # 生产 handler 含 TODO 时退出码 1
 *
 * 设计目标 (优化计划 M5):
 *   - 列出全仓 TODO/FIXME/XXX/HACK 注释
 *   - 按目录分组统计
 *   - 严格模式下，禁止生产 handler 路径中出现"占位符 TODO"
 *
 * 默认仅扫描 desktop-app-vue/src/main 与 desktop-app-vue/src/renderer
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["src/main", "src/renderer"];
const FILE_EXT = new Set([".js", ".ts", ".tsx", ".vue", ".mjs", ".cjs"]);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "build",
  "out",
  "coverage",
]);

// 严格模式禁止 TODO 的"生产 handler"路径
const PRODUCTION_HANDLER_PATTERNS = [
  /skills[/\\]builtin[/\\][^/\\]+[/\\]handler\.js$/,
  /skills[/\\]builtin[/\\][^/\\]+[/\\]handler\.ts$/,
];

// 占位符 TODO 模式（最危险，必须修）
const PLACEHOLDER_PATTERNS = [
  /TODO:\s*Implement your skill logic here/i,
  /TODO:\s*Implement data fetching/i,
  /TODO:\s*Add implementation/i,
  /Placeholder/i,
];

const TODO_REGEX = /\b(TODO|FIXME|XXX|HACK)\b[:：]?\s*(.*)/;

const args = process.argv.slice(2);
const FLAG_JSON = args.includes("--json");
const FLAG_STRICT = args.includes("--strict");

function shouldSkipDir(dirname) {
  return SKIP_DIRS.has(dirname) || dirname.startsWith(".");
}

function walk(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walk(path.join(dir, entry.name), results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!FILE_EXT.has(ext)) continue;
      results.push(path.join(dir, entry.name));
    }
  }
}

function scanFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const findings = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = TODO_REGEX.exec(line);
    if (!m) continue;
    // 跳过非注释行（避免匹配字符串字面量中的 TODO）
    const trimmed = line.trim();
    const isComment =
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("<!--");
    if (!isComment) continue;
    const tag = m[1].toUpperCase();
    const message = (m[2] || "").trim();
    findings.push({
      file: path.relative(ROOT, filePath).replace(/\\/g, "/"),
      line: i + 1,
      tag,
      message,
      isPlaceholder: PLACEHOLDER_PATTERNS.some((p) => p.test(line)),
      isProductionHandler: PRODUCTION_HANDLER_PATTERNS.some((p) =>
        p.test(filePath),
      ),
    });
  }
  return findings;
}

function main() {
  const allFiles = [];
  for (const sub of SCAN_DIRS) {
    walk(path.join(ROOT, sub), allFiles);
  }

  const findings = [];
  for (const file of allFiles) {
    findings.push(...scanFile(file));
  }

  // 按 tag 统计
  const byTag = {};
  for (const f of findings) {
    byTag[f.tag] = (byTag[f.tag] || 0) + 1;
  }

  // 按目录统计（取前 2 层）
  const byDir = {};
  for (const f of findings) {
    const parts = f.file.split("/");
    const key = parts.slice(0, 4).join("/");
    byDir[key] = (byDir[key] || 0) + 1;
  }

  // 严格模式触发条件
  const strictViolations = findings.filter(
    (f) => f.isProductionHandler && f.isPlaceholder,
  );

  if (FLAG_JSON) {
    process.stdout.write(
      JSON.stringify(
        {
          total: findings.length,
          byTag,
          byDir,
          strictViolations,
          findings,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    console.log(`\nTODO/FIXME 扫描报告 (${findings.length} 个标记)`);
    console.log("=".repeat(60));
    console.log("\n按标签:");
    for (const [tag, count] of Object.entries(byTag).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${tag.padEnd(8)} ${count}`);
    }
    console.log("\n按目录 (Top 15):");
    const dirEntries = Object.entries(byDir).sort((a, b) => b[1] - a[1]);
    for (const [dir, count] of dirEntries.slice(0, 15)) {
      console.log(`  ${count.toString().padStart(4)}  ${dir}`);
    }

    if (strictViolations.length > 0) {
      console.log(
        `\n⚠️  ${strictViolations.length} 个生产 handler 包含占位符 TODO:`,
      );
      for (const v of strictViolations) {
        console.log(`  ${v.file}:${v.line}`);
        console.log(`    [${v.tag}] ${v.message}`);
      }
    } else {
      console.log("\n✓ 未发现生产 handler 中的占位符 TODO");
    }

    console.log(
      "\n提示: --json 输出机器可读结果, --strict 在违规时退出码 1\n",
    );
  }

  if (FLAG_STRICT && strictViolations.length > 0) {
    process.exit(1);
  }
}

main();
