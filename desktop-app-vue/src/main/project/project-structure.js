/**
 * 项目文件夹结构管理器
 * 定义和创建不同类型项目的标准目录结构
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require("fs").promises;
const path = require("path");

class ProjectStructureManager {
  constructor() {
    // 项目结构定义
    this.structures = {
      // Web开发项目
      web: {
        name: "Web开发项目",
        directories: [
          "src",
          "src/css",
          "src/js",
          "src/images",
          "assets",
          "assets/fonts",
          "assets/icons",
          "dist",
          "docs",
        ],
        files: [
          { path: "src/index.html", template: "html_basic" },
          { path: "src/css/style.css", template: "css_basic" },
          { path: "src/js/script.js", template: "js_basic" },
          { path: "README.md", template: "readme_web" },
          { path: ".gitignore", template: "gitignore_web" },
        ],
      },

      // 文档项目
      document: {
        name: "文档项目",
        directories: ["docs", "assets", "assets/images", "templates", "output"],
        files: [
          { path: "docs/README.md", template: "readme_document" },
          { path: ".gitignore", template: "gitignore_document" },
        ],
      },

      // 数据分析项目
      data: {
        name: "数据分析项目",
        directories: [
          "data",
          "data/raw",
          "data/processed",
          "scripts",
          "notebooks",
          "output",
          "output/charts",
          "output/reports",
        ],
        files: [
          { path: "README.md", template: "readme_data" },
          { path: ".gitignore", template: "gitignore_data" },
        ],
      },

      // 应用开发项目
      app: {
        name: "应用程序项目",
        directories: [
          "src",
          "src/main",
          "src/renderer",
          "src/common",
          "assets",
          "build",
          "dist",
          "docs",
        ],
        files: [
          { path: "README.md", template: "readme_app" },
          { path: ".gitignore", template: "gitignore_app" },
          { path: "package.json", template: "package_json" },
        ],
      },
    };

    // 文件模板
    this.templates = {
      // HTML基础模板
      html_basic: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>我的项目</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <h1>欢迎</h1>
  <script src="js/script.js"></script>
</body>
</html>`,

      // CSS基础模板
      css_basic: `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
}`,

      // JS基础模板
      js_basic: `document.addEventListener('DOMContentLoaded', function() {
  logger.info('页面加载完成');
});`,

      // README模板 - Web项目
      readme_web: (projectName) => `# ${projectName}

Web开发项目

## 项目结构

\`\`\`
src/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── script.js
└── images/
\`\`\`

## 本地运行

直接打开 \`src/index.html\` 或使用本地服务器：

\`\`\`bash
npx http-server src -p 3000
\`\`\`

## 开发指南

1. HTML文件位于 \`src/\` 目录
2. CSS样式位于 \`src/css/\` 目录
3. JavaScript代码位于 \`src/js/\` 目录
4. 图片资源位于 \`src/images/\` 目录
`,

      // README模板 - 文档项目
      readme_document: (projectName) => `# ${projectName}

文档项目

## 项目结构

\`\`\`
docs/         # 文档文件
assets/       # 资源文件
templates/    # 模板文件
output/       # 输出目录
\`\`\`

## 使用说明

编辑 \`docs/\` 目录下的Markdown文件来更新文档内容。
`,

      // README模板 - 数据项目
      readme_data: (projectName) => `# ${projectName}

数据分析项目

## 项目结构

\`\`\`
data/
├── raw/          # 原始数据
└── processed/    # 处理后的数据
scripts/          # 分析脚本
notebooks/        # Jupyter笔记本
output/
├── charts/       # 图表
└── reports/      # 报告
\`\`\`

## 数据处理流程

1. 将原始数据放入 \`data/raw/\`
2. 运行处理脚本
3. 查看 \`output/\` 目录中的结果
`,

      // README模板 - 应用项目
      readme_app: (projectName) => `# ${projectName}

应用程序项目

## 项目结构

\`\`\`
src/
├── main/         # 主进程代码
├── renderer/     # 渲染进程代码
└── common/       # 公共代码
assets/           # 资源文件
build/            # 构建配置
dist/             # 打包输出
\`\`\`

## 开发

\`\`\`bash
npm install
npm run dev
\`\`\`

## 构建

\`\`\`bash
npm run build
\`\`\`
`,

      // .gitignore模板 - Web项目
      gitignore_web: `# 依赖
node_modules/
bower_components/

# 构建输出
dist/
build/

# 日志
*.log
npm-debug.log*

# 操作系统文件
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo`,

      // .gitignore模板 - 文档项目
      gitignore_document: `# 输出文件
output/
*.pdf
*.docx

# 临时文件
*.tmp
*.bak

# 操作系统文件
.DS_Store
Thumbs.db`,

      // .gitignore模板 - 数据项目
      gitignore_data: `# 数据文件
data/raw/*.csv
data/raw/*.xlsx
data/processed/

# Jupyter
.ipynb_checkpoints/
*.ipynb_checkpoints

# Python
__pycache__/
*.py[cod]
*.so
.Python
venv/
env/

# 输出
output/
*.png
*.jpg`,

      // .gitignore模板 - 应用项目
      gitignore_app: `# 依赖
node_modules/

# 构建
dist/
build/
out/

# 日志
logs/
*.log

# 环境变量
.env
.env.local

# 操作系统
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/`,

      // package.json模板
      package_json: (projectName) =>
        JSON.stringify(
          {
            name: projectName.toLowerCase().replace(/\s+/g, "-"),
            version: "1.0.0",
            description: "应用程序项目",
            main: "src/main/index.js",
            scripts: {
              dev: 'echo "开发命令"',
              build: 'echo "构建命令"',
            },
            keywords: [],
            author: "",
            license: "MIT",
          },
          null,
          2,
        ),
    };
  }

  /**
   * 创建项目结构
   * @param {string} projectPath - 项目根路径
   * @param {string} projectType - 项目类型
   * @param {string} projectName - 项目名称
   * @returns {Promise<Object>} 创建结果
   */
  async createStructure(
    projectPath,
    projectType = "web",
    projectName = "My Project",
  ) {
    const structure = this.structures[projectType];

    if (!structure) {
      throw new Error(`不支持的项目类型: ${projectType}`);
    }

    logger.info(
      `[Project Structure] 创建${structure.name}结构: ${projectPath}`,
    );

    try {
      // 确保项目根目录存在
      await fs.mkdir(projectPath, { recursive: true });

      // 创建目录结构
      for (const dir of structure.directories) {
        const dirPath = path.join(projectPath, dir);
        await fs.mkdir(dirPath, { recursive: true });
        logger.info(`[Project Structure] 创建目录: ${dir}`);
      }

      // 创建文件
      const createdFiles = [];

      for (const fileConfig of structure.files) {
        const filePath = path.join(projectPath, fileConfig.path);
        const template = fileConfig.template;

        let content = "";

        if (typeof this.templates[template] === "function") {
          content = this.templates[template](projectName);
        } else if (typeof this.templates[template] === "string") {
          content = this.templates[template];
        }

        await fs.writeFile(filePath, content, "utf-8");
        createdFiles.push(fileConfig.path);
        logger.info(`[Project Structure] 创建文件: ${fileConfig.path}`);
      }

      logger.info(`[Project Structure] 结构创建成功`);

      return {
        success: true,
        projectPath,
        projectType,
        directories: structure.directories,
        files: createdFiles,
      };
    } catch (error) {
      logger.error("[Project Structure] 创建失败:", error);
      throw new Error(`创建项目结构失败: ${error.message}`);
    }
  }

  /**
   * 获取项目结构定义
   * @param {string} projectType - 项目类型
   * @returns {Object} 结构定义
   */
  getStructure(projectType) {
    return this.structures[projectType];
  }

  /**
   * 获取所有项目类型
   * @returns {Array} 项目类型列表
   */
  getProjectTypes() {
    return Object.keys(this.structures).map((type) => ({
      type,
      name: this.structures[type].name,
    }));
  }

  /**
   * 验证项目结构
   * @param {string} projectPath - 项目路径
   * @param {string} projectType - 项目类型
   * @returns {Promise<Object>} 验证结果
   */
  async validateStructure(projectPath, projectType) {
    const structure = this.structures[projectType];

    if (!structure) {
      return {
        valid: false,
        error: "不支持的项目类型",
      };
    }

    const missing = {
      directories: [],
      files: [],
    };

    // 检查目录
    for (const dir of structure.directories) {
      const dirPath = path.join(projectPath, dir);

      try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) {
          missing.directories.push(dir);
        }
      } catch (error) {
        missing.directories.push(dir);
      }
    }

    // 检查文件
    for (const fileConfig of structure.files) {
      const filePath = path.join(projectPath, fileConfig.path);

      try {
        await fs.stat(filePath);
      } catch (error) {
        missing.files.push(fileConfig.path);
      }
    }

    const valid =
      missing.directories.length === 0 && missing.files.length === 0;

    return {
      valid,
      missing,
      message: valid ? "项目结构完整" : "项目结构不完整",
    };
  }

  /**
   * 添加自定义项目类型
   * @param {string} type - 类型标识
   * @param {Object} structure - 结构定义
   */
  addProjectType(type, structure) {
    this.structures[type] = structure;
    logger.info(`[Project Structure] 添加项目类型: ${type}`);
  }
}

module.exports = ProjectStructureManager;
