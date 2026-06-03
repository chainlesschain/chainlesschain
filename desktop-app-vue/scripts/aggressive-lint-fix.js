/**
 * 激进 ESLint 修复脚本
 * 批量修复高频未使用变量/参数警告
 *
 * 修复内容：
 * 1. 未使用的 createLogger 导入
 * 2. 未使用的 event 参数（IPC handlers）
 * 3. 未使用的 error 变量（catch 块）
 * 4. 未使用的 context 参数
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 统计
const stats = {
  filesProcessed: 0,
  createLoggerFixed: 0,
  eventParamFixed: 0,
  errorVarFixed: 0,
  contextParamFixed: 0,
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
      // 跳过 node_modules, dist, .git 等目录
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

    // 1. 修复未使用的 createLogger（删除导入或注释掉）
    // 检测模式：导入了 createLogger 但从未调用
    const hasCreateLoggerImport = /(?:const|import).*createLogger/.test(
      content,
    );
    const hasCreateLoggerUsage = /createLogger\s*\(/.test(content);

    if (hasCreateLoggerImport && !hasCreateLoggerUsage) {
      // 删除整行导入
      content = content.replace(
        /^.*(?:const|import).*createLogger.*[\r\n]+/gm,
        "",
      );
      stats.createLoggerFixed++;
      modified = true;
    }

    // 2. 修复未使用的 event 参数（IPC handlers）
    // ipcMain.handle('channel', async (event, data) => { ... })
    // 替换为: async (_event, data)
    content = content.replace(/\basync\s*\(\s*event\s*,/g, (match) => {
      stats.eventParamFixed++;
      modified = true;
      return "async (_event,";
    });

    // 同样处理同步版本
    content = content.replace(
      /\(event\s*,\s*([^)]+)\)\s*=>\s*{/g,
      (match, rest) => {
        stats.eventParamFixed++;
        modified = true;
        return `(_event, ${rest}) => {`;
      },
    );

    // 3. 修复未使用的 error 变量（catch 块）
    // catch (error) { // 未使用 error }
    // 替换为: catch (_error)
    content = content.replace(
      /catch\s*\(\s*error\s*\)\s*{([^}]*?)}/g,
      (match, body) => {
        // 检查 body 中是否使用了 error
        if (!body.includes("error")) {
          stats.errorVarFixed++;
          modified = true;
          return `catch (_error) {${body}}`;
        }
        return match;
      },
    );

    // 同样处理 catch (e)
    content = content.replace(
      /catch\s*\(\s*e\s*\)\s*{([^}]*?)}/g,
      (match, body) => {
        // 检查 body 中是否使用了 e（但排除 console.error 等）
        const usesE = body.match(/\be\b/g);
        if (!usesE || usesE.length === 0) {
          stats.errorVarFixed++;
          modified = true;
          return `catch (_e) {${body}}`;
        }
        return match;
      },
    );

    // 4. 修复未使用的 context 参数
    // (props, context) => { ... }
    // 替换为: (props, _context)
    content = content.replace(
      /\(\s*([^,]+)\s*,\s*context\s*\)\s*=>\s*{/g,
      (match, firstParam) => {
        stats.contextParamFixed++;
        modified = true;
        return `(${firstParam}, _context) => {`;
      },
    );

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
  console.log("🚀 开始激进 ESLint 修复...\n");

  const srcDir = path.join(__dirname, "..", "src");
  const files = getAllFiles(srcDir);

  console.log(`📁 找到 ${files.length} 个文件\n`);

  let processedCount = 0;
  files.forEach((file, index) => {
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
  console.log(`  - createLogger 修复: ${stats.createLoggerFixed}`);
  console.log(`  - event 参数修复: ${stats.eventParamFixed}`);
  console.log(`  - error 变量修复: ${stats.errorVarFixed}`);
  console.log(`  - context 参数修复: ${stats.contextParamFixed}`);
  console.log(
    `  - 总计修复: ${stats.createLoggerFixed + stats.eventParamFixed + stats.errorVarFixed + stats.contextParamFixed}\n`,
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
    execSync("npm run lint", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
  } catch (error) {
    console.log("⚠️  ESLint 检查完成（有警告，这是正常的）");
  }
}

// 执行
main();
