/**
 * 项目文件夹结构管理器
 * 定义和创建不同类型项目的标准目录结构
 * 与 Android 端对齐的 12 种项目类型
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs").promises;
const path = require("path");
const {
  ProjectType,
  ProjectTypeInfo,
  ProjectTemplates,
  getTemplateById,
  getTemplatesByCategory,
  getTemplatesByProjectType,
} = require("./project-types.js");

class ProjectStructureManager {
  constructor() {
    // 项目结构定义 - 12种项目类型（与Android对齐）
    this.structures = {
      // 1. Android应用项目
      [ProjectType.ANDROID]: {
        name: "Android应用项目",
        directories: [
          "app/src/main/java/com/example/app",
          "app/src/main/java/com/example/app/ui",
          "app/src/main/java/com/example/app/data",
          "app/src/main/java/com/example/app/viewmodel",
          "app/src/main/res/layout",
          "app/src/main/res/values",
          "app/src/main/res/drawable",
          "app/src/test/java/com/example/app",
          "app/src/androidTest/java/com/example/app",
          "gradle/wrapper",
        ],
        files: [
          { path: "README.md", template: "readme_android" },
          { path: "build.gradle.kts", template: "android_build_gradle_root" },
          { path: "settings.gradle.kts", template: "android_settings_gradle" },
          { path: "gradle.properties", template: "android_gradle_properties" },
          { path: "app/build.gradle.kts", template: "android_build_gradle_app" },
          { path: "app/src/main/AndroidManifest.xml", template: "android_manifest" },
          { path: "app/src/main/java/com/example/app/MainActivity.kt", template: "android_main_activity" },
          { path: ".gitignore", template: "gitignore_android" },
        ],
      },

      // 2. iOS应用项目
      [ProjectType.IOS]: {
        name: "iOS应用项目",
        directories: [
          "Sources",
          "Sources/App",
          "Sources/Views",
          "Sources/Models",
          "Sources/ViewModels",
          "Sources/Services",
          "Resources",
          "Resources/Assets.xcassets",
          "Tests",
        ],
        files: [
          { path: "README.md", template: "readme_ios" },
          { path: "Package.swift", template: "ios_package_swift" },
          { path: "Sources/App/App.swift", template: "ios_app" },
          { path: "Sources/Views/ContentView.swift", template: "ios_content_view" },
          { path: ".gitignore", template: "gitignore_ios" },
        ],
      },

      // 3. Web开发项目
      [ProjectType.WEB]: {
        name: "Web开发项目",
        directories: [
          "src",
          "src/components",
          "src/pages",
          "src/styles",
          "src/utils",
          "src/assets",
          "public",
          "dist",
        ],
        files: [
          { path: "src/index.html", template: "html_basic" },
          { path: "src/styles/style.css", template: "css_basic" },
          { path: "src/utils/script.js", template: "js_basic" },
          { path: "README.md", template: "readme_web" },
          { path: ".gitignore", template: "gitignore_web" },
        ],
      },

      // 4. 桌面应用项目
      [ProjectType.DESKTOP]: {
        name: "桌面应用项目",
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
          { path: "README.md", template: "readme_desktop" },
          { path: ".gitignore", template: "gitignore_app" },
          { path: "package.json", template: "package_json" },
        ],
      },

      // 5. API服务项目
      [ProjectType.API]: {
        name: "API服务项目",
        directories: [
          "src",
          "src/controllers",
          "src/middlewares",
          "src/models",
          "src/routes",
          "src/services",
          "src/utils",
          "src/config",
          "tests",
        ],
        files: [
          { path: "README.md", template: "readme_api" },
          { path: "package.json", template: "nodejs_package_json" },
          { path: "src/index.ts", template: "nodejs_index" },
          { path: "src/app.ts", template: "nodejs_app" },
          { path: ".gitignore", template: "gitignore_node" },
        ],
      },

      // 6. 数据分析项目
      [ProjectType.DATA]: {
        name: "数据分析项目",
        directories: [
          "data",
          "data/raw",
          "data/processed",
          "notebooks",
          "src",
          "src/data",
          "src/features",
          "src/models",
          "src/visualization",
          "reports",
          "reports/figures",
        ],
        files: [
          { path: "README.md", template: "readme_data" },
          { path: "requirements.txt", template: "python_ds_requirements" },
          { path: "notebooks/01_exploration.ipynb", template: "python_ds_notebook" },
          { path: ".gitignore", template: "gitignore_python" },
        ],
      },

      // 7. 文档项目
      [ProjectType.DOCUMENT]: {
        name: "文档项目",
        directories: ["docs", "assets", "assets/images", "templates", "output"],
        files: [
          { path: "docs/README.md", template: "readme_document" },
          { path: ".gitignore", template: "gitignore_document" },
        ],
      },

      // 8. 游戏开发项目
      [ProjectType.GAME]: {
        name: "游戏开发项目",
        directories: [
          "src",
          "src/scenes",
          "src/entities",
          "src/components",
          "src/systems",
          "src/utils",
          "assets",
          "assets/sprites",
          "assets/audio",
          "assets/fonts",
        ],
        files: [
          { path: "README.md", template: "readme_game" },
          { path: "package.json", template: "game_package_json" },
          { path: "src/main.js", template: "game_main" },
          { path: ".gitignore", template: "gitignore_node" },
        ],
      },

      // 9. AI/ML项目
      [ProjectType.AI]: {
        name: "AI/ML项目",
        directories: [
          "data",
          "data/raw",
          "data/processed",
          "models",
          "models/checkpoints",
          "notebooks",
          "src",
          "src/data",
          "src/models",
          "src/training",
          "src/evaluation",
          "src/utils",
          "configs",
          "logs",
        ],
        files: [
          { path: "README.md", template: "readme_ai" },
          { path: "requirements.txt", template: "ai_requirements" },
          { path: "src/train.py", template: "ai_train" },
          { path: "configs/config.yaml", template: "ai_config" },
          { path: ".gitignore", template: "gitignore_python" },
        ],
      },

      // 10. IoT项目
      [ProjectType.IOT]: {
        name: "IoT项目",
        directories: [
          "firmware",
          "firmware/src",
          "firmware/include",
          "firmware/lib",
          "hardware",
          "docs",
          "tools",
        ],
        files: [
          { path: "README.md", template: "readme_iot" },
          { path: "platformio.ini", template: "iot_platformio" },
          { path: "firmware/src/main.cpp", template: "iot_main" },
          { path: ".gitignore", template: "gitignore_iot" },
        ],
      },

      // 11. 嵌入式开发项目
      [ProjectType.EMBEDDED]: {
        name: "嵌入式开发项目",
        directories: [
          "src",
          "include",
          "lib",
          "drivers",
          "hal",
          "tests",
          "docs",
          "tools",
        ],
        files: [
          { path: "README.md", template: "readme_embedded" },
          { path: "CMakeLists.txt", template: "embedded_cmake" },
          { path: "src/main.c", template: "embedded_main" },
          { path: ".gitignore", template: "gitignore_embedded" },
        ],
      },

      // 12. 其他项目（通用）
      [ProjectType.OTHER]: {
        name: "通用项目",
        directories: ["src", "docs", "assets"],
        files: [
          { path: "README.md", template: "readme_empty" },
          { path: ".gitignore", template: "gitignore_general" },
        ],
      },

      // 保留旧的别名以保持向后兼容
      web: null, // 将在构造函数中设置
      document: null,
      data: null,
      app: null,
    };

    // 设置向后兼容的别名
    this.structures.web = this.structures[ProjectType.WEB];
    this.structures.document = this.structures[ProjectType.DOCUMENT];
    this.structures.data = this.structures[ProjectType.DATA];
    this.structures.app = this.structures[ProjectType.DESKTOP];

    // 文件模板 - 扩展的完整模板集合
    this.templates = {
      // ============================================================
      // 通用模板
      // ============================================================

      // 空白README
      readme_empty: (projectName) => `# ${projectName}

项目描述

## 开始使用

\`\`\`bash
# 在这里添加安装和使用说明
\`\`\`

## 许可证

MIT
`,

      // HTML基础模板
      html_basic: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>我的项目</title>
  <link rel="stylesheet" href="styles/style.css">
</head>
<body>
  <div id="app">
    <h1>欢迎</h1>
  </div>
  <script src="utils/script.js"></script>
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
}

#app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}`,

      // JS基础模板
      js_basic: `document.addEventListener('DOMContentLoaded', function() {
  console.log('页面加载完成');
});`,

      // Python初始化文件
      python_init: `"""
Module initialization.
"""
`,

      // ============================================================
      // README模板
      // ============================================================

      readme_web: (projectName) => `# ${projectName}

Web开发项目

## 项目结构

\`\`\`
src/
├── components/   # 组件
├── pages/        # 页面
├── styles/       # 样式
├── utils/        # 工具函数
└── assets/       # 静态资源
\`\`\`

## 本地运行

\`\`\`bash
npx http-server src -p 3000
\`\`\`

## 开发指南

1. 组件放置在 \`src/components/\` 目录
2. 页面放置在 \`src/pages/\` 目录
3. 样式放置在 \`src/styles/\` 目录
`,

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

      readme_data: (projectName) => `# ${projectName}

数据分析项目

## 项目结构

\`\`\`
data/
├── raw/          # 原始数据
└── processed/    # 处理后的数据
notebooks/        # Jupyter笔记本
src/
├── data/         # 数据加载
├── features/     # 特征工程
├── models/       # 模型定义
└── visualization/# 可视化
reports/          # 分析报告
\`\`\`

## 开始使用

\`\`\`bash
pip install -r requirements.txt
jupyter notebook notebooks/
\`\`\`
`,

      readme_desktop: (projectName) => `# ${projectName}

桌面应用项目

## 项目结构

\`\`\`
src/
├── main/         # 主进程代码
├── renderer/     # 渲染进程代码
└── common/       # 公共代码
assets/           # 资源文件
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

      readme_android: (projectName) => `# ${projectName}

Android 应用项目 (Kotlin)

## 项目结构

\`\`\`
app/
├── src/main/
│   ├── java/com/example/app/
│   │   ├── ui/           # UI组件
│   │   ├── data/         # 数据层
│   │   └── viewmodel/    # ViewModel
│   └── res/              # 资源文件
└── build.gradle.kts
\`\`\`

## 开发

1. 使用 Android Studio 打开项目
2. 同步 Gradle 依赖
3. 运行应用

## 构建

\`\`\`bash
./gradlew assembleDebug
\`\`\`
`,

      readme_ios: (projectName) => `# ${projectName}

iOS 应用项目 (SwiftUI)

## 项目结构

\`\`\`
Sources/
├── App/          # 应用入口
├── Views/        # 视图组件
├── Models/       # 数据模型
├── ViewModels/   # 视图模型
└── Services/     # 服务层
\`\`\`

## 开发

1. 使用 Xcode 打开项目
2. 选择目标设备
3. 运行应用
`,

      readme_api: (projectName) => `# ${projectName}

API 服务项目

## 项目结构

\`\`\`
src/
├── controllers/  # 控制器
├── middlewares/  # 中间件
├── models/       # 数据模型
├── routes/       # 路由定义
├── services/     # 业务逻辑
└── utils/        # 工具函数
\`\`\`

## 开发

\`\`\`bash
npm install
npm run dev
\`\`\`

## API文档

访问 \`http://localhost:3000/api-docs\` 查看API文档。
`,

      readme_game: (projectName) => `# ${projectName}

游戏开发项目

## 项目结构

\`\`\`
src/
├── scenes/       # 游戏场景
├── entities/     # 游戏实体
├── components/   # 组件系统
├── systems/      # 系统逻辑
└── utils/        # 工具函数
assets/
├── sprites/      # 精灵图
├── audio/        # 音频文件
└── fonts/        # 字体文件
\`\`\`

## 开发

\`\`\`bash
npm install
npm run dev
\`\`\`
`,

      readme_ai: (projectName) => `# ${projectName}

AI/ML 项目

## 项目结构

\`\`\`
data/
├── raw/          # 原始数据
└── processed/    # 处理后的数据
models/           # 模型文件
notebooks/        # 实验笔记本
src/
├── data/         # 数据处理
├── models/       # 模型定义
├── training/     # 训练脚本
└── evaluation/   # 评估脚本
configs/          # 配置文件
\`\`\`

## 开始使用

\`\`\`bash
pip install -r requirements.txt
python src/train.py --config configs/config.yaml
\`\`\`
`,

      readme_iot: (projectName) => `# ${projectName}

IoT 项目

## 项目结构

\`\`\`
firmware/
├── src/          # 固件源码
├── include/      # 头文件
└── lib/          # 库文件
hardware/         # 硬件设计
docs/             # 文档
\`\`\`

## 开发

\`\`\`bash
pio run
pio run -t upload
\`\`\`
`,

      readme_embedded: (projectName) => `# ${projectName}

嵌入式开发项目

## 项目结构

\`\`\`
src/              # 源代码
include/          # 头文件
lib/              # 库文件
drivers/          # 驱动程序
hal/              # 硬件抽象层
\`\`\`

## 构建

\`\`\`bash
mkdir build && cd build
cmake ..
make
\`\`\`
`,

      // ============================================================
      // .gitignore 模板
      // ============================================================

      gitignore_web: `# 依赖
node_modules/

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

      gitignore_python: `# Byte-compiled
__pycache__/
*.py[cod]
*$py.class

# Virtual environments
venv/
env/
.venv/

# Distribution
dist/
build/
*.egg-info/

# Jupyter
.ipynb_checkpoints/

# IDE
.idea/
.vscode/

# Data
*.csv
*.xlsx
*.parquet

# Models
*.h5
*.pkl
*.pt
*.pth

# OS
.DS_Store
Thumbs.db`,

      gitignore_node: `# Dependencies
node_modules/

# Build output
dist/
build/
out/

# Logs
logs/
*.log
npm-debug.log*

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# Test coverage
coverage/
.nyc_output/`,

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

      gitignore_android: `# Gradle
.gradle/
build/
!gradle/wrapper/gradle-wrapper.jar

# Android Studio
*.iml
.idea/
local.properties

# APK
*.apk
*.aab

# OS
.DS_Store
Thumbs.db`,

      gitignore_ios: `# Xcode
*.xcodeproj/*
!*.xcodeproj/project.pbxproj
*.xcworkspace/*
!*.xcworkspace/contents.xcworkspacedata
xcuserdata/

# Build
build/
DerivedData/

# Dependencies
Pods/
Carthage/

# OS
.DS_Store`,

      gitignore_kotlin: `# Gradle
.gradle/
build/

# IDE
.idea/
*.iml

# Kotlin
*.class

# OS
.DS_Store
Thumbs.db`,

      gitignore_gradle: `# Gradle
.gradle/
build/
!gradle/wrapper/gradle-wrapper.jar

# IDE
.idea/
*.iml

# OS
.DS_Store
Thumbs.db`,

      gitignore_flutter: `# Dart
.dart_tool/
.packages
build/
*.dart.js
*.js.deps
*.js.map

# Flutter
.flutter-plugins
.flutter-plugins-dependencies

# IDE
.idea/
*.iml
.vscode/

# OS
.DS_Store
Thumbs.db`,

      gitignore_iot: `# PlatformIO
.pio/
.pioenvs/
.piolibdeps/

# Build
build/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db`,

      gitignore_embedded: `# Build
build/
*.o
*.elf
*.bin
*.hex

# IDE
.vscode/
.idea/

# CMake
CMakeCache.txt
CMakeFiles/
cmake_install.cmake

# OS
.DS_Store
Thumbs.db`,

      gitignore_general: `# 构建输出
dist/
build/
out/

# 日志
*.log

# 操作系统
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp`,

      // ============================================================
      // Node.js 模板
      // ============================================================

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

      nodejs_package_json: (projectName) =>
        JSON.stringify(
          {
            name: projectName.toLowerCase().replace(/\s+/g, "-"),
            version: "1.0.0",
            description: "Node.js API服务",
            main: "dist/index.js",
            scripts: {
              dev: "ts-node-dev --respawn src/index.ts",
              build: "tsc",
              start: "node dist/index.js",
              test: "jest",
            },
            dependencies: {
              express: "^4.18.2",
              cors: "^2.8.5",
              dotenv: "^16.3.1",
            },
            devDependencies: {
              "@types/express": "^4.17.21",
              "@types/node": "^20.10.0",
              typescript: "^5.3.2",
              "ts-node-dev": "^2.0.0",
            },
            keywords: ["api", "nodejs", "express"],
            author: "",
            license: "MIT",
          },
          null,
          2,
        ),

      nodejs_tsconfig: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "commonjs",
            lib: ["ES2020"],
            outDir: "./dist",
            rootDir: "./src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            declaration: true,
          },
          include: ["src/**/*"],
          exclude: ["node_modules", "dist"],
        },
        null,
        2,
      ),

      nodejs_index: `import app from './app';
import { config } from './config';

const PORT = config.port || 3000;

app.listen(PORT, () => {
  console.log(\`Server is running on port \${PORT}\`);
});
`,

      nodejs_app: `import express from 'express';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler';
import { loggerMiddleware } from './middlewares/logger';
import routes from './routes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(loggerMiddleware);

// Routes
app.use('/api', routes);

// Error handling
app.use(errorHandler);

export default app;
`,

      nodejs_config: `import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  dbUrl: process.env.DATABASE_URL,
};
`,

      nodejs_routes: `import { Router } from 'express';
import apiRoutes from './api';

const router = Router();

router.use('/', apiRoutes);

export default router;
`,

      nodejs_api_routes: `import { Router } from 'express';
import { healthCheck } from '../controllers/healthController';

const router = Router();

router.get('/health', healthCheck);

export default router;
`,

      nodejs_health_controller: `import { Request, Response } from 'express';

export const healthCheck = (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};
`,

      nodejs_error_handler: `import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};
`,

      nodejs_logger_middleware: `import { Request, Response, NextFunction } from 'express';

export const loggerMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.path}\`);
  next();
};
`,

      nodejs_env_example: `PORT=3000
NODE_ENV=development
DATABASE_URL=
`,

      // ============================================================
      // Python 数据科学模板
      // ============================================================

      python_ds_requirements: `# Data Science
numpy>=1.24.0
pandas>=2.0.0
scipy>=1.10.0

# Visualization
matplotlib>=3.7.0
seaborn>=0.12.0
plotly>=5.14.0

# Jupyter
jupyter>=1.0.0
jupyterlab>=4.0.0

# Machine Learning
scikit-learn>=1.3.0

# Utilities
python-dotenv>=1.0.0
tqdm>=4.65.0
`,

      python_ds_notebook: JSON.stringify(
        {
          cells: [
            {
              cell_type: "markdown",
              metadata: {},
              source: ["# 数据探索\n", "\n", "初始数据探索与分析"],
            },
            {
              cell_type: "code",
              execution_count: null,
              metadata: {},
              outputs: [],
              source: [
                "import numpy as np\n",
                "import pandas as pd\n",
                "import matplotlib.pyplot as plt\n",
                "import seaborn as sns\n",
                "\n",
                "# 设置样式\n",
                "plt.style.use('seaborn-v0_8-whitegrid')\n",
                "%matplotlib inline",
              ],
            },
            {
              cell_type: "markdown",
              metadata: {},
              source: ["## 数据加载"],
            },
            {
              cell_type: "code",
              execution_count: null,
              metadata: {},
              outputs: [],
              source: ["# df = pd.read_csv('../data/raw/data.csv')"],
            },
          ],
          metadata: {
            kernelspec: {
              display_name: "Python 3",
              language: "python",
              name: "python3",
            },
          },
          nbformat: 4,
          nbformat_minor: 4,
        },
        null,
        2,
      ),

      python_ds_setup: `from setuptools import setup, find_packages

setup(
    name="data-science-project",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "numpy",
        "pandas",
        "scikit-learn",
    ],
)
`,

      python_ds_pyproject: `[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "data-science-project"
version = "0.1.0"
description = "Data science project"
readme = "README.md"
requires-python = ">=3.9"
`,

      python_ds_load_data: `"""
Data loading utilities.
"""
import pandas as pd
from pathlib import Path


def load_raw_data(filename: str) -> pd.DataFrame:
    """Load raw data from the data/raw directory."""
    data_dir = Path(__file__).parents[2] / "data" / "raw"
    return pd.read_csv(data_dir / filename)


def save_processed_data(df: pd.DataFrame, filename: str) -> None:
    """Save processed data to the data/processed directory."""
    data_dir = Path(__file__).parents[2] / "data" / "processed"
    data_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(data_dir / filename, index=False)
`,

      python_ds_build_features: `"""
Feature engineering utilities.
"""
import pandas as pd


def create_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create features from raw data."""
    # Add feature engineering logic here
    return df
`,

      python_ds_train_model: `"""
Model training utilities.
"""
from sklearn.model_selection import train_test_split


def train_model(X, y, test_size=0.2, random_state=42):
    """Train a model on the given data."""
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state
    )
    # Add model training logic here
    return None
`,

      python_ds_visualize: `"""
Visualization utilities.
"""
import matplotlib.pyplot as plt
import seaborn as sns


def plot_distribution(data, column, title=None):
    """Plot the distribution of a column."""
    fig, ax = plt.subplots(figsize=(10, 6))
    sns.histplot(data[column], ax=ax)
    ax.set_title(title or f"Distribution of {column}")
    return fig
`,

      // ============================================================
      // AI/ML 模板
      // ============================================================

      ai_requirements: `# Deep Learning
torch>=2.0.0
torchvision>=0.15.0
transformers>=4.30.0

# Data Processing
numpy>=1.24.0
pandas>=2.0.0

# Experiment Tracking
wandb>=0.15.0
tensorboard>=2.13.0

# Utilities
pyyaml>=6.0
tqdm>=4.65.0
python-dotenv>=1.0.0
`,

      ai_train: `"""
Training script for ML models.
"""
import argparse
import yaml
from pathlib import Path


def load_config(config_path: str) -> dict:
    """Load configuration from YAML file."""
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def train(config: dict) -> None:
    """Train the model with given configuration."""
    print(f"Training with config: {config}")
    # Add training logic here


def main():
    parser = argparse.ArgumentParser(description='Train ML model')
    parser.add_argument('--config', type=str, default='configs/config.yaml',
                        help='Path to configuration file')
    args = parser.parse_args()

    config = load_config(args.config)
    train(config)


if __name__ == '__main__':
    main()
`,

      ai_config: `# Model Configuration
model:
  name: "model_v1"
  hidden_size: 256
  num_layers: 4

# Training Configuration
training:
  batch_size: 32
  learning_rate: 0.001
  epochs: 100
  early_stopping: true
  patience: 10

# Data Configuration
data:
  train_path: "data/processed/train.csv"
  val_path: "data/processed/val.csv"
  test_path: "data/processed/test.csv"

# Logging
logging:
  log_dir: "logs"
  save_every: 10
`,

      // ============================================================
      // IoT 模板
      // ============================================================

      iot_platformio: `[env:esp32]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
`,

      iot_main: `#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    Serial.println("IoT Device Starting...");

    // Initialize your hardware here
}

void loop() {
    // Main loop logic here
    delay(1000);
}
`,

      // ============================================================
      // 嵌入式 模板
      // ============================================================

      embedded_cmake: `cmake_minimum_required(VERSION 3.16)
project(embedded_project C)

set(CMAKE_C_STANDARD 11)

include_directories(include)

file(GLOB SOURCES "src/*.c")
add_executable(\${PROJECT_NAME} \${SOURCES})
`,

      embedded_main: `#include <stdio.h>

int main(void) {
    printf("Embedded System Starting...\\n");

    // Initialize hardware

    while (1) {
        // Main loop
    }

    return 0;
}
`,

      // ============================================================
      // 游戏开发 模板
      // ============================================================

      game_package_json: (projectName) =>
        JSON.stringify(
          {
            name: projectName.toLowerCase().replace(/\s+/g, "-"),
            version: "1.0.0",
            description: "游戏项目",
            main: "src/main.js",
            scripts: {
              dev: "vite",
              build: "vite build",
            },
            dependencies: {},
            devDependencies: {
              vite: "^5.0.0",
            },
            keywords: ["game"],
            author: "",
            license: "MIT",
          },
          null,
          2,
        ),

      game_main: `// Game entry point
class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.lastTime = 0;
  }

  init() {
    console.log('Game initialized');
    this.gameLoop(0);
  }

  update(deltaTime) {
    // Update game logic
  }

  render() {
    // Render game
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  gameLoop(currentTime) {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    this.update(deltaTime);
    this.render();

    requestAnimationFrame((t) => this.gameLoop(t));
  }
}

const game = new Game();
game.init();
`,

      // ============================================================
      // iOS 模板
      // ============================================================

      ios_package_swift: `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MyApp",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .executable(name: "MyApp", targets: ["App"])
    ],
    targets: [
        .executableTarget(
            name: "App",
            dependencies: [],
            path: "Sources/App"
        )
    ]
)
`,

      ios_app: `import SwiftUI

@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`,

      ios_content_view: `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, world!")
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
`,

      // ============================================================
      // Android 模板
      // ============================================================

      android_build_gradle_root: `// Top-level build file
plugins {
    id("com.android.application") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.20" apply false
}
`,

      android_settings_gradle: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "MyApp"
