#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

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
  "BLOCKCHAIN.md", // 区块链文档（包含示例密码）
  ".chainlesschain/examples/database-bad.js", // 故意包含错误示例
  ".chainlesschain/examples/database-good.js",
  ".chainlesschain/examples/p2p-encryption-bad.js",
  ".chainlesschain/examples/p2p-encryption-good.js",
  // Packaging 文档（包含示例密码）
  "CODE_SIGNING_GUIDE.md",
  "DOCKER_PACKAGING_GUIDE.md",
  "DOCKER_OFFLINE_PACKAGING.md",
  "ADVANCED_FEATURES_GUIDE.md",
  "QUICK_START_OFFLINE.md",
  "RELEASE_GUIDE.md",
  "docker-compose.production.yml",
  // Android 文档（包含示例密码和密钥）
  "ANDROID_SIGNING_SETUP.md",
  "GOOGLE_PLAY_SETUP.md",
  "RELEASE_TESTING_GUIDE.md",
  "ANDROID_CI_CD_GUIDE.md",
  "APP_ICON_GUIDE.md",
  "KEYSTORE_GENERATED.md",
  "generate_keystore.bat",
  "generate_keystore.sh",
  "generate_test_keystore.bat",
  // iOS 文档（包含BIP39测试向量和示例密钥）
  "WALLETCORE_INTEGRATION.md",
  "TESTING_GUIDE.md",
  "BLOCKCHAIN_IMPLEMENTATION_PLAN.md",
  "PHASE_1.3_ADVANCED_WALLET_COMPLETION.md",
  // docs-site 文档（包含示例代码）
  "computer-use.md",
  "ai-models.md",
  "did-v2.md",
  // 设计文档（包含日志脱敏示例代码）
  "07_性能优化系统.md",
  // 核心包测试文件（包含测试用假密码）
  "logger.test.js",
  // CLI 命令和测试文件（包含交互式提示标签和测试假数据）
  "encrypt.js",
  "audit-logger.test.js",
  // CLI LLM provider integration tests (contain fake test API keys)
  "llm-provider-workflow.test.js",
  "proxy-base-url-override.test.js",
  // Plugin ecosystem test (contains fake API key for secret-detection test)
  "plugin-ecosystem.test.js",
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
  } catch (_error) {
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
  } catch (_error) {
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
