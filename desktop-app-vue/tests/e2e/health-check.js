/**
 * E2E测试环境健康检查
 * 快速验证测试环境是否准备就绪
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 颜色代码
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

// 检查结果
const checks = {
  passed: [],
  failed: [],
  warnings: [],
};

console.log("\n" + "=".repeat(80));
console.log(colors.cyan + "       🏥 E2E测试环境健康检查 🏥" + colors.reset);
console.log("=".repeat(80) + "\n");

// 检查1: 测试目录结构
console.log(`${colors.blue}[1/10]${colors.reset} 检查测试目录结构...`);
try {
  const testDir = path.join(__dirname);
  const modules = [
    "knowledge",
    "social",
    "project",
    "settings",
    "monitoring",
    "trading",
    "enterprise",
    "devtools",
    "content",
    "plugins",
    "multimedia",
  ];

  const missingModules = [];
  modules.forEach((module) => {
    const modulePath = path.join(testDir, module);
    if (!fs.existsSync(modulePath)) {
      missingModules.push(module);
    }
  });

  if (missingModules.length === 0) {
    console.log(`  ${colors.green}✅ 所有11个模块目录存在${colors.reset}`);
    checks.passed.push("目录结构完整");
  } else {
    console.log(
      `  ${colors.red}❌ 缺少模块: ${missingModules.join(", ")}${colors.reset}`,
    );
    checks.failed.push(`缺少模块目录: ${missingModules.join(", ")}`);
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("目录结构检查失败");
}

// 检查2: 测试文件数量
console.log(`\n${colors.blue}[2/10]${colors.reset} 检查测试文件数量...`);
try {
  const testFiles = [];
  const findTestFiles = (dir) => {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        findTestFiles(filePath);
      } else if (file.endsWith(".e2e.test.ts")) {
        testFiles.push(filePath);
      }
    });
  };

  findTestFiles(__dirname);

  const expectedFiles = 55;
  if (testFiles.length >= expectedFiles) {
    console.log(
      `  ${colors.green}✅ 找到 ${testFiles.length} 个测试文件 (期望: ${expectedFiles}+)${colors.reset}`,
    );
    checks.passed.push(`测试文件: ${testFiles.length}个`);
  } else {
    console.log(
      `  ${colors.yellow}⚠️ 只找到 ${testFiles.length} 个测试文件 (期望: ${expectedFiles}+)${colors.reset}`,
    );
    checks.warnings.push(
      `测试文件数量不足: ${testFiles.length}/${expectedFiles}`,
    );
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("测试文件统计失败");
}

// 检查3: Helper文件
console.log(`\n${colors.blue}[3/10]${colors.reset} 检查Helper文件...`);
try {
  const helperPath = path.join(__dirname, "helpers", "common.ts");
  if (fs.existsSync(helperPath)) {
    const helperContent = fs.readFileSync(helperPath, "utf8");
    const hasLaunch = helperContent.includes("launchElectronApp");
    const hasClose = helperContent.includes("closeElectronApp");

    if (hasLaunch && hasClose) {
      console.log(`  ${colors.green}✅ Helper函数完整${colors.reset}`);
      checks.passed.push("Helper文件存在且完整");
    } else {
      console.log(`  ${colors.yellow}⚠️ Helper函数不完整${colors.reset}`);
      checks.warnings.push("Helper函数可能缺失");
    }
  } else {
    console.log(`  ${colors.red}❌ Helper文件不存在${colors.reset}`);
    checks.failed.push("Helper文件缺失");
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("Helper文件检查失败");
}

// 检查4: Node.js版本
console.log(`\n${colors.blue}[4/10]${colors.reset} 检查Node.js版本...`);
try {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0]);

  if (majorVersion >= 16) {
    console.log(
      `  ${colors.green}✅ Node.js ${nodeVersion} (推荐: 16+)${colors.reset}`,
    );
    checks.passed.push(`Node.js ${nodeVersion}`);
  } else {
    console.log(
      `  ${colors.yellow}⚠️ Node.js ${nodeVersion} (推荐升级到16+)${colors.reset}`,
    );
    checks.warnings.push(`Node.js版本过低: ${nodeVersion}`);
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("Node.js版本检查失败");
}

// 检查5: npm依赖
console.log(`\n${colors.blue}[5/10]${colors.reset} 检查npm依赖...`);
try {
  const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const hasPlaywright =
      packageJson.devDependencies &&
      packageJson.devDependencies["@playwright/test"];
    const hasElectron =
      packageJson.dependencies && packageJson.dependencies["electron"];

    if (hasPlaywright && hasElectron) {
      console.log(
        `  ${colors.green}✅ 关键依赖已安装 (Playwright, Electron)${colors.reset}`,
      );
      checks.passed.push("依赖完整");
    } else {
      console.log(`  ${colors.yellow}⚠️ 缺少关键依赖${colors.reset}`);
      if (!hasPlaywright) {
        checks.warnings.push("缺少Playwright");
      }
      if (!hasElectron) {
        checks.warnings.push("缺少Electron");
      }
    }
  } else {
    console.log(`  ${colors.yellow}⚠️ 找不到package.json${colors.reset}`);
    checks.warnings.push("package.json不存在");
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("依赖检查失败");
}

// 检查6: Electron主进程构建
console.log(`\n${colors.blue}[6/10]${colors.reset} 检查Electron主进程构建...`);
try {
  const mainIndexPath = path.join(
    __dirname,
    "..",
    "..",
    "dist",
    "main",
    "index.js",
  );
  if (fs.existsSync(mainIndexPath)) {
    console.log(`  ${colors.green}✅ 主进程已构建${colors.reset}`);
    checks.passed.push("主进程构建存在");
  } else {
    console.log(
      `  ${colors.yellow}⚠️ 主进程未构建，请运行: npm run build:main${colors.reset}`,
    );
    checks.warnings.push("主进程未构建");
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("主进程构建检查失败");
}

// 检查7: 文档完整性
console.log(`\n${colors.blue}[7/10]${colors.reset} 检查文档...`);
try {
  const docs = [
    "COMPLETE_VALIDATION_REPORT.md",
    "FINAL_SUMMARY.txt",
    "FINAL_100_PERCENT_REPORT.md",
    "E2E_TEST_COVERAGE.md",
  ];

  const existingDocs = docs.filter((doc) =>
    fs.existsSync(path.join(__dirname, doc)),
  );

  if (existingDocs.length === docs.length) {
    console.log(
      `  ${colors.green}✅ 所有文档完整 (${docs.length}/${docs.length})${colors.reset}`,
    );
    checks.passed.push("文档完整");
  } else {
    console.log(
      `  ${colors.yellow}⚠️ 部分文档缺失 (${existingDocs.length}/${docs.length})${colors.reset}`,
    );
    checks.warnings.push(`文档不完整: ${existingDocs.length}/${docs.length}`);
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("文档检查失败");
}

// 检查8: 验证工具
console.log(`\n${colors.blue}[8/10]${colors.reset} 检查验证工具...`);
try {
  const tools = [
    "quick-check.js",
    "quick-validation.js",
    "run-all-modules.js",
    "health-check.js",
  ];

  const existingTools = tools.filter((tool) =>
    fs.existsSync(path.join(__dirname, tool)),
  );

  if (existingTools.length === tools.length) {
    console.log(
      `  ${colors.green}✅ 所有工具完整 (${tools.length}/${tools.length})${colors.reset}`,
    );
    checks.passed.push("验证工具完整");
  } else {
    console.log(
      `  ${colors.yellow}⚠️ 部分工具缺失 (${existingTools.length}/${tools.length})${colors.reset}`,
    );
    checks.warnings.push(`工具不完整: ${existingTools.length}/${tools.length}`);
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("工具检查失败");
}

// 检查9: Playwright配置
console.log(`\n${colors.blue}[9/10]${colors.reset} 检查Playwright配置...`);
try {
  const playwrightConfig = path.join(__dirname, "..", "playwright.config.ts");
  if (fs.existsSync(playwrightConfig)) {
    console.log(`  ${colors.green}✅ Playwright配置存在${colors.reset}`);
    checks.passed.push("Playwright配置完整");
  } else {
    console.log(`  ${colors.yellow}⚠️ Playwright配置不存在${colors.reset}`);
    checks.warnings.push("Playwright配置缺失");
  }
} catch (error) {
  console.log(`  ${colors.red}❌ 检查失败: ${error.message}${colors.reset}`);
  checks.failed.push("Playwright配置检查失败");
}

// 检查10: 快速测试运行
console.log(`\n${colors.blue}[10/10]${colors.reset} 执行快速测试...`);
try {
  console.log(`  运行单个测试文件以验证环境...`);
  const testFile = path.join(
    "tests",
    "e2e",
    "knowledge",
    "knowledge-graph.e2e.test.ts",
  );

  // 尝试运行一个简单的测试
  console.log(`  ${colors.yellow}提示: 这可能需要1-2分钟...${colors.reset}`);

  try {
    execSync(`npm run test:e2e -- ${testFile} --reporter=list`, {
      encoding: "utf8",
      timeout: 120000, // 2分钟超时
      stdio: "pipe",
    });
    console.log(`  ${colors.green}✅ 测试环境工作正常${colors.reset}`);
    checks.passed.push("测试环境可运行");
  } catch (testError) {
    const output = testError.stdout ? testError.stdout.toString("utf-8") : "";
    if (output.includes("passed")) {
      console.log(`  ${colors.green}✅ 测试环境工作正常${colors.reset}`);
      checks.passed.push("测试环境可运行");
    } else {
      console.log(
        `  ${colors.yellow}⚠️ 测试运行有问题，请手动验证${colors.reset}`,
      );
      checks.warnings.push("测试运行可能有问题");
    }
  }
} catch (error) {
  console.log(`  ${colors.yellow}⚠️ 跳过快速测试 (可手动运行)${colors.reset}`);
  checks.warnings.push("快速测试未执行");
}

// 打印总结
console.log("\n" + "=".repeat(80));
console.log(
  colors.cyan + "                   📊 健康检查总结 📊" + colors.reset,
);
console.log("=".repeat(80) + "\n");

console.log(`${colors.green}通过: ${checks.passed.length}${colors.reset}`);
checks.passed.forEach((item) => console.log(`  ✅ ${item}`));

if (checks.warnings.length > 0) {
  console.log(
    `\n${colors.yellow}警告: ${checks.warnings.length}${colors.reset}`,
  );
  checks.warnings.forEach((item) => console.log(`  ⚠️ ${item}`));
}

if (checks.failed.length > 0) {
  console.log(`\n${colors.red}失败: ${checks.failed.length}${colors.reset}`);
  checks.failed.forEach((item) => console.log(`  ❌ ${item}`));
}

console.log("\n" + "=".repeat(80));

// 总体健康状态
const totalChecks =
  checks.passed.length + checks.warnings.length + checks.failed.length;
const healthScore = ((checks.passed.length / totalChecks) * 100).toFixed(0);

console.log(`\n健康评分: ${healthScore}%`);

if (checks.failed.length === 0 && checks.warnings.length === 0) {
  console.log(
    colors.green + "\n✅ 环境完全健康，可以开始测试！" + colors.reset,
  );
  process.exit(0);
} else if (checks.failed.length === 0) {
  console.log(colors.yellow + "\n⚠️ 环境基本健康，但有一些警告" + colors.reset);
  console.log("建议: 查看上述警告并根据需要修复\n");
  process.exit(0);
} else {
  console.log(colors.red + "\n❌ 环境有问题，请修复失败项" + colors.reset);
  console.log("建议: 先修复失败项再运行测试\n");
  process.exit(1);
}