include(":app")
`,

      android_gradle_properties: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`,

      android_build_gradle_app: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
}
`,

      android_manifest: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.MyApp">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,

      android_main_activity: `package com.example.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }
}
`,

      android_main_fragment: `package com.example.app.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.example.app.R

class MainFragment : Fragment() {
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_main, container, false)
    }
}
`,

      android_main_viewmodel: `package com.example.app.viewmodel

import androidx.lifecycle.ViewModel

class MainViewModel : ViewModel() {
    // ViewModel logic here
}
`,

      android_layout_activity: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Hello World!"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

</androidx.constraintlayout.widget.ConstraintLayout>
`,

      android_layout_fragment: `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp">

</LinearLayout>
`,

      android_strings: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">My App</string>
</resources>
`,

      android_colors: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="purple_200">#FFBB86FC</color>
    <color name="purple_500">#FF6200EE</color>
    <color name="purple_700">#FF3700B3</color>
    <color name="teal_200">#FF03DAC5</color>
    <color name="teal_700">#FF018786</color>
    <color name="black">#FF000000</color>
    <color name="white">#FFFFFFFF</color>
</resources>
`,

      android_themes: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.MyApp" parent="Theme.MaterialComponents.DayNight.DarkActionBar">
        <item name="colorPrimary">@color/purple_500</item>
        <item name="colorPrimaryVariant">@color/purple_700</item>
        <item name="colorOnPrimary">@color/white</item>
    </style>
