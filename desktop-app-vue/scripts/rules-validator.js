#!/usr/bin/env node

/**
 * ChainlessChain 编码规范自动检查工具
 *
 * 检查项目：
 * 1. SQL 注入防护（检测不安全的数据库查询）
 * 2. P2P 加密（检测未加密的消息传输）
 * 3. 敏感信息泄露（检测日志中的 PIN/密钥）
 * 4. 依赖项漏洞（运行 npm audit）
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

class RulesValidator {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.join(__dirname, "..");
    this.srcDir = path.join(this.rootDir, "src");
    this.errors = [];
    this.warnings = [];
    this.info = [];
  }

  /**
   * 运行所有检查
   */
  async validate() {
    console.log("🔍 ChainlessChain 规则验证器启动...\n");

    // 1. SQL 注入检查
    console.log("📋 [1/4] 检查 SQL 注入防护...");
    await this.checkSQLInjection();

    // 2. P2P 加密检查
    console.log("📋 [2/4] 检查 P2P 加密规范...");
    await this.checkP2PEncryption();

    // 3. 敏感信息泄露检查
    console.log("📋 [3/4] 检查敏感信息泄露...");
    await this.checkSensitiveDataLeak();

    // 4. 依赖项漏洞检查
    console.log("📋 [4/4] 检查依赖项漏洞...");
    await this.checkDependencyVulnerabilities();

    // 输出报告
    this.printReport();

    // 返回退出码
    return this.errors.length > 0 ? 1 : 0;
  }

  /**
   * 检查 SQL 注入防护
   */
  async checkSQLInjection() {
    const jsFiles = this.getAllFiles(this.srcDir, ".js");
    let issueCount = 0;

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // 检查 db.exec() 使用（高危）
        if (line.includes("db.exec(") || line.includes("database.exec(")) {
          // 排除注释行
          if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
            return;
          }

          // 检查当前行和接下来的3行是否包含DDL语句
          const contextLines = lines.slice(
            index,
            Math.min(index + 4, lines.length),
          );
          const context = contextLines.join(" ").toUpperCase();

          const isSafeDDL =
            (context.includes("CREATE TABLE") ||
              context.includes("CREATE INDEX") ||
              context.includes("DROP TABLE") ||
              context.includes("DROP INDEX") ||
              context.includes("ALTER TABLE")) &&
            !line.includes("${"); // 且不包含变量插值

          // 检查是否是安全的迁移SQL（从文件读取）
          const isSafeMigration =
            (line.includes("migrationSQL") ||
              line.includes("Migration") ||
              line.includes("dataInitSQL") ||
              line.includes("cleanedSQL")) &&
            !line.includes("${"); // 且不包含变量插值

          // 检查是否是兼容性包装器（将exec转换为prepare的辅助函数）
          const isCompatWrapper =
            line.trim() === "this.db.exec(sql);" &&
            lines[index - 3]?.includes("this.db.run =");

          if (!isSafeDDL && !isSafeMigration && !isCompatWrapper) {
            this.errors.push({
              type: "SQL_INJECTION",
              severity: "HIGH",
              file: path.relative(this.rootDir, file),
              line: lineNumber,
              message:
                "使用 db.exec() 可能导致 SQL 注入，请改用 db.prepare() 参数化查询",
              code: line.trim(),
            });
            issueCount++;
          }
        }

        // 检查字符串拼接 SQL（中危）
        const sqlKeywords = [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "DROP",
          "CREATE",
        ];
        const hasSQLKeyword = sqlKeywords.some((kw) =>
          line.toUpperCase().includes(kw),
        );
        const hasTemplateLiteral = line.includes("`") && line.includes("${");
        const hasStringConcat =
          line.includes("'") && (line.includes("+") || line.includes("${"));

        if (hasSQLKeyword && (hasTemplateLiteral || hasStringConcat)) {
          // 排除安全的占位符拼接（如 placeholders = ids.map(() => '?').join(',')）
          const isSafePlaceholder =
            line.includes("'?'") || line.includes('"?"');
          const isComment =
            line.trim().startsWith("//") || line.trim().startsWith("*");

          if (
            !isSafePlaceholder &&
            !isComment &&
            !line.includes("db.prepare")
          ) {
            this.warnings.push({
              type: "SQL_INJECTION",
              severity: "MEDIUM",
              file: path.relative(this.rootDir, file),
              line: lineNumber,
              message: "检测到 SQL 语句使用字符串拼接，可能存在注入风险",
              code: line.trim(),
            });
            issueCount++;
          }
        }
      });
    }

    if (issueCount === 0) {
      this.info.push("✅ SQL 注入检查通过，未发现不安全的数据库查询");
    }
  }

  /**
   * 检查 P2P 加密规范
   */
  async checkP2PEncryption() {
    const jsFiles = this.getAllFiles(this.srcDir, ".js");
    let issueCount = 0;

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // 检查 p2pNode.pubsub.publish() 使用
        if (line.includes(".pubsub.publish(") || line.includes(".publish(")) {
          // 向前查找最近的 10 行，检查是否有加密操作
          const contextStart = Math.max(0, index - 10);
          const contextLines = lines.slice(contextStart, index + 1).join("\n");

          const hasEncryption =
            contextLines.includes("encrypt(") ||
            contextLines.includes("signal") ||
            contextLines.includes("cipher") ||
            contextLines.includes("Session") ||
            line.includes("encrypted") ||
            line.includes("ciphertext");

          if (!hasEncryption && !line.trim().startsWith("//")) {
            this.errors.push({
              type: "P2P_ENCRYPTION",
              severity: "HIGH",
              file: path.relative(this.rootDir, file),
              line: lineNumber,
              message:
                "P2P 消息发布前未检测到加密操作，必须使用 Signal Protocol 加密",
              code: line.trim(),
            });
            issueCount++;
          }
        }

        // 检查弱加密使用（Base64 编码被误用为加密）
        if (
          (line.includes("toString('base64')") || line.includes(".btoa(")) &&
          (line.includes("encrypt") ||
            line.includes("secure") ||
            line.includes("protect"))
        ) {
          this.errors.push({
            type: "WEAK_ENCRYPTION",
            severity: "HIGH",
            file: path.relative(this.rootDir, file),
            line: lineNumber,
            message:
              "Base64 是编码而非加密，请使用 Signal Protocol 或 node-forge",
            code: line.trim(),
          });
          issueCount++;
        }
      });
    }

    if (issueCount === 0) {
      this.info.push("✅ P2P 加密检查通过，未发现不安全的消息传输");
    }
  }

  /**
   * 检查敏感信息泄露
   */
  async checkSensitiveDataLeak() {
    const jsFiles = this.getAllFiles(this.srcDir, ".js");
    let issueCount = 0;

    const sensitivePatterns = [
      {
        pattern: /console\.(log|info|debug|warn)\([^)]*\b(pin|PIN)\b/i,
        message: "PIN 码不应记录到日志",
      },
      {
        pattern:
          /console\.(log|info|debug|warn)\([^)]*\b(password|pwd|passwd)\b/i,
        message: "密码不应记录到日志",
      },
      {
        pattern:
          /console\.(log|info|debug|warn)\([^)]*\b(key|secret|token)\b.*[:=]/i,
        message: "密钥/令牌不应记录到日志",
      },
      {
        pattern: /const\s+(pin|PIN)\s*=\s*['"`]\d+['"`]/,
        message: "PIN 码不应硬编码（除非在模拟模式配置中）",
      },
      {
        pattern: /pragma.*key.*=.*['"`][^'"`]+['"`]/,
        message: "数据库加密密钥不应硬编码",
      },
    ];

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const fileName = path.basename(file);

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // 跳过注释行
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
          return;
        }

        sensitivePatterns.forEach(({ pattern, message }) => {
          if (pattern.test(line)) {
            // 允许在模拟模式配置文件中使用默认 PIN
            const isSimulationConfig =
              fileName.includes("simulation") || fileName.includes("mock");
            const isDefaultPIN =
              line.includes("123456") && line.includes("simulation");

            if (isSimulationConfig && isDefaultPIN) {
              return; // 允许
            }

            this.warnings.push({
              type: "SENSITIVE_DATA_LEAK",
              severity: "MEDIUM",
              file: path.relative(this.rootDir, file),
              line: lineNumber,
              message,
              code: line.trim(),
            });
            issueCount++;
          }
        });
      });
    }

    if (issueCount === 0) {
      this.info.push("✅ 敏感信息泄露检查通过，未发现可疑日志或硬编码");
    }
  }

  /**
   * 检查依赖项漏洞
   */
  async checkDependencyVulnerabilities() {
    try {
      // 运行 npm audit（JSON 格式）
      const auditResult = execSync("npm audit --json", {
        cwd: this.rootDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const audit = JSON.parse(auditResult);
      const vulnerabilities = audit.vulnerabilities || {};

      // 统计漏洞等级
      const stats = {
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
      };

      Object.values(vulnerabilities).forEach((vuln) => {
        const severity = vuln.severity;
        if (stats[severity] !== undefined) {
          stats[severity]++;
        }
      });

      // 报告高危和严重漏洞
      if (stats.critical > 0 || stats.high > 0) {
        this.errors.push({
          type: "DEPENDENCY_VULNERABILITY",
          severity: "HIGH",
          file: "package.json",
          line: 0,
          message: `发现 ${stats.critical} 个严重漏洞和 ${stats.high} 个高危漏洞，请运行 'npm audit fix'`,
          code: `Critical: ${stats.critical}, High: ${stats.high}, Moderate: ${stats.moderate}, Low: ${stats.low}`,
        });
      } else if (stats.moderate > 0 || stats.low > 0) {
        this.warnings.push({
          type: "DEPENDENCY_VULNERABILITY",
          severity: "LOW",
          file: "package.json",
          line: 0,
          message: `发现 ${stats.moderate} 个中危漏洞和 ${stats.low} 个低危漏洞`,
          code: `Moderate: ${stats.moderate}, Low: ${stats.low}`,
        });
      } else {
        this.info.push("✅ 依赖项漏洞检查通过，未发现已知漏洞");
      }
    } catch (error) {
      // npm audit 在有漏洞时会返回非零退出码，这是正常的
      if (error.stdout) {
        try {
          const audit = JSON.parse(error.stdout);
          const metadata = audit.metadata || {};
          const vulnerabilities = metadata.vulnerabilities || {};

          const total =
            vulnerabilities.critical +
            vulnerabilities.high +
            vulnerabilities.moderate +
            vulnerabilities.low;

          if (total > 0) {
            this.warnings.push({
              type: "DEPENDENCY_VULNERABILITY",
              severity: "MEDIUM",
              file: "package.json",
              line: 0,
              message: `发现 ${total} 个依赖项漏洞`,
              code: JSON.stringify(vulnerabilities),
            });
          }
        } catch (parseError) {
          this.warnings.push({
            type: "DEPENDENCY_VULNERABILITY",
            severity: "LOW",
            file: "package.json",
            line: 0,
            message: "无法解析 npm audit 结果，请手动运行 npm audit 检查",
            code: "",
          });
        }
      }
    }
  }

  /**
   * 递归获取所有指定扩展名的文件
   */
  getAllFiles(dir, ext) {
    const files = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // 跳过 node_modules 和 .git
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "out"
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
   * 打印检查报告
   */
  printReport() {
    console.log("\n" + "=".repeat(80));
    console.log("📊 ChainlessChain 规则验证报告");
    console.log("=".repeat(80) + "\n");

    // 打印错误
    if (this.errors.length > 0) {
      console.log(`❌ 发现 ${this.errors.length} 个错误（必须修复）:\n`);
      this.errors.forEach((error, index) => {
        console.log(`[${index + 1}] ${error.severity} - ${error.type}`);
        console.log(`    文件: ${error.file}:${error.line}`);
        console.log(`    问题: ${error.message}`);
        console.log(`    代码: ${error.code}`);
        console.log("");
      });
    }

    // 打印警告
    if (this.warnings.length > 0) {
      console.log(`⚠️  发现 ${this.warnings.length} 个警告（建议修复）:\n`);
      this.warnings.forEach((warning, index) => {
        console.log(`[${index + 1}] ${warning.severity} - ${warning.type}`);
        console.log(`    文件: ${warning.file}:${warning.line}`);
        console.log(`    问题: ${warning.message}`);
        console.log(`    代码: ${warning.code}`);
        console.log("");
      });
    }

    // 打印信息
    if (this.info.length > 0) {
      console.log("ℹ️  检查通过项:\n");
      this.info.forEach((msg) => {
        console.log(`    ${msg}`);
      });
      console.log("");
    }

    // 总结
    console.log("=".repeat(80));
    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log("✅ 所有检查通过！代码符合 ChainlessChain 编码规范");
    } else {
      console.log(
        `⚠️  发现 ${this.errors.length} 个错误和 ${this.warnings.length} 个警告`,
      );
      if (this.errors.length > 0) {
        console.log("❌ 检查失败：请修复所有错误后重新提交");
      }
    }
    console.log("=".repeat(80) + "\n");
  }
}

// 主函数
async function main() {
  const validator = new RulesValidator();
  const exitCode = await validator.validate();
  process.exit(exitCode);
}

// 如果直接运行（非 require）
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ 验证器运行失败:", error);
    process.exit(1);
  });
}

module.exports = RulesValidator;
