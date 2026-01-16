#!/usr/bin/env node

/**
 * 安全扫描脚本
 * 用于 pre-commit hook 的轻量级安全检查
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SENSITIVE_PATTERNS = [
  // API Keys 和密钥
  /['"]?api[_-]?key['"]?\s*[:=]\s*['"][^'"]{20,}['"]/gi,
  /['"]?secret[_-]?key['"]?\s*[:=]\s*['"][^'"]{20,}['"]/gi,
  /['"]?access[_-]?token['"]?\s*[:=]\s*['"][^'"]{20,}['"]/gi,
  /['"]?private[_-]?key['"]?\s*[:=]\s*['"][^'"]{20,}['"]/gi,

  // AWS 密钥
  /AKIA[0-9A-Z]{16}/g,

  // 数据库连接字符串
  /mysql:\/\/[^:]+:[^@]+@/gi,
  /postgres:\/\/[^:]+:[^@]+@/gi,
  /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/gi,

  // JWT Tokens
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g,

  // 通用密码模式
  /password\s*[:=]\s*['"][^'"]{8,}['"]/gi,
];

const ALLOWED_FILES = [
  ".env.example",
  "security-check.js",
  "test-database.js",
  "test-ukey.js",
  "README.md", // 文档示例
  "README_EN.md", // 文档示例（英文）
  ".chainlesschain/examples/database-bad.js", // 故意包含错误示例
  ".chainlesschain/examples/database-good.js",
  ".chainlesschain/examples/p2p-encryption-bad.js",
  ".chainlesschain/examples/p2p-encryption-good.js",
];

function checkFileForSecrets(filePath) {
  const fileName = path.basename(filePath);

  // 跳过允许的文件
  if (ALLOWED_FILES.includes(fileName)) {
    return [];
  }

  // 跳过二进制文件和特定目录
  if (
    filePath.includes("node_modules/") ||
    filePath.includes("dist/") ||
    filePath.includes("out/") ||
    filePath.includes(".git/") ||
    /\.(jpg|jpeg|png|gif|ico|pdf|zip|gz|tar|exe|dll|so|dylib)$/i.test(filePath)
  ) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const findings = [];

    SENSITIVE_PATTERNS.forEach((pattern, index) => {
      const matches = content.match(pattern);
      if (matches) {
        findings.push({
          file: filePath,
          pattern: index,
          matches: matches.length,
          preview: matches[0].substring(0, 50) + "...",
        });
      }
    });

    return findings;
  } catch (error) {
    // 忽略无法读取的文件
    return [];
  }
}

function getStagedFiles() {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf8",
    });
    return output.trim().split("\n").filter(Boolean);
  } catch (error) {
    console.warn(
      "Warning: Could not get staged files. Skipping security check.",
    );
    return [];
  }
}

function runSecurityCheck(files = null) {
  console.log("🔒 Running security check...\n");

  // 如果提供了文件列表（来自 lint-staged），使用它；否则获取暂存的文件
  const stagedFiles = files || getStagedFiles();

  if (stagedFiles.length === 0) {
    console.log("✅ No files to check.");
    return true;
  }

  let hasIssues = false;
  const allFindings = [];

  stagedFiles.forEach((file) => {
    const findings = checkFileForSecrets(file);
    if (findings.length > 0) {
      allFindings.push(...findings);
      hasIssues = true;
    }
  });

  if (hasIssues) {
    console.error("❌ Security issues found!\n");
    console.error(
      "The following files contain potential secrets or sensitive data:\n",
    );

    allFindings.forEach((finding) => {
      console.error(`  File: ${finding.file}`);
      console.error(`  Pattern: ${finding.pattern}`);
      console.error(`  Preview: ${finding.preview}\n`);
    });

    console.error("\n⚠️  Please remove sensitive data before committing.");
    console.error(
      "If this is a false positive, add the file to ALLOWED_FILES in scripts/security-check.js\n",
    );

    return false;
  }

  console.log("✅ No security issues found.");
  return true;
}

// Run the security check
// 如果提供了命令行参数，使用它们；否则获取暂存的文件
const filesFromArgs = process.argv.slice(2);
const success = runSecurityCheck(
  filesFromArgs.length > 0 ? filesFromArgs : null,
);
process.exit(success ? 0 : 1);