</resources>
`,
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

  // ============================================================
  // 新增模板相关方法（与Android对齐）
  // ============================================================

  /**
   * 根据模板ID获取模板
   * @param {string} templateId - 模板ID
   * @returns {Object|null} 模板对象
   */
  getTemplateById(templateId) {
    return getTemplateById(templateId);
  }

  /**
   * 根据分类获取模板
   * @param {string} category - 分类
   * @returns {Array} 模板列表
   */
  getTemplatesByCategory(category) {
    return getTemplatesByCategory(category);
  }

  /**
   * 根据项目类型获取模板
   * @param {string} projectType - 项目类型
   * @returns {Array} 模板列表
   */
  getTemplatesByProjectType(projectType) {
    return getTemplatesByProjectType(projectType);
  }

  /**
   * 从模板创建项目结构
   * @param {string} projectPath - 项目路径
   * @param {string} templateId - 模板ID
   * @param {string} projectName - 项目名称
   * @returns {Promise<Object>} 创建结果
   */
  async createFromTemplate(projectPath, templateId, projectName = "My Project") {
    const template = getTemplateById(templateId);

    if (!template) {
      throw new Error(`模板不存在: ${templateId}`);
    }

    logger.info(
      `[Project Structure] 从模板创建项目: ${template.name}, 路径: ${projectPath}`
    );

    try {
      // 确保项目根目录存在
      await fs.mkdir(projectPath, { recursive: true });

      // 创建目录结构
      for (const dir of template.directories || []) {
        const dirPath = path.join(projectPath, dir);
        await fs.mkdir(dirPath, { recursive: true });
        logger.info(`[Project Structure] 创建目录: ${dir}`);
      }

      // 创建文件
      const createdFiles = [];

      for (const fileConfig of template.files || []) {
        const filePath = path.join(projectPath, fileConfig.path);
        const templateName = fileConfig.template;

        // 确保文件所在目录存在
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        let content = "";

        if (fileConfig.content) {
          // 如果模板定义中直接包含内容
          content = fileConfig.content;
        } else if (templateName && this.templates[templateName]) {
          // 从templates中获取内容
          if (typeof this.templates[templateName] === "function") {
            content = this.templates[templateName](projectName);
          } else if (typeof this.templates[templateName] === "string") {
            content = this.templates[templateName];
          }
        }

        await fs.writeFile(filePath, content, "utf-8");
        createdFiles.push(fileConfig.path);
        logger.info(`[Project Structure] 创建文件: ${fileConfig.path}`);
      }

      logger.info(`[Project Structure] 模板项目创建成功`);

      return {
        success: true,
        projectPath,
        templateId,
        templateName: template.name,
        projectType: template.projectType,
        directories: template.directories || [],
        files: createdFiles,
      };
    } catch (error) {
      logger.error("[Project Structure] 从模板创建失败:", error);
      throw new Error(`从模板创建项目失败: ${error.message}`);
    }
  }

  /**
   * 获取项目类型信息
   * @param {string} projectType - 项目类型
   * @returns {Object|null} 项目类型信息
   */
  getProjectTypeInfo(projectType) {
    return ProjectTypeInfo[projectType] || null;
  }

  /**
   * 获取所有项目类型信息
   * @returns {Array} 项目类型信息列表
   */
  getAllProjectTypeInfo() {
    return Object.keys(ProjectType).map((key) => ({
      type: ProjectType[key],
      ...ProjectTypeInfo[ProjectType[key]],
    }));
  }
}

module.exports = ProjectStructureManager;
