/**
 * 项目初始化工具的handler实现
 * 提供NPM、Python、Docker等项目初始化功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class ProjectToolsHandler {
  constructor() {
    this.name = 'ProjectToolsHandler';
  }

  /**
   * NPM项目初始化
   */
  async tool_npm_project_setup(params) {
    const { projectName, projectPath, template = 'basic', packageManager = 'npm', initGit = true, installDeps = false } = params;

    try {
      // 创建项目目录
      await fs.mkdir(projectPath, { recursive: true });

      const filesCreated = [];

      // 创建package.json
      const packageJson = {
        name: projectName,
        version: '1.0.0',
        description: '',
        main: 'index.js',
        scripts: {},
        keywords: [],
        author: '',
        license: 'MIT'
      };

      // 根据模板类型添加特定配置
      switch (template) {
        case 'express':
          packageJson.scripts = {
            start: 'node server.js',
            dev: 'nodemon server.js'
          };
          packageJson.dependencies = {
            express: '^4.18.0'
          };
          packageJson.devDependencies = {
            nodemon: '^3.0.0'
          };

          // 创建基础Express服务器
          {
            const serverJs = `const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello from ${projectName}!' });
});

app.listen(PORT, () => {
  logger.info(\`Server running on port \${PORT}\`);
});
`;
            await fs.writeFile(path.join(projectPath, 'server.js'), serverJs, 'utf-8');
            filesCreated.push('server.js');
          }
          break;

        case 'koa':
          packageJson.scripts = {
            start: 'node app.js',
            dev: 'nodemon app.js'
          };
          packageJson.dependencies = {
            koa: '^2.14.0',
            '@koa/router': '^12.0.0'
          };
          break;

        case 'cli':
          packageJson.bin = {
            [projectName]: './bin/cli.js'
          };
          packageJson.dependencies = {
            commander: '^11.0.0'
          };
          break;

        default: // basic
          packageJson.scripts = {
            start: 'node index.js',
            test: 'echo "Error: no test specified" && exit 1'
          };

          // 创建基础index.js
          {
            const indexJs = `logger.info('Hello from ${projectName}!');
`;
            await fs.writeFile(path.join(projectPath, 'index.js'), indexJs, 'utf-8');
            filesCreated.push('index.js');
          }
      }

      // 写入package.json
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify(packageJson, null, 2),
        'utf-8'
      );
      filesCreated.push('package.json');

      // 创建README.md
      const readme = `# ${projectName}

## 安装

\`\`\`bash
${packageManager} install
\`\`\`

## 运行

\`\`\`bash
${packageManager} start
\`\`\`
`;
      await fs.writeFile(path.join(projectPath, 'README.md'), readme, 'utf-8');
      filesCreated.push('README.md');

      // 创建.gitignore
      const gitignore = `node_modules/
.env
*.log
.DS_Store
`;
      await fs.writeFile(path.join(projectPath, '.gitignore'), gitignore, 'utf-8');
      filesCreated.push('.gitignore');

      // 初始化Git仓库
      if (initGit) {
        try {
          await execPromise('git init', { cwd: projectPath });
          filesCreated.push('.git');
        } catch (error) {
          logger.warn('[NPM Setup] Git初始化失败:', error.message);
        }
      }

      // 安装依赖
      if (installDeps && packageJson.dependencies) {
        try {
          logger.info(`[NPM Setup] 正在安装依赖...`);
          await execPromise(`${packageManager} install`, { cwd: projectPath });
        } catch (error) {
          logger.warn('[NPM Setup] 依赖安装失败:', error.message);
        }
      }

      return {
        success: true,
        projectPath: projectPath,
        filesCreated: filesCreated
      };
    } catch (error) {
      logger.error('[NPM Project Setup] 初始化失败:', error);
      throw new Error(`NPM项目初始化失败: ${error.message}`);
    }
  }

  /**
   * package.json构建器
   */
  async tool_package_json_builder(params) {
    const { projectPath, config } = params;

    try {
      const packageJsonPath = path.join(projectPath, 'package.json');

      // 写入package.json
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      );

      return {
        success: true,
        filePath: packageJsonPath
      };
    } catch (error) {
      logger.error('[Package.json Builder] 构建失败:', error);
      throw new Error(`package.json构建失败: ${error.message}`);
    }
  }

  /**
   * Python项目初始化
   */
  async tool_python_project_setup(params) {
    const { projectName, projectPath, projectType = 'package', pythonVersion = '3.9', useVirtualEnv = true, initGit = true } = params;

    try {
      // 创建项目目录
      await fs.mkdir(projectPath, { recursive: true });

      const filesCreated = [];

      // 根据项目类型创建不同的结构
      switch (projectType) {
        case 'flask': {
          await fs.mkdir(path.join(projectPath, 'app'), { recursive: true });

          const appPy = `from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello():
    return {'message': 'Hello from ${projectName}!'}

if __name__ == '__main__':
    app.run(debug=True)
`;
          await fs.writeFile(path.join(projectPath, 'app.py'), appPy, 'utf-8');
          filesCreated.push('app.py');
          break;
        }

        case 'ml':
          await fs.mkdir(path.join(projectPath, 'data', 'raw'), { recursive: true });
          await fs.mkdir(path.join(projectPath, 'data', 'processed'), { recursive: true });
          await fs.mkdir(path.join(projectPath, 'notebooks'), { recursive: true });
          await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
          await fs.mkdir(path.join(projectPath, 'models'), { recursive: true });
          filesCreated.push('data/', 'notebooks/', 'src/', 'models/');
          break;

        default: // package or script
          await fs.mkdir(path.join(projectPath, projectName), { recursive: true });

          {
            const initPy = `"""${projectName} package."""
__version__ = '0.1.0'
`;
            await fs.writeFile(path.join(projectPath, projectName, '__init__.py'), initPy, 'utf-8');
            filesCreated.push(`${projectName}/__init__.py`);
          }
      }

      // 创建requirements.txt
      let requirements = '';
      switch (projectType) {
        case 'flask':
          requirements = 'Flask>=2.3.0\nflask-cors>=4.0.0\n';
          break;
        case 'django':
          requirements = 'Django>=4.2.0\n';
          break;
        case 'ml':
          requirements = 'numpy>=1.24.0\npandas>=2.0.0\nscikit-learn>=1.3.0\nmatplotlib>=3.7.0\n';
          break;
      }

      await fs.writeFile(path.join(projectPath, 'requirements.txt'), requirements, 'utf-8');
      filesCreated.push('requirements.txt');

      // 创建README.md
      const readme = `# ${projectName}

Python项目（${projectType}）

## 安装

\`\`\`bash
pip install -r requirements.txt
\`\`\`

## 使用

\`\`\`bash
${projectType === 'flask' ? 'python app.py' : 'python main.py'}
\`\`\`
`;
      await fs.writeFile(path.join(projectPath, 'README.md'), readme, 'utf-8');
      filesCreated.push('README.md');

      // 创建.gitignore
      const gitignore = `__pycache__/
*.py[cod]
*$py.class
*.so
.Python
venv/
env/
.venv
*.egg-info/
dist/
build/
.pytest_cache/
.coverage
*.log
.DS_Store
`;
      await fs.writeFile(path.join(projectPath, '.gitignore'), gitignore, 'utf-8');
      filesCreated.push('.gitignore');

      // 创建虚拟环境
      let venvPath = null;
      if (useVirtualEnv) {
        try {
          venvPath = path.join(projectPath, 'venv');
          await execPromise(`python -m venv venv`, { cwd: projectPath });
          filesCreated.push('venv/');
        } catch (error) {
          logger.warn('[Python Setup] 虚拟环境创建失败:', error.message);
        }
      }

      // 初始化Git
      if (initGit) {
        try {
          await execPromise('git init', { cwd: projectPath });
          filesCreated.push('.git');
        } catch (error) {
          logger.warn('[Python Setup] Git初始化失败:', error.message);
        }
      }

      return {
        success: true,
        projectPath: projectPath,
        filesCreated: filesCreated,
        venvPath: venvPath
      };
    } catch (error) {
      logger.error('[Python Project Setup] 初始化失败:', error);
      throw new Error(`Python项目初始化失败: ${error.message}`);
    }
  }

  /**
   * requirements.txt生成器
   */
  async tool_requirements_generator(params) {
    const { projectPath, packages, autoDetect = false, outputPath } = params;

    try {
      let content = '';

      if (autoDetect) {
        // 自动检测环境中的包
        try {
          const { stdout } = await execPromise('pip freeze');
          content = stdout;
        } catch (error) {
          logger.warn('[Requirements Generator] 自动检测失败，使用手动指定的包');
        }
      }

      if (!content && packages) {
        // 手动指定的包
        content = packages.map(pkg => {
          let line = pkg.name;
          if (pkg.version) {
            line += `==${pkg.version}`;
          }
          if (pkg.extras && pkg.extras.length > 0) {
            line += `[${pkg.extras.join(',')}]`;
          }
          return line;
        }).join('\n');
      }

      const filePath = outputPath || path.join(projectPath, 'requirements.txt');
      await fs.writeFile(filePath, content, 'utf-8');

      return {
        success: true,
        filePath: filePath,
        packageCount: content.split('\n').filter(l => l.trim()).length
      };
    } catch (error) {
      logger.error('[Requirements Generator] 生成失败:', error);
      throw new Error(`requirements.txt生成失败: ${error.message}`);
    }
  }

  /**
   * Dockerfile生成器
   */
  async tool_dockerfile_generator(params) {
    const { projectPath, baseImage = 'node:18-alpine', appType, workdir = '/app', port, entrypoint, buildSteps = [] } = params;

    try {
      let dockerfile = `FROM ${baseImage}\n\n`;

      dockerfile += `WORKDIR ${workdir}\n\n`;

      // 根据应用类型添加特定步骤
      switch (appType) {
        case 'nodejs':
          dockerfile += `# 复制package文件\n`;
          dockerfile += `COPY package*.json ./\n\n`;
          dockerfile += `# 安装依赖\n`;
          dockerfile += `RUN npm install --production\n\n`;
          dockerfile += `# 复制应用代码\n`;
          dockerfile += `COPY . .\n\n`;
          if (port) {
            dockerfile += `EXPOSE ${port}\n\n`;
          }
          dockerfile += `CMD ["${entrypoint || 'node index.js'}"]\n`;
          break;

        case 'python':
          dockerfile += `# 复制requirements.txt\n`;
          dockerfile += `COPY requirements.txt .\n\n`;
          dockerfile += `# 安装依赖\n`;
          dockerfile += `RUN pip install --no-cache-dir -r requirements.txt\n\n`;
          dockerfile += `# 复制应用代码\n`;
          dockerfile += `COPY . .\n\n`;
          if (port) {
            dockerfile += `EXPOSE ${port}\n\n`;
          }
          dockerfile += `CMD ["${entrypoint || 'python app.py'}"]\n`;
          break;

        default:
          // 自定义构建步骤
          if (buildSteps.length > 0) {
            dockerfile += buildSteps.join('\n') + '\n';
          }
      }

      const filePath = path.join(projectPath, 'Dockerfile');
      await fs.writeFile(filePath, dockerfile, 'utf-8');

      return {
        success: true,
        filePath: filePath
      };
    } catch (error) {
      logger.error('[Dockerfile Generator] 生成失败:', error);
      throw new Error(`Dockerfile生成失败: ${error.message}`);
    }
  }

  /**
   * .gitignore生成器
   */
  async tool_gitignore_generator(params) {
    const { projectPath, templates, customPatterns = [] } = params;

    try {
      const patterns = new Set();

      // 加载各模板的忽略模式
      for (const template of templates) {
        const templatePatterns = this.getGitignoreTemplate(template);
        templatePatterns.forEach(p => patterns.add(p));
      }

      // 添加自定义模式
      customPatterns.forEach(p => patterns.add(p));

      const content = Array.from(patterns).join('\n') + '\n';

      const filePath = path.join(projectPath, '.gitignore');
      await fs.writeFile(filePath, content, 'utf-8');

      return {
        success: true,
        filePath: filePath,
        patterns: patterns.size
      };
    } catch (error) {
      logger.error('[Gitignore Generator] 生成失败:', error);
      throw new Error(`.gitignore生成失败: ${error.message}`);
    }
  }

  /**
   * 获取gitignore模板
   */
  getGitignoreTemplate(template) {
    const templates = {
      'Node': [
        '# Node',
        'node_modules/',
        'npm-debug.log*',
        'yarn-debug.log*',
        'yarn-error.log*',
        '.npm',
        '.pnpm-debug.log',
        'dist/',
        'build/',
      ],
      'Python': [
        '# Python',
        '__pycache__/',
        '*.py[cod]',
        '*$py.class',
        '*.so',
        '.Python',
        'venv/',
        'env/',
        '.venv',
        '*.egg-info/',
      ],
      'Java': [
        '# Java',
        '*.class',
        '*.jar',
        '*.war',
        'target/',
        '.gradle/',
        'build/',
      ],
      'VisualStudioCode': [
        '# VSCode',
        '.vscode/',
        '*.code-workspace',
      ],
      'JetBrains': [
        '# JetBrains',
        '.idea/',
        '*.iml',
      ],
      'macOS': [
        '# macOS',
        '.DS_Store',
        '.AppleDouble',
        '.LSOverride',
      ],
      'Windows': [
        '# Windows',
        'Thumbs.db',
        'ehthumbs.db',
        'Desktop.ini',
      ],
    };

    return templates[template] || [];
  }

  /**
   * 注册所有工具到FunctionCaller
   */
  register(functionCaller) {
    functionCaller.registerTool('tool_npm_project_setup', this.tool_npm_project_setup.bind(this));
    functionCaller.registerTool('tool_package_json_builder', this.tool_package_json_builder.bind(this));
    functionCaller.registerTool('tool_python_project_setup', this.tool_python_project_setup.bind(this));
    functionCaller.registerTool('tool_requirements_generator', this.tool_requirements_generator.bind(this));
    functionCaller.registerTool('tool_dockerfile_generator', this.tool_dockerfile_generator.bind(this));
    functionCaller.registerTool('tool_gitignore_generator', this.tool_gitignore_generator.bind(this));

    logger.info('[ProjectToolsHandler] 项目初始化工具已注册（6个）');
  }
}

module.exports = ProjectToolsHandler;
