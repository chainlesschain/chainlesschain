/**
 * Function Calling框架
 * 负责工具的注册、调用和管理
 */

const fs = require('fs').promises;
const path = require('path');
const ExtendedTools = require('./extended-tools');
const ExtendedTools2 = require('./extended-tools-2');
const ExtendedTools3 = require('./extended-tools-3');
const ExtendedTools4 = require('./extended-tools-4');
const ExtendedTools5 = require('./extended-tools-5');
const ExtendedTools6 = require('./extended-tools-6');
const ExtendedTools7 = require('./extended-tools-7');
const ExtendedTools8 = require('./extended-tools-8');
const ExtendedTools9 = require('./extended-tools-9');
const ExtendedTools10 = require('./extended-tools-10');
const ExtendedTools11 = require('./extended-tools-11');

class FunctionCaller {
  constructor() {
    // 注册的工具字典
    this.tools = new Map();

    // ToolManager引用（用于统计）
    this.toolManager = null;

    // 注册内置工具
    this.registerBuiltInTools();
  }

  /**
   * 设置ToolManager（用于统计功能）
   * @param {ToolManager} toolManager - 工具管理器
   */
  setToolManager(toolManager) {
    this.toolManager = toolManager;
    console.log('[Function Caller] ToolManager已设置');
  }

  /**
   * 注册内置工具
   * @private
   */
  registerBuiltInTools() {
    // 文件读取工具
    this.registerTool(
      'file_reader',
      async (params, context) => {
        const filePath = params.filePath || context.currentFile?.file_path;

        if (!filePath) {
          throw new Error('未指定文件路径');
        }

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          return {
            success: true,
            filePath,
            content,
          };
        } catch (error) {
          throw new Error(`读取文件失败: ${error.message}`);
        }
      },
      {
        name: 'file_reader',
        description: '读取文件内容',
        parameters: {
          filePath: { type: 'string', description: '文件路径' },
        },
      }
    );

    // 文件写入工具
    this.registerTool(
      'file_writer',
      async (params, context) => {
        const filePath = params.filePath || context.currentFile?.file_path;
        const content = params.content;

        if (!filePath) {
          throw new Error('未指定文件路径');
        }

        if (content === undefined) {
          throw new Error('未指定文件内容');
        }

        try {
          // 确保目录存在
          const dir = path.dirname(filePath);
          await fs.mkdir(dir, { recursive: true });

          // 写入文件
          await fs.writeFile(filePath, content, 'utf-8');

          return {
            success: true,
            filePath,
            size: content.length,
          };
        } catch (error) {
          throw new Error(`写入文件失败: ${error.message}`);
        }
      },
      {
        name: 'file_writer',
        description: '写入文件内容',
        parameters: {
          filePath: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' },
        },
      }
    );

