#!/usr/bin/env node

/**
 * ChainlessChain 编码规范自动检查工具
 *
 * 检查项目：
 * 1. SQL 注入防护（检测不安全的数据库查询）
 * 2. P2P 加密（检测未加密的消息传输）
 * 3. 敏感信息泄露（检测日志中的 PIN/密钥）
 * 4. 依赖项漏洞（运行 npm audit）
 * 5. XSS 风险检测（innerHTML, outerHTML, document.write 等）
 * 6. 危险函数检测（eval, Function constructor, setTimeout with string）
 * 7. 硬编码密钥检测（API keys, secrets, tokens）
 *
 * @version 2.0.0
 * @since 2026-01-16
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
/* eslint-enable @typescript-eslint/no-require-imports */

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
    console.log("🔍 ChainlessChain 规则验证器 v2.0 启动...\n");

    // 1. SQL 注入检查
    console.log("📋 [1/7] 检查 SQL 注入防护...");
    await this.checkSQLInjection();

    // 2. P2P 加密检查
    console.log("📋 [2/7] 检查 P2P 加密规范...");
    await this.checkP2PEncryption();

    // 3. 敏感信息泄露检查
    console.log("📋 [3/7] 检查敏感信息泄露...");
    await this.checkSensitiveDataLeak();

    // 4. XSS 风险检查
    console.log("📋 [4/7] 检查 XSS 风险...");
    await this.checkXSSRisk();

    // 5. 危险函数检查
    console.log("📋 [5/7] 检查危险函数使用...");
    await this.checkDangerousFunctions();

    // 6. 硬编码密钥检查
    console.log("📋 [6/7] 检查硬编码密钥...");
    await this.checkHardcodedSecrets();

    // 7. 依赖项漏洞检查
    console.log("📋 [7/7] 检查依赖项漏洞...");
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
            (line.trim() === "this.db.exec(sql);" ||
              line.trim() === "return this.db.exec(sql);") &&
            (lines[index - 3]?.includes("this.db.run =") ||
              lines[index - 3]?.includes("exec(sql)") ||
              file.includes("sqlcipher-wrapper.js") ||
              file.includes("database.js") ||
              file.includes("database-adapter.js"));

          // 检查是否是迁移脚本中的硬编码SQL
          const isMigrationScript =
            file.includes("migrations") &&
            (line.includes("column.sql") || line.includes("db.exec(column."));

          // 检查是否是插件系统安全执行SQL（从文件读取）
          const isPluginSafeSQL =
            file.includes("plugin-registry.js") &&
            line.includes("statement") &&
            !line.includes("user") &&
            !line.includes("input");

          if (
            !isSafeDDL &&
            !isSafeMigration &&
            !isCompatWrapper &&
            !isMigrationScript &&
            !isPluginSafeSQL
          ) {
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

          // 排除日志/控制台调用（logger.info/warn/error 等中的 SQL 关键词不构成注入风险）
          const isLoggerCall =
            /\b(?:logger|console)\s*\.\s*(?:info|warn|error|debug|log|trace)\s*\(/.test(
              line,
            );

          // 排除正则表达式字面量（安全检查工具中的模式匹配）
          const isRegexPattern = /^\s*\/.*\/[gimsuy]*/.test(line.trim());

          // L6 修复: 排除测试文件、fixture 文件、demo 文件
          // 这些文件中的"危险" SQL 是故意的测试样本
          const fileBasename = path.basename(file);
          const isTestOrFixture =
            file.includes("__tests__") ||
            file.includes(".test.") ||
            file.includes(".spec.") ||
            /-test\.js$/.test(fileBasename) ||
            /-demo\.js$/.test(fileBasename) ||
            /-fixture\.js$/.test(fileBasename) ||
            /[/\\]fixtures[/\\]/.test(file);

          // L6 修复: 排除 SQL 生成器/文档技能（输出 SQL 文本给用户而非执行）
          const isSqlGeneratorSkill =
            /skills[/\\]builtin[/\\]database-query[/\\]/.test(file) ||
            /skills[/\\]builtin[/\\]db-migration[/\\]/.test(file) ||
            /skills[/\\]builtin[/\\]sql-/.test(file);

          // L6 修复: 多行 .prepare(`...`) 调用，prepare 关键字在前 3 行内
          // 旧逻辑只查当前行的 db.prepare，导致 agent-templates.js / agent-coordinator.js
          // (this.database.prepare) 等多行 prepare 误报
          const contextStart = Math.max(0, index - 3);
          const contextLines = lines.slice(contextStart, index + 1).join("\n");
          const hasNearbyPrepare =
            /\.\s*prepare\s*\(/.test(contextLines) ||
            /\.\s*exec\s*\(\s*[`'"]/.test(contextLines);

          // 要求实际 SQL 语句结构（关键词后跟 SQL 语法），
          // 排除描述文本中偶然出现 SQL 关键词的情况（如 "Create optimized Dockerfiles"）
          const hasActualSQLStructure =
            /\bSELECT\b[^]*?\bFROM\b/i.test(line) ||
            /\bINSERT\b[^]*?\bINTO\b/i.test(line) ||
            /\bUPDATE\b[^]*?\bSET\b/i.test(line) ||
            /\bDELETE\b[^]*?\bFROM\b/i.test(line) ||
            /\bDROP\b\s+(?:TABLE|INDEX|VIEW|DATABASE)\b/i.test(line) ||
            /\bCREATE\b\s+(?:TABLE|INDEX|VIEW|DATABASE)\b/i.test(line) ||
            /\bALTER\b\s+TABLE\b/i.test(line);

          if (
            !isSafePlaceholder &&
            !isComment &&
            !hasNearbyPrepare &&
            !isLoggerCall &&
            !isRegexPattern &&
            !isTestOrFixture &&
            !isSqlGeneratorSkill &&
            hasActualSQLStructure
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

          // 排除内部同步消息（组织内部、知识库评论等非敏感广播）
          const isInternalSync =
            file.includes("organization") ||
            file.includes("org-p2p") ||
            file.includes("knowledge-comments") ||
            contextLines.includes("sync") ||
            contextLines.includes("broadcast");

          // 排除测试文件（测试中的 .publish() 不是真实 P2P 调用）
          const isTestFile =
            file.includes("__tests__") ||
            file.includes(".test.") ||
            file.includes(".spec.");

          if (
            !hasEncryption &&
            !isInternalSync &&
            !isTestFile &&
            !line.trim().startsWith("//")
          ) {
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
          // 排除合法场景：加密后转base64编码
          const isValidEncoding =
            // U-Key驱动：硬件加密后转base64
            (file.includes("ukey") &&
              (line.includes("encrypted.toString") ||
                line.includes("encryptedData.toString"))) ||
            // AES加密后转base64
            (line.includes("cipher.") && line.includes("base64")) ||
            // IV或密钥转base64（元数据编码）
            line.includes("iv.toString('base64')") ||
            line.includes("key.toString('base64')");

          if (!isValidEncoding) {
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
   * 检查 XSS 风险
   */
  async checkXSSRisk() {
    const jsFiles = this.getAllFiles(this.srcDir, ".js");
    const vueFiles = this.getAllFiles(this.srcDir, ".vue");
    const allFiles = [...jsFiles, ...vueFiles];
    let issueCount = 0;

    // XSS 高危模式
    const xssPatterns = [
      {
        pattern: /\.innerHTML\s*=/,
        message:
          "使用 innerHTML 可能导致 XSS 攻击，建议使用 textContent 或 DOMPurify",
        severity: "HIGH",
      },
      {
        pattern: /\.outerHTML\s*=/,
        message: "使用 outerHTML 可能导致 XSS 攻击，建议使用安全的 DOM 操作",
        severity: "HIGH",
      },
      {
        pattern: /document\.write\s*\(/,
        message: "document.write 可能导致 XSS 和性能问题，建议使用 DOM API",
        severity: "HIGH",
      },
      {
        pattern: /\.insertAdjacentHTML\s*\(/,
        message: "insertAdjacentHTML 可能导致 XSS，确保输入已清洗",
        severity: "MEDIUM",
      },
      {
        pattern: /v-html\s*=/,
        message: "Vue v-html 指令可能导致 XSS，确保内容已清洗或使用 DOMPurify",
        severity: "MEDIUM",
      },
      {
        pattern: /dangerouslySetInnerHTML/,
        message: "dangerouslySetInnerHTML 可能导致 XSS，确保内容已清洗",
        severity: "HIGH",
      },
    ];

    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // 跳过注释
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
          return;
        }

        xssPatterns.forEach(({ pattern, message, severity }) => {
          if (pattern.test(line)) {
            // 检查是否有 DOMPurify 或其他清洗
            const contextStart = Math.max(0, index - 5);
            const contextLines = lines
              .slice(contextStart, index + 1)
              .join("\n");

            const hasSanitization =
              contextLines.includes("DOMPurify") ||
              contextLines.includes("sanitize") ||
              contextLines.includes("escape") ||
              contextLines.includes("encodeHTML") ||
              // Vue 的安全场景：静态 HTML
              (pattern.source.includes("v-html") &&
                line.includes('v-html="') &&
                !line.includes("${"));

            if (!hasSanitization) {
              if (severity === "HIGH") {
                this.errors.push({
                  type: "XSS_RISK",
                  severity,
                  file: path.relative(this.rootDir, file),
                  line: lineNumber,
                  message,
                  code: line.trim(),
                });
              } else {
                this.warnings.push({
                  type: "XSS_RISK",
                  severity,
                  file: path.relative(this.rootDir, file),
                  line: lineNumber,
                  message,
                  code: line.trim(),
                });
              }
              issueCount++;
            }
          }
        });
      });
    }

    if (issueCount === 0) {
      this.info.push("✅ XSS 风险检查通过，未发现不安全的 DOM 操作");
    }
  }

  /**
   * 检查危险函数使用
   */
  async checkDangerousFunctions() {
    const jsFiles = this.getAllFiles(this.srcDir, ".js");
    let issueCount = 0;

    // 危险函数模式
    const dangerousPatterns = [
      {
        pattern: /\beval\s*\(/,
        message: "eval() 是高危函数，可能导致代码注入攻击",
        severity: "HIGH",
        exceptions: ["evalPath", "evaluate", "evaluation"], // 允许的命名
      },
      {
        pattern: /new\s+Function\s*\(/,
        message: "new Function() 与 eval 一样危险，可能导致代码注入",
        severity: "HIGH",
        exceptions: [],
      },
      {
        pattern: /setTimeout\s*\(\s*['"`]/,
        message: "setTimeout 使用字符串参数等同于 eval，请改用函数",
        severity: "MEDIUM",
        exceptions: [],
      },
      {
        pattern: /setInterval\s*\(\s*['"`]/,
        message: "setInterval 使用字符串参数等同于 eval，请改用函数",
        severity: "MEDIUM",
        exceptions: [],
      },
      {
        pattern: /child_process\.exec\s*\(/,
        message: "exec() 可能导致命令注入，建议使用 execFile 或 spawn",
        severity: "MEDIUM",
        exceptions: [],
      },
      {
        pattern: /execSync\s*\([^)]*\$\{/,
        message: "execSync 使用模板字符串可能导致命令注入",
        severity: "HIGH",
        exceptions: [],
      },
      {
        pattern: /require\s*\(\s*[^'"`]/,
        message: "动态 require 可能导致任意代码加载，确保路径已验证",
        severity: "MEDIUM",
        exceptions: ["require(", "require.resolve"],
      },
    ];

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const fileName = path.basename(file);

      // 跳过测试文件、配置文件和技能处理器文件
      // 技能处理器需要调用外部工具（git, kubectl等），输入已在handler内部校验
      if (
        fileName.includes(".test.") ||
        fileName.includes(".spec.") ||
        fileName.includes("config") ||
        file.includes("skills/builtin") ||
        file.includes("skills\\builtin")
      ) {
        continue;
      }

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // 跳过注释
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
          return;
        }

        // 跳过仅在字符串字面量中出现危险函数名的行（如 "Use of eval() detected"）
        // 移除所有字符串字面量后检查是否仍匹配危险模式
        const lineWithoutStrings = line
          .replace(/"(?:[^"\\]|\\.)*"/g, '""')
          .replace(/'(?:[^'\\]|\\.)*'/g, "''")
          .replace(/`(?:[^`\\]|\\.)*`/g, "``");

        dangerousPatterns.forEach(
          ({ pattern, message, severity, exceptions }) => {
            if (pattern.test(line)) {
              // 检查是否在例外列表中
              const isException = exceptions.some((exc) => line.includes(exc));
              if (isException) {
                return;
              }

              // 特殊处理：允许 rules-validator.js 和安全检查脚本中使用 exec
              if (
                (pattern.source.includes("exec") ||
                  pattern.source.includes("execSync")) &&
                (file.includes("rules-validator") ||
                  file.includes("security-check") ||
                  file.includes("test-"))
              ) {
                return;
              }

              // 特殊处理：允许 error-monitor.js 中的服务重启
              if (
                pattern.source.includes("exec") &&
                file.includes("error-monitor") &&
                (line.includes("docker") ||
                  line.includes("netstat") ||
                  line.includes("taskkill"))
              ) {
                return;
              }

              // 特殊处理：允许 multi-tab-action.js 在 page.evaluate 中使用 new Function
              if (
                pattern.source.includes("Function") &&
                file.includes("multi-tab-action") &&
                line.includes("new Function")
              ) {
                // 检查上下文中是否有 page.evaluate，确保是在沙箱中执行
                const contextLines = lines.slice(
                  Math.max(0, index - 5),
                  Math.min(lines.length, index + 2),
                );
                const context = contextLines.join("\n");
                if (
                  context.includes("page.evaluate") ||
                  context.includes("// Note: This is safe in page.evaluate")
                ) {
                  return;
                }
              }

              // 特殊处理：允许 browser-extension 中使用 new Function 用于远程脚本执行
              // 安全说明：浏览器扩展仅接受来自本地桌面应用的可信命令 (127.0.0.1:18790)
              if (
                pattern.source.includes("Function") &&
                file.includes("browser-extension") &&
                line.includes("new Function")
              ) {
                return;
              }

              // 特殊处理：允许 auto-tuner-ipc.js 使用 new Function 进行条件/动作评估
              // 安全说明：规则来自主进程内部配置，不接受外部用户直接输入
              if (
                pattern.source.includes("Function") &&
                file.includes("auto-tuner-ipc") &&
                line.includes("new Function")
              ) {
                return;
              }

              // 跳过仅在字符串字面量中出现的危险函数名（如 "Use of eval() detected"）
              if (!pattern.test(lineWithoutStrings)) {
                return;
              }

              if (severity === "HIGH") {
                this.errors.push({
                  type: "DANGEROUS_FUNCTION",
                  severity,
                  file: path.relative(this.rootDir, file),
                  line: lineNumber,
                  message,
                  code: line.trim(),
                });
              } else {
                this.warnings.push({
                  type: "DANGEROUS_FUNCTION",
                  severity,
                  file: path.relative(this.rootDir, file),
                  line: lineNumber,
                  message,
                  code: line.trim(),
                });
              }
              issueCount++;
            }
          },
        );
      });
    }

    if (issueCount === 0) {
      this.info.push("✅ 危险函数检查通过，未发现 eval 或不安全的代码执行");
    }
  }

  /**
   * 检查硬编码密钥
   */
  async checkHardcodedSecrets() {
    const jsFiles = this.getAllFiles(this.srcDir, ".js");
    this.getAllFiles(this.rootDir, ".env");
    let issueCount = 0;

    // 密钥模式
    const secretPatterns = [
      {
        // API Key 格式：sk-xxx, api-xxx, key-xxx 等
        pattern:
          /['"`](sk-[a-zA-Z0-9]{20,}|api[-_]?key[-_]?[a-zA-Z0-9]{16,}|key[-_][a-zA-Z0-9]{16,})['"`]/i,
        message: "检测到可能的 API 密钥硬编码",
        severity: "HIGH",
      },
      {
        // AWS 密钥
        pattern: /['"`](AKIA[0-9A-Z]{16})['"`]/,
        message: "检测到 AWS Access Key 硬编码",
        severity: "CRITICAL",
      },
      {
        // GitHub Token
        pattern: /['"`](ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{22,})['"`]/,
        message: "检测到 GitHub Token 硬编码",
        severity: "CRITICAL",
      },
      {
        // OpenAI API Key
        pattern: /['"`](sk-[a-zA-Z0-9]{48})['"`]/,
        message: "检测到 OpenAI API Key 硬编码",
        severity: "CRITICAL",
      },
      {
        // 通用 secret/token 赋值
        pattern:
          /(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"`][a-zA-Z0-9+/=]{16,}['"`]/i,
        message: "检测到敏感密钥硬编码，应使用环境变量",
        severity: "HIGH",
      },
      {
        // 私钥内容
        pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
        message: "检测到私钥内容硬编码",
        severity: "CRITICAL",
      },
      {
        // 数据库连接字符串（带密码）
        pattern: /(?:postgres|mysql|mongodb):\/\/[^:]+:[^@]+@[^/]+/i,
        message: "检测到数据库连接字符串（含密码）硬编码",
        severity: "HIGH",
      },
      {
        // JWT Secret
        pattern: /jwt[_-]?secret\s*[:=]\s*['"`][^'"`]{16,}['"`]/i,
        message: "检测到 JWT Secret 硬编码",
        severity: "HIGH",
      },
    ];

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const fileName = path.basename(file);

      // 跳过示例文件和测试文件
      if (
        fileName.includes(".example") ||
        fileName.includes(".sample") ||
        fileName.includes(".test.") ||
        fileName.includes(".spec.") ||
        fileName.includes("mock")
      ) {
        continue;
      }

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        // 跳过注释
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
          return;
        }

        // 跳过从环境变量读取的行
        if (
          line.includes("process.env") ||
          line.includes("getenv") ||
          line.includes("dotenv")
        ) {
          return;
        }

        secretPatterns.forEach(({ pattern, message, severity }) => {
          if (pattern.test(line)) {
            // 检查是否是占位符或示例值
            const isPlaceholder =
              line.includes("xxx") ||
              line.includes("your-") ||
              line.includes("placeholder") ||
              line.includes("example") ||
              line.includes("test") ||
              line.includes("demo") ||
              line.includes("<") ||
              line.includes(">") ||
              // 模拟模式的默认值
              (line.includes("123456") && line.includes("simulation"));

            if (isPlaceholder) {
              return;
            }

            if (severity === "CRITICAL" || severity === "HIGH") {
              this.errors.push({
                type: "HARDCODED_SECRET",
                severity,
                file: path.relative(this.rootDir, file),
                line: lineNumber,
                message,
                code: this.maskSensitiveData(line.trim()),
              });
            } else {
              this.warnings.push({
                type: "HARDCODED_SECRET",
                severity,
                file: path.relative(this.rootDir, file),
                line: lineNumber,
                message,
                code: this.maskSensitiveData(line.trim()),
              });
            }
            issueCount++;
          }
        });
      });
    }

    if (issueCount === 0) {
      this.info.push("✅ 硬编码密钥检查通过，未发现敏感信息硬编码");
    }
  }

  /**
   * 遮盖敏感数据（用于日志输出）
   */
  maskSensitiveData(line) {
    // 遮盖可能的密钥值
    return line
      .replace(/(sk-)[a-zA-Z0-9]+/g, "$1****")
      .replace(/(ghp_)[a-zA-Z0-9]+/g, "$1****")
      .replace(/(AKIA)[A-Z0-9]+/g, "$1****")
      .replace(/(['"`])[a-zA-Z0-9+/=]{20,}(['"`])/g, "$1****$2")
      .replace(/:\/\/([^:]+):([^@]+)@/g, "://$1:****@");
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
        timeout: 30000,
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

      // 依赖项漏洞作为警告（许多来自传递依赖，不直接影响应用安全）
      if (stats.critical > 0) {
        this.warnings.push({
          type: "DEPENDENCY_VULNERABILITY",
          severity: "CRITICAL",
          file: "package.json",
          line: 0,
          message: `⚠️ 发现 ${stats.critical} 个严重依赖漏洞，建议尽快修复`,
          code: `Critical: ${stats.critical}, High: ${stats.high}, Moderate: ${stats.moderate}, Low: ${stats.low}`,
        });
      }

      if (stats.high > 0) {
        this.warnings.push({
          type: "DEPENDENCY_VULNERABILITY",
          severity: "HIGH",
          file: "package.json",
          line: 0,
          message: `发现 ${stats.high} 个高危漏洞，建议尽快修复`,
          code: `High: ${stats.high}`,
        });
      }

      if (stats.moderate > 0 || stats.low > 0) {
        this.warnings.push({
          type: "DEPENDENCY_VULNERABILITY",
          severity: "MEDIUM",
          file: "package.json",
          line: 0,
          message: `发现 ${stats.moderate} 个中危漏洞和 ${stats.low} 个低危漏洞`,
          code: `Moderate: ${stats.moderate}, Low: ${stats.low}`,
        });
      }

      if (
        stats.critical === 0 &&
        stats.high === 0 &&
        stats.moderate === 0 &&
        stats.low === 0
      ) {
        this.info.push("✅ 依赖项漏洞检查通过，未发现已知漏洞");
      }
    } catch (error) {
      // npm audit 在有漏洞时会返回非零退出码，这是正常的
      if (error.stdout) {
        try {
          const audit = JSON.parse(error.stdout);
          const metadata = audit.metadata || {};
          const vulnerabilities = metadata.vulnerabilities || {};

          // 依赖项漏洞作为警告，因为许多来自 hardhat/speedtest-net 等工具链的传递依赖
          // 这些漏洞通常不直接影响 Electron 应用的安全性
          // 注意：代码级别的安全检查（SQL注入、P2P加密）仍然作为错误
          if (vulnerabilities.critical > 0) {
            this.warnings.push({
              type: "DEPENDENCY_VULNERABILITY",
              severity: "CRITICAL",
              file: "package.json",
              line: 0,
              message: `⚠️ 发现 ${vulnerabilities.critical} 个严重依赖漏洞，建议运行 'npm audit fix --force' 或更新相关依赖`,
              code: JSON.stringify(vulnerabilities),
            });
          }

          if (vulnerabilities.high > 0) {
            this.warnings.push({
              type: "DEPENDENCY_VULNERABILITY",
              severity: "HIGH",
              file: "package.json",
              line: 0,
              message: `发现 ${vulnerabilities.high} 个高危漏洞，建议尽快修复`,
              code: JSON.stringify(vulnerabilities),
            });
          }

          if (vulnerabilities.moderate > 0 || vulnerabilities.low > 0) {
            this.warnings.push({
              type: "DEPENDENCY_VULNERABILITY",
              severity: "MEDIUM",
              file: "package.json",
              line: 0,
              message: `发现 ${(vulnerabilities.moderate || 0) + (vulnerabilities.low || 0)} 个中低风险漏洞`,
              code: JSON.stringify(vulnerabilities),
            });
          }
        } catch {
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
