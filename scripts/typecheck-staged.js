#!/usr/bin/env node

/**
 * TypeScript 类型检查脚本
 * 用于 pre-commit hook 的 TypeScript 类型验证
 *
 * 只在有 TypeScript 文件被暂存时运行类型检查
 */

const { execSync } = require("child_process");
const path = require("path");

// 获取暂存的 TypeScript 文件
function getStagedTSFiles() {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf8",
    });
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((file) => /\.(ts|tsx)$/.test(file));
  } catch (error) {
    console.warn("Warning: Could not get staged files. Skipping type check.");
    return [];
  }
}

// 检查文件是否在 desktop-app-vue 目录下
function isInDesktopAppVue(file) {
  return file.startsWith("desktop-app-vue/");
}

function runTypeCheck() {
  console.log("🔍 Checking for TypeScript files...\n");

  const stagedTSFiles = getStagedTSFiles();

  if (stagedTSFiles.length === 0) {
    console.log("✅ No TypeScript files staged. Skipping type check.\n");
    return true;
  }

  // 检查是否有 desktop-app-vue 目录下的 TS 文件
  const desktopAppVueTSFiles = stagedTSFiles.filter(isInDesktopAppVue);

  if (desktopAppVueTSFiles.length === 0) {
    console.log(
      "✅ No TypeScript files in desktop-app-vue. Skipping type check.\n",
    );
    return true;
  }

  console.log(
    `📝 Found ${desktopAppVueTSFiles.length} TypeScript file(s) in desktop-app-vue:`,
  );
  desktopAppVueTSFiles.forEach((file) => console.log(`   - ${file}`));
  console.log("");

  console.log("🔧 Running TypeScript type check...\n");

  try {
    // 在 desktop-app-vue 目录下运行 tsc
    const desktopAppVuePath = path.join(process.cwd(), "desktop-app-vue");

    execSync("npx tsc --noEmit", {
      cwd: desktopAppVuePath,
      encoding: "utf8",
      stdio: "inherit",
    });

    console.log("\n✅ TypeScript type check passed.\n");
    return true;
  } catch (error) {
    console.error("\n❌ TypeScript type check failed!");
    console.error("Please fix the type errors before committing.\n");
    console.error(
      "You can run 'npm run type-check' in desktop-app-vue to see all errors.\n",
    );
    console.error(
      "If you need to skip this check (not recommended), use: git commit --no-verify\n",
    );
    return false;
  }
}

// 运行类型检查
const success = runTypeCheck();
process.exit(success ? 0 : 1);
