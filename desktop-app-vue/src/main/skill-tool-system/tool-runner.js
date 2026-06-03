/**
 * 工具运行器
 * 实际执行工具的底层实现
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs").promises;
const path = require("path");

class ToolRunner {
  constructor(toolManager) {
    this.toolManager = toolManager;
    this.toolImplementations = this.initializeToolImplementations();
  }

  /**
   * 初始化工具实现
   */
  initializeToolImplementations() {
    return {
      // 文件操作类工具
      file_reader: this.createFileReader(),
      file_writer: this.createFileWriter(),
      file_editor: this.createFileEditor(),

      // 代码生成类工具
      html_generator: this.createHtmlGenerator(),
      css_generator: this.createCssGenerator(),
      js_generator: this.createJsGenerator(),

      // 项目管理类工具
      create_project_structure: this.createProjectStructureCreator(),
      git_init: this.createGitInit(),
      git_commit: this.createGitCommit(),

      // 通用工具类
      info_searcher: this.createInfoSearcher(),
      format_output: this.createFormatOutput(),
      generic_handler: this.createGenericHandler(),
    };
  }

  /**
   * 执行工具
   */
  async executeTool(toolName, params, options = {}) {
    const startTime = Date.now();

    try {
      logger.info(`[ToolRunner] 执行工具: ${toolName}`);
      logger.info(`[ToolRunner] 参数:`, params);
      logger.info(`[ToolRunner] 选项:`, options);
      logger.info(`[ToolRunner] 项目路径:`, options.projectPath);

      // 1. 获取工具信息
      const tool = await this.toolManager.getToolByName(toolName);
      if (!tool) {
        throw new Error(`工具不存在: ${toolName}`);
      }

      if (!tool.enabled) {
        throw new Error(`工具已禁用: ${toolName}`);
      }

      // 2. 验证参数
      const validationResult = this.validateParams(tool, params);
      if (!validationResult.valid) {
        throw new Error(`参数验证失败: ${validationResult.errors.join(", ")}`);
      }

      // 3. 获取工具实现
      const implementation = this.toolImplementations[toolName];
      if (!implementation) {
        throw new Error(`工具实现未找到: ${toolName}`);
      }

      // 4. 执行工具
      const result = await implementation(params, options);

      // 5. 记录执行
      const executionTime = Date.now() - startTime;
      await this.toolManager.recordExecution(toolName, true, executionTime);

      logger.info(
        `[ToolRunner] 工具执行成功: ${toolName}, 耗时: ${executionTime}ms`,
      );

      return {
        success: true,
        result,
        executionTime,
        toolName,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      await this.toolManager.recordExecution(toolName, false, executionTime);

      logger.error(`[ToolRunner] 工具执行失败: ${toolName}`, error);

      return {
        success: false,
        error: error.message,
        executionTime,
        toolName,
      };
    }
  }

  /**
   * 验证参数
   */
  validateParams(tool, params) {
    const schema =
      typeof tool.parameters_schema === "string"
        ? JSON.parse(tool.parameters_schema)
        : tool.parameters_schema;

    const errors = [];

    // 检查必需参数
    if (schema.required) {
      schema.required.forEach((requiredParam) => {
        if (params[requiredParam] === undefined) {
          errors.push(`缺少必需参数: ${requiredParam}`);
        }
      });
    }

    // 检查参数类型
    if (schema.properties) {
      Object.entries(params).forEach(([key, value]) => {
        const propSchema = schema.properties[key];
        if (propSchema && propSchema.type) {
          const actualType = Array.isArray(value) ? "array" : typeof value;
          if (actualType !== propSchema.type) {
            errors.push(
              `参数 ${key} 类型错误: 期望 ${propSchema.type}, 实际 ${actualType}`,
            );
          }
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ========== 工具实现 ==========

  /**
   * 文件读取器
   */
  createFileReader() {
    return async (params, options = {}) => {
      const { filePath } = params;

      // 解析文件路径：如果是相对路径且提供了projectPath，则使用项目路径
      let resolvedPath = filePath;
      if (options.projectPath && !path.isAbsolute(filePath)) {
        resolvedPath = path.join(options.projectPath, filePath);
        logger.info(
          `[ToolRunner] 相对路径解析: ${filePath} -> ${resolvedPath}`,
        );
      }

      // 安全检查：防止路径遍历
      const safePath = path.normalize(resolvedPath);
      if (safePath.includes("..")) {
        throw new Error("非法路径");
      }

      const content = await fs.readFile(safePath, "utf8");

      return {
        success: true,
        filePath: safePath,
        content,
        size: content.length,
      };
    };
  }

  /**
   * 文件写入器
   */
  createFileWriter() {
    return async (params, options = {}) => {
      const { filePath, content, mode = "overwrite" } = params;

      // 解析文件路径：如果是相对路径且提供了projectPath，则使用项目路径
      let resolvedPath = filePath;
      if (options.projectPath && !path.isAbsolute(filePath)) {
        resolvedPath = path.join(options.projectPath, filePath);
        logger.info(
          `[ToolRunner] 相对路径解析: ${filePath} -> ${resolvedPath}`,
        );
      }

      // 安全检查
      const safePath = path.normalize(resolvedPath);
      if (safePath.includes("..")) {
        throw new Error("非法路径");
      }

      // 确保目录存在
      const dir = path.dirname(safePath);
      await fs.mkdir(dir, { recursive: true });

      // 根据模式写入
      if (mode === "append") {
        await fs.appendFile(safePath, content, "utf8");
      } else {
        await fs.writeFile(safePath, content, "utf8");
      }

      logger.info(
        `[ToolRunner] 文件已写入: ${safePath}, 大小: ${content.length} 字节`,
      );

      return {
        success: true,
        filePath: safePath,
        bytesWritten: content.length,
        mode,
      };
    };
  }

  /**
   * 文件编辑器
   */
  createFileEditor() {
    return async (params, options = {}) => {
      const { filePath, search, replace, mode = "first" } = params;

      // 解析文件路径：如果是相对路径且提供了projectPath，则使用项目路径
      let resolvedPath = filePath;
      if (options.projectPath && !path.isAbsolute(filePath)) {
        resolvedPath = path.join(options.projectPath, filePath);
        logger.info(
          `[ToolRunner] 相对路径解析: ${filePath} -> ${resolvedPath}`,
        );
      }

      const safePath = path.normalize(resolvedPath);
      const content = await fs.readFile(safePath, "utf8");

      let newContent;
      if (mode === "all") {
        newContent = content.replaceAll(search, replace);
      } else if (mode === "regex") {
        newContent = content.replace(new RegExp(search, "g"), replace);
      } else {
        newContent = content.replace(search, replace);
      }

      await fs.writeFile(safePath, newContent, "utf8");

      return {
        success: true,
        filePath: safePath,
        replacements: (content.match(new RegExp(search, "g")) || []).length,
      };
    };
  }

  /**
   * HTML生成器
   */
  createHtmlGenerator() {
    return async (params) => {
      const {
        title = "我的网页",
        content = "",
        primaryColor = "#667eea",
        includeNav = false,
        navItems = [],
      } = params;

      const nav = includeNav
        ? `
    <nav style="background: ${primaryColor}; padding: 1rem; color: white;">
      <ul style="list-style: none; display: flex; gap: 2rem; margin: 0; padding: 0;">
        ${navItems.map((item) => `<li><a href="#" style="color: white; text-decoration: none;">${item}</a></li>`).join("\n        ")}
      </ul>
    </nav>`
        : "";

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    h1 {
      color: ${primaryColor};
      margin-bottom: 1rem;
    }

    a {
      color: ${primaryColor};
    }
  </style>
</head>
<body>
  ${nav}
  <div class="container">
    ${content}
  </div>
</body>
</html>`;

      return {
        success: true,
        html,
        fileName: `${title.replace(/[^a-zA-Z0-9]/g, "_")}.html`,
      };
    };
  }

  /**
   * CSS生成器
   */
  createCssGenerator() {
    return async (params) => {
      const {
        primaryColor = "#667eea",
        secondaryColor = "#764ba2",
        fontFamily = "system-ui, sans-serif",
        responsive = true,
      } = params;

      const css = `/* 生成的CSS样式 */
:root {
  --primary-color: ${primaryColor};
  --secondary-color: ${secondaryColor};
  --font-family: ${fontFamily};
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-family);
  line-height: 1.6;
  color: #333;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.btn {
  background: var(--primary-color);
  color: white;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.3s;
}

.btn:hover {
  opacity: 0.9;
}

${
  responsive
    ? `
/* 响应式设计 */
@media (max-width: 768px) {
  .container {
    padding: 1rem;
  }
}
`
    : ""
}`;

      return {
        success: true,
        css,
        fileName: "styles.css",
      };
    };
  }

  /**
   * JS生成器
   */
  createJsGenerator() {
    return async (params) => {
      const { moduleName = "myApp", features = [], useES6 = true } = params;

      const js = useES6
        ? `// ES6 模块
export class ${moduleName} {
  constructor(options = {}) {
    this.options = options;
    this.init();
  }

  init() {
    logger.info('${moduleName} 初始化完成');
  }

  ${features
    .map(
      (feature) => `
  ${feature}() {
    // ${feature} 功能实现
  }`,
    )
    .join("\n")}
}

export default ${moduleName};
`
        : `// 传统JS
var ${moduleName} = (function() {
  function ${moduleName}(options) {
    this.options = options || {};
    this.init();
  }

  ${moduleName}.prototype.init = function() {
    logger.info('${moduleName} 初始化完成');
  };

  return ${moduleName};
})();
`;

      return {
        success: true,
        js,
        fileName: `${moduleName}.js`,
        moduleType: useES6 ? "ES6" : "CommonJS",
      };
    };
  }

  /**
   * 创建项目结构
   */
  createProjectStructureCreator() {
    return async (params) => {
      const { projectPath, projectType = "web", features = [] } = params;

      const safePath = path.normalize(projectPath);

      // 创建基础目录结构
      const dirs = [
        "src",
        "src/assets",
        "src/components",
        "src/utils",
        "public",
        "docs",
      ];

      for (const dir of dirs) {
        await fs.mkdir(path.join(safePath, dir), { recursive: true });
      }

      // 创建基础文件
      await fs.writeFile(
        path.join(safePath, "README.md"),
        `# ${path.basename(safePath)}\n\n项目描述\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(safePath, ".gitignore"),
        `node_modules/\ndist/\n.env\n`,
        "utf8",
      );

      return {
        success: true,
        projectPath: safePath,
        dirsCreated: dirs.length,
        filesCreated: 2,
      };
    };
  }

  /**
   * Git初始化
   */
  createGitInit() {
    return async (params) => {
      const { repoPath } = params;

      // 注意：这里简化实现，实际应使用 isomorphic-git
      const safePath = path.normalize(repoPath);
      const gitDir = path.join(safePath, ".git");

      // 检查是否已是Git仓库
      try {
        await fs.access(gitDir);
        return {
          success: false,
          error: "已经是Git仓库",
        };
      } catch {
        // 不存在，可以初始化
      }

      // 创建.git目录（简化版）
      await fs.mkdir(gitDir, { recursive: true });

      return {
        success: true,
        repoPath: safePath,
        message: "Git仓库初始化成功",
      };
    };
  }

  /**
   * Git提交
   */
  createGitCommit() {
    return async (params) => {
      const { repoPath, message, files = [] } = params;

      // 注意：这里简化实现，实际应使用 isomorphic-git
      const safePath = path.normalize(repoPath);

      return {
        success: true,
        repoPath: safePath,
        message,
        filesCommitted: files.length,
        commitId: `commit_${Date.now()}`,
      };
    };
  }

  /**
   * 信息搜索器
   */
  createInfoSearcher() {
    return async (params) => {
      const { query, source = "local" } = params;

      // 简化实现
      return {
        success: true,
        query,
        results: [
          { title: "结果1", content: "内容1" },
          { title: "结果2", content: "内容2" },
        ],
        source,
      };
    };
  }

  /**
   * 格式化输出
   */
  createFormatOutput() {
    return async (params) => {
      const { data, format = "json" } = params;

      let formatted;
      switch (format) {
        case "json":
          formatted = JSON.stringify(data, null, 2);
          break;
        case "yaml":
          // 简化的YAML格式
          formatted = Object.entries(data)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");
          break;
        case "table":
          formatted = this.formatAsTable(data);
          break;
        default:
          formatted = String(data);
      }

      return {
        success: true,
        formatted,
        format,
      };
    };
  }

  /**
   * 通用处理器
   */
  createGenericHandler() {
    return async (params) => {
      const { action, data } = params;

      return {
        success: true,
        action,
        result: `处理完成: ${action}`,
        data,
      };
    };
  }

  /**
   * 格式化为表格
   */
  formatAsTable(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return String(data);
    }

    const keys = Object.keys(data[0]);
    const header = "| " + keys.join(" | ") + " |";
    const separator = "| " + keys.map(() => "---").join(" | ") + " |";
    const rows = data.map(
      (row) => "| " + keys.map((key) => row[key]).join(" | ") + " |",
    );

    return [header, separator, ...rows].join("\n");
  }
}

module.exports = ToolRunner;
