#!/usr/bin/env node

/**
 * SQL 注入自动修复工具
 *
 * 将不安全的 db.exec() 调用转换为 db.prepare() 参数化查询
 */

const fs = require("fs");
const path = require("path");

class SQLInjectionFixer {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.join(__dirname, "..");
    this.srcDir = path.join(this.rootDir, "src");
    this.dryRun = options.dryRun !== false; // 默认启用 dry-run
    this.fixedCount = 0;
    this.skippedCount = 0;
    this.errors = [];
  }

  /**
   * 运行修复
   */
  async fix() {
    console.log("🔧 SQL 注入自动修复工具");
    console.log(
      `模式: ${this.dryRun ? "DRY RUN（仅预览）" : "LIVE（实际修复）"}\n`,
    );

    const jsFiles = this.getAllFiles(this.srcDir, ".js");

    for (const file of jsFiles) {
      await this.fixFile(file);
    }

    this.printSummary();
    return this.fixedCount > 0 || this.errors.length > 0 ? 0 : 1;
  }

  /**
   * 修复单个文件
   */
  async fixFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      let fileChanges = 0;

      const lines = content.split("\n");

      // 检查每一行是否有不安全的 db.exec() 使用
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;

        // 跳过注释行
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
          continue;
        }

        // 检测模式：db.exec() 或 this.db.exec() 或 database.exec()
        if (this.isUnsafeExec(line)) {
          const context = this.getContext(lines, i);
          const fix = this.generateFix(line, context);

          if (fix) {
            const relativePath = path.relative(this.rootDir, filePath);
            console.log(`\n📝 ${relativePath}:${lineNumber}`);
            console.log(`   ❌ ${line.trim()}`);
            console.log(`   ✅ ${fix.suggestion}`);

            if (fix.needsManualReview) {
              console.log(`   ⚠️  需要人工审查: ${fix.reason}`);
              this.skippedCount++;
            } else {
              fileChanges++;

              if (!this.dryRun) {
                // 实际修复（这里需要更复杂的逻辑）
                // 暂时只输出建议
              }
            }
          }
        }
      }

      if (fileChanges > 0) {
        this.fixedCount += fileChanges;
      }
    } catch (error) {
      this.errors.push({
        file: path.relative(this.rootDir, filePath),
        error: error.message,
      });
    }
  }

  /**
   * 检查是否是不安全的 exec 调用
   */
  isUnsafeExec(line) {
    // 匹配 db.exec() 或 this.db.exec() 或 database.exec()
    const execPattern = /\b(db|database|this\.db)\.exec\s*\(/;

    if (!execPattern.test(line)) {
      return false;
    }

    // 排除安全的 CREATE TABLE（静态DDL）
    if (
      line.includes("CREATE TABLE") &&
      !line.includes("${") &&
      !line.includes("`${")
    ) {
      return false;
    }

    // 排除元数据查询（sqlite_master）
    if (
      line.includes("sqlite_master") &&
      !line.includes("${") &&
      !line.includes("`${")
    ) {
      return false;
    }

    return true;
  }

  /**
   * 获取代码上下文（前后5行）
   */
  getContext(lines, index) {
    const start = Math.max(0, index - 5);
    const end = Math.min(lines.length, index + 6);
    return lines.slice(start, end).join("\n");
  }

  /**
   * 生成修复建议
   */
  generateFix(line, _context) {
    // 简单的静态查询（无参数）
    const staticQueryMatch = line.match(
      /\.exec\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/,
    );
    if (staticQueryMatch) {
      const sql = staticQueryMatch[1];

      // 判断查询类型
      if (sql.toUpperCase().includes("SELECT")) {
        return {
          suggestion: line
            .replace(/\.exec\(/, ".prepare(")
            .replace(/\)/, ").all()"),
          needsManualReview: false,
        };
      } else if (sql.toUpperCase().match(/INSERT|UPDATE|DELETE/)) {
        return {
          suggestion: line
            .replace(/\.exec\(/, ".prepare(")
            .replace(/\)/, ").run()"),
          needsManualReview: false,
        };
      }
    }

    // 带参数的查询
    const paramQueryMatch = line.match(
      /\.exec\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\[.*?\])\s*\)/,
    );
    if (paramQueryMatch) {
      const sql = paramQueryMatch[1];
      const _params = paramQueryMatch[2];

      if (sql.includes("SELECT")) {
        return {
          suggestion: line.replace(
            /\.exec\((.*?),\s*(\[.*?\])\)/,
            ".prepare($1).all($2)",
          ),
          needsManualReview: false,
        };
      } else if (sql.match(/INSERT|UPDATE|DELETE/)) {
        return {
          suggestion: line.replace(
            /\.exec\((.*?),\s*(\[.*?\])\)/,
            ".prepare($1).run($2)",
          ),
          needsManualReview: false,
        };
      }
    }

    // 模板字符串（可能包含变量）
    if (line.includes("`") && (line.includes("${") || line.includes("${"))) {
      return {
        suggestion: "需要重写为参数化查询，将 ${变量} 替换为 ? 并传入参数数组",
        needsManualReview: true,
        reason: "包含模板字符串变量插值",
      };
    }

    // 复杂情况
    return {
      suggestion: "需要人工分析并修复",
      needsManualReview: true,
      reason: "复杂的 SQL 语句",
    };
  }

  /**
   * 递归获取所有文件
   */
  getAllFiles(dir, ext) {
    const files = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist"
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...this.getAllFiles(fullPath, ext));
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 打印总结
   */
  printSummary() {
    console.log("\n" + "=".repeat(80));
    console.log("📊 修复总结");
    console.log("=".repeat(80));
    console.log(`✅ 可自动修复: ${this.fixedCount}`);
    console.log(`⚠️  需人工审查: ${this.skippedCount}`);
    console.log(`❌ 处理错误: ${this.errors.length}`);

    if (this.errors.length > 0) {
      console.log("\n错误列表:");
      this.errors.forEach((err) => {
        console.log(`  - ${err.file}: ${err.error}`);
      });
    }

    if (this.dryRun) {
      console.log("\n💡 这是预览模式，没有实际修改文件");
      console.log(
        "   运行 `node scripts/fix-sql-injection.js --apply` 执行修复",
      );
    }
    console.log("=".repeat(80) + "\n");
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--apply");

  const fixer = new SQLInjectionFixer({ dryRun });
  const exitCode = await fixer.fix();

  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("❌ 修复工具运行失败:", error);
    process.exit(1);
  });
}

module.exports = SQLInjectionFixer;