    // HTML生成工具
    this.registerTool(
      'html_generator',
      async (params, context) => {
        const title = params.title || '我的网页';
        const content = params.content || '';
        const primaryColor = params.primaryColor || '#667eea';

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <h1>${title}</h1>
  </header>

  <main>
    <section class="content">
      <p>${content}</p>
    </section>
  </main>

  <footer>
    <p>&copy; 2024 ${title}. All rights reserved.</p>
  </footer>

  <script src="js/script.js"></script>
</body>
</html>`;

        return {
          success: true,
          html,
          fileName: 'index.html',
        };
      },
      {
        name: 'html_generator',
        description: '生成HTML文件',
        parameters: {
          title: { type: 'string', description: '页面标题' },
          content: { type: 'string', description: '页面内容' },
          primaryColor: { type: 'string', description: '主题颜色' },
        },
      }
    );

    // CSS生成工具
    this.registerTool(
      'css_generator',
      async (params, context) => {
        const colors = params.colors || ['#667eea', '#764ba2'];

        const css = `/* 重置样式 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  color: #333;
  background: linear-gradient(135deg, ${colors[0]}, ${colors[1] || colors[0]});
  min-height: 100vh;
}

header {
  background: rgba(255, 255, 255, 0.95);
  padding: 2rem;
  text-align: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

header h1 {
  color: ${colors[0]};
  font-size: 2.5rem;
}

main {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.content {
  background: white;
  padding: 2rem;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

footer {
  background: rgba(0, 0, 0, 0.8);
  color: white;
  text-align: center;
  padding: 1.5rem;
  margin-top: 2rem;
}`;

        return {
          success: true,
          css,
          fileName: 'css/style.css',
        };
      },
      {
        name: 'css_generator',
        description: '生成CSS样式',
        parameters: {
          colors: { type: 'array', description: '主题颜色数组' },
        },
      }
    );

    // JavaScript生成工具
    this.registerTool(
      'js_generator',
      async (params, context) => {
        const features = params.features || [];

        const js = `// 页面初始化
document.addEventListener('DOMContentLoaded', function() {
  console.log('页面加载完成');

  // 添加交互功能
  initializeInteractions();
});

function initializeInteractions() {
  // 这里可以添加更多交互功能
}`;

        return {
          success: true,
          js,
          fileName: 'js/script.js',
        };
      },
      {
        name: 'js_generator',
        description: '生成JavaScript代码',
        parameters: {
          features: { type: 'array', description: '功能列表' },
        },
      }
    );

    // 文件编辑工具
    this.registerTool(
      'file_editor',
      async (params, context) => {
        const filePath = params.filePath;
        const modifications = params.modifications || [];

        if (!filePath) {
          throw new Error('未指定文件路径');
        }

        try {
          // 读取文件内容
          let content = await fs.readFile(filePath, 'utf-8');

          // 应用修改（简单的字符串替换）
          for (const mod of modifications) {
            if (mod.type === 'general') {
              // 通用修改，这里需要更智能的实现
              console.log(`[File Editor] 应用修改: ${mod.description}`);
            } else if (mod.target && mod.action) {
              // 结构化修改
              if (mod.action === '改' || mod.action === '修改' || mod.action === '改成') {
                // 例如：把标题改成蓝色
                if (mod.target === '标题' && mod.value) {
                  content = content.replace(
                    /<h1>(.*?)<\/h1>/g,
                    `<h1 style="color: ${mod.value}">$1</h1>`
                  );
                }
              }
            }
          }

          // 写回文件
          await fs.writeFile(filePath, content, 'utf-8');

          return {
            success: true,
            filePath,
            modificationsApplied: modifications.length,
          };
        } catch (error) {
          throw new Error(`编辑文件失败: ${error.message}`);
        }
      },
      {
        name: 'file_editor',
        description: '编辑文件内容',
        parameters: {
          filePath: { type: 'string', description: '文件路径' },
          modifications: { type: 'array', description: '修改列表' },
        },
      }
    );

    // 创建项目结构工具
    this.registerTool(
      'create_project_structure',
      async (params, context) => {
        const projectType = params.type || 'web';
        const projectPath = params.projectPath;
        const projectName = params.projectName || 'my-project';

        if (!projectPath) {
          throw new Error('未指定项目路径');
        }

        try {
          // 根据项目类型创建不同的目录结构
          const structure = this.getProjectStructure(projectType);

          for (const dir of structure.directories) {
            const dirPath = path.join(projectPath, dir);
            await fs.mkdir(dirPath, { recursive: true });
          }

          // 创建README.md
          const readmeContent = `# ${projectName}\n\n项目描述：自动生成的项目\n`;
          await fs.writeFile(
            path.join(projectPath, 'README.md'),
            readmeContent,
            'utf-8'
          );

          return {
            success: true,
            projectPath,
            projectType,
            structure,
          };
        } catch (error) {
          throw new Error(`创建项目结构失败: ${error.message}`);
        }
      },
      {
        name: 'create_project_structure',
        description: '创建项目目录结构',
        parameters: {
          type: { type: 'string', description: '项目类型' },
          projectPath: { type: 'string', description: '项目路径' },
          projectName: { type: 'string', description: '项目名称' },
        },
      }
    );

    // Git初始化工具
    this.registerTool(
      'git_init',
      async (params, context) => {
        // 这里应该调用实际的Git模块
        // 目前只是模拟返回
        return {
          success: true,
          message: 'Git仓库初始化成功',
        };
      },
      {
        name: 'git_init',
        description: '初始化Git仓库',
        parameters: {},
      }
    );

    // Git提交工具
    this.registerTool(
      'git_commit',
      async (params, context) => {
        // 这里应该调用实际的Git模块
        // 目前只是模拟返回
        return {
          success: true,
          message: params.message || 'Auto commit',
        };
      },
      {
        name: 'git_commit',
        description: '提交Git更改',
        parameters: {
          message: { type: 'string', description: '提交信息' },
          repoPath: { type: 'string', description: '仓库路径' },
        },
      }
    );

    // 信息搜索工具
    this.registerTool(
      'info_searcher',
      async (params, context) => {
        // 简单的信息搜索实现
        return {
          success: true,
          results: [
            {
              type: 'info',
              content: '这是搜索到的信息',
            },
          ],
        };
      },
      {
        name: 'info_searcher',
        description: '搜索项目信息',
        parameters: {
          query: { type: 'string', description: '搜索查询' },
          projectId: { type: 'string', description: '项目ID' },
        },
      }
    );

    // 格式化输出工具
    this.registerTool(
      'format_output',
      async (params, context) => {
        return {
          success: true,
          formatted: JSON.stringify(params.data, null, 2),
        };
      },
      {
        name: 'format_output',
        description: '格式化输出结果',
        parameters: {
          data: { type: 'any', description: '要格式化的数据' },
        },
      }
    );

    // 通用处理器
    this.registerTool(
      'generic_handler',
      async (params, context) => {
        console.log('[Generic Handler] 处理请求:', params);

        return {
          success: true,
          message: '已收到请求，但暂未实现具体功能',
          params,
        };
      },
      {
        name: 'generic_handler',
        description: '通用处理器',
        parameters: {
          intent: { type: 'string', description: '意图' },
          input: { type: 'string', description: '用户输入' },
        },
      }
    );

    // 注册扩展工具
    ExtendedTools.registerAll(this);

    // 注册第二批扩展工具
    ExtendedTools2.registerAll(this);

    // 注册第三批扩展工具
    ExtendedTools3.registerAll(this);

    // 注册第四批扩展工具
    ExtendedTools4.registerAll(this);

    // 注册第五批扩展工具
    ExtendedTools5.registerAll(this);

    // 注册第六批扩展工具
    ExtendedTools6.registerAll(this);

    // 注册第七批扩展工具
    ExtendedTools7.registerAll(this);

    // 注册第八批扩展工具
    ExtendedTools8.registerAll(this);

    // 注册第九批扩展工具
    ExtendedTools9.registerAll(this);

    // 注册第十批扩展工具
    ExtendedTools10.registerAll(this);

    // 注册第十一批扩展工具
    ExtendedTools11.registerAll(this);
  }

  /**
   * 获取项目结构定义
   * @private
   */
  getProjectStructure(type) {
    const structures = {
      web: {
        directories: ['src', 'src/css', 'src/js', 'assets', 'assets/images'],
        files: ['index.html', 'css/style.css', 'js/script.js', 'README.md'],
      },
      document: {
        directories: ['docs', 'assets'],
        files: ['README.md'],
      },
      data: {
        directories: ['data', 'scripts', 'output'],
        files: ['README.md'],
      },
    };

    return structures[type] || structures.web;
  }

  /**
   * 注册工具
   * @param {string} name - 工具名称
   * @param {Function} handler - 工具处理函数
   * @param {Object} schema - 工具schema
   */
  registerTool(name, handler, schema) {
    if (this.tools.has(name)) {
      console.warn(`[Function Caller] 工具 "${name}" 已存在，将被覆盖`);
    }

    this.tools.set(name, {
      name,
      handler,
      schema,
    });

    console.log(`[Function Caller] 注册工具: ${name}`);
  }

  /**
   * 注销工具
   * @param {string} name - 工具名称
   */
  unregisterTool(name) {
    if (this.tools.has(name)) {
      this.tools.delete(name);
      console.log(`[Function Caller] 注销工具: ${name}`);
    }
  }

  /**
   * 调用工具
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @returns {Promise<any>} 工具执行结果
   */
  async call(toolName, params = {}, context = {}) {
    const startTime = Date.now();
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`工具 "${toolName}" 不存在`);
    }

    console.log(`[Function Caller] 调用工具: ${toolName}`, params);

    try {
      const result = await tool.handler(params, context);

      // 记录成功统计
      if (this.toolManager) {
        const duration = Date.now() - startTime;
        this.toolManager.recordToolUsage(toolName, true, duration).catch(err => {
          console.error('[Function Caller] 记录统计失败:', err);
        });
      }

      return result;
    } catch (error) {
      console.error(`[Function Caller] 工具 "${toolName}" 执行失败:`, error);

      // 记录失败统计
      if (this.toolManager) {
        const duration = Date.now() - startTime;
        const errorType = error.name || 'Error';
        this.toolManager.recordToolUsage(toolName, false, duration, errorType).catch(err => {
          console.error('[Function Caller] 记录统计失败:', err);
        });
      }

      throw error;
    }
  }

  /**
   * 获取所有可用工具
   * @returns {Array} 工具列表
   */
  getAvailableTools() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.schema?.description || tool.description || '',
      parameters: tool.schema?.parameters || tool.parameters || {},
    }));
  }

  /**
   * 检查工具是否存在
   * @param {string} name - 工具名称
   * @returns {boolean} 是否存在
   */
  hasTool(name) {
    return this.tools.has(name);
  }
}

module.exports = FunctionCaller;
