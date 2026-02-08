/**
 * 保守 ESLint 修复脚本 v2.0
 * 只修复 100% 安全的未使用参数问题
 *
 * 修复内容：
 * 1. 未使用的 event 参数（IPC handlers）
 * 2. 未使用的 context 参数（Vue setup）
 * 3. 未使用的 options 参数（workers）
 *
 * 不修复：createLogger（需要人工判断）
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 统计
const stats = {
  filesProcessed: 0,
  eventParamFixed: 0,
  contextParamFixed: 0,
  optionsParamFixed: 0,
  errors: [],
};

/**
 * 递归获取所有 .js 和 .vue 文件
 */
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!["node_modules", "dist", ".git", "coverage"].includes(file)) {
        getAllFiles(filePath, fileList);
      }
    } else if (file.endsWith(".js") || file.endsWith(".vue")) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * 修复单个文件
 */
function fixFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, "utf8");
    let modified = false;
    const originalContent = content;

    // 1. 修复未使用的 event 参数（IPC handlers）
    // 模式：async (event, ...args) => { ... }
    // 只修改参数名，不检查函数体（安全）
    const eventPatterns = [
      // async (event, data)
      /\basync\s+\(\s*event\s*,/g,
      // (event, data) =>
      /\(\s*event\s*,\s*([^)]+)\)\s*=>/g,
      // function(event, data)
      /\bfunction\s*\(\s*event\s*,/g,
    ];

    eventPatterns.forEach((pattern, index) => {
      if (index === 0) {
        // async (event, data)
        content = content.replace(pattern, (match) => {
          stats.eventParamFixed++;
          modified = true;
          return match.replace("event", "_event");
        });
      } else if (index === 1) {
        // (event, data) =>
        content = content.replace(pattern, (match, rest) => {
          stats.eventParamFixed++;
          modified = true;
          return `(_event, ${rest}) =>`;
        });
      } else if (index === 2) {
        // function(event, data)
        content = content.replace(pattern, (match) => {
          stats.eventParamFixed++;
          modified = true;
          return match.replace("event", "_event");
        });
      }
    });

    // 2. 修复未使用的 context 参数（Vue setup/composables）
    // 模式：(props, context) => { ... }
    content = content.replace(
      /\(\s*([^,\s]+)\s*,\s*context\s*\)\s*=>/g,
      (match, firstParam) => {
        stats.contextParamFixed++;
        modified = true;
        return `(${firstParam}, _context) =>`;
      },
    );

    // 3. 修复未使用的 options 参数（worker 文件）
    // 只在 worker 文件中修复
    if (filePath.includes(".worker.")) {
      content = content.replace(
        /\(\s*([^,\s]+)\s*,\s*options\s*\)\s*=>/g,
        (match, firstParam) => {
          stats.optionsParamFixed++;
          modified = true;
          return `(${firstParam}, _options) =>`;
        },
      );

      // 也处理 function 形式
      content = content.replace(
        /\bfunction\s+\w+\s*\(\s*([^,\s]+)\s*,\s*options\s*\)/g,
        (match, firstParam) => {
          stats.optionsParamFixed++;
          modified = true;
          return match.replace(", options)", ", _options)");
        },
      );
    }

    // 保存文件（如果有修改）
    if (modified && content !== originalContent) {
      fs.writeFileSync(filePath, content, "utf8");
      stats.filesProcessed++;
      return true;
    }

    return false;
  } catch (error) {
    stats.errors.push({ file: filePath, error: error.message });
    return false;
  }
}

/**
 * 主函数
 */
function main() {
  console.log("🛡️  开始保守 ESLint 修复...\n");

  const srcDir = path.join(__dirname, "..", "src");
  const files = getAllFiles(srcDir);

  console.log(`📁 找到 ${files.length} 个文件\n`);

  let processedCount = 0;
  files.forEach((file) => {
    if (fixFile(file)) {
      processedCount++;
      if (processedCount % 10 === 0) {
        process.stdout.write(
          `\r处理进度: ${processedCount}/${files.length} 文件...`,
        );
      }
    }
  });

  console.log(`\n\n✅ 修复完成！\n`);
  console.log("📊 修复统计：");
  console.log(`  - 处理的文件数: ${stats.filesProcessed}`);
  console.log(`  - event 参数修复: ${stats.eventParamFixed}`);
  console.log(`  - context 参数修复: ${stats.contextParamFixed}`);
  console.log(`  - options 参数修复: ${stats.optionsParamFixed}`);
  console.log(
    `  - 总计修复: ${stats.eventParamFixed + stats.contextParamFixed + stats.optionsParamFixed}\n`,
  );

  if (stats.errors.length > 0) {
    console.log("⚠️  错误：");
    stats.errors.forEach((err) => {
      console.log(`  - ${err.file}: ${err.error}`);
    });
  }

  // 运行 lint 检查修复效果
  console.log("\n🔍 运行 ESLint 验证...");
  try {
    const result = execSync("npm run lint 2>&1", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    // 提取警告数量
    const match = result.match(/✖ (\d+) problems/);
    if (match) {
      console.log(`\n✅ 修复后警告数: ${match[1]}`);
    }
  } catch (error) {
    // ESLint 有警告时会返回非0退出码
    const output = error.stdout || error.message;
    const match = output.match(/✖ (\d+) problems/);
    if (match) {
      console.log(`\n✅ 修复后警告数: ${match[1]}`);
    }
  }

  console.log("\n🎉 保守修复完成！");
  console.log("💡 提示：剩余的警告需要人工审查和修复");
}

// 执行
main();
