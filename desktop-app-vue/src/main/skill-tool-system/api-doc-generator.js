/**
 * API文档生成器
 * 从JSDoc注释自动生成Markdown格式的API文档
 */

const fs = require("fs").promises;
const path = require("path");

class ApiDocGenerator {
  constructor(outputDir) {
    this.outputDir = outputDir || path.join(process.cwd(), "docs", "api");
    this.moduleFiles = [
      {
        name: "SkillManager",
        file: path.join(__dirname, "skill-manager.js"),
        description: "技能管理器 - 负责技能的CRUD操作、状态管理和统计",
      },
      {
        name: "ToolManager",
        file: path.join(__dirname, "tool-manager.js"),
        description: "工具管理器 - 负责工具的注册、执行和参数验证",
      },
      {
        name: "SkillExecutor",
        file: path.join(__dirname, "skill-executor.js"),
        description: "技能执行器 - 负责执行技能和调度工具",
      },
      {
        name: "ToolRunner",
        file: path.join(__dirname, "tool-runner.js"),
        description: "工具运行器 - 负责工具的安全执行和错误处理",
      },
      {
        name: "StatsCleaner",
        file: path.join(__dirname, "stats-cleaner.js"),
        description: "统计数据清理器 - 定期清理过期数据和优化数据库",
      },
    ];
  }

  /**
   * 生成所有模块的API文档
   */
  async generateAll() {
    console.log("[ApiDocGenerator] 开始生成API文档...");

    try {
      // 确保输出目录存在
      await fs.mkdir(this.outputDir, { recursive: true });

      // 生成索引文件
      await this.generateIndex();

      // 生成每个模块的文档
      for (const module of this.moduleFiles) {
        await this.generateModuleDoc(module);
      }

      console.log(`[ApiDocGenerator] API文档已生成到: ${this.outputDir}`);
      return { success: true, outputDir: this.outputDir };
    } catch (error) {
      console.error("[ApiDocGenerator] 生成API文档失败:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 生成索引文件
   */
  async generateIndex() {
    let content = `# 技能工具系统 API 文档

> 自动生成时间: ${new Date().toLocaleString("zh-CN")}

## 概述

技能工具系统提供了完整的技能和工具管理功能,包括:

- **技能管理** - 创建、配置和管理技能
- **工具管理** - 注册、执行和监控工具
- **执行调度** - 智能调度和执行技能
- **统计分析** - 使用统计和性能分析
- **定时任务** - 自动化工作流和数据清理

## 核心模块

`;

    for (const module of this.moduleFiles) {
      content += `### [${module.name}](./${module.name}.md)\n\n${module.description}\n\n`;
    }

    content += `
## 快速开始

\`\`\`javascript
const { SkillManager } = require('./skill-tool-system/skill-manager');
const { ToolManager } = require('./skill-tool-system/tool-manager');

// 初始化
const skillManager = new SkillManager(database, toolManager);
const toolManager = new ToolManager(database, functionCaller);

await skillManager.initialize();
await toolManager.initialize();

// 注册技能
const skill = await skillManager.registerSkill({
  id: 'my_skill',
  name: '我的技能',
  category: 'custom',
  description: '自定义技能描述'
});

// 注册工具
const tool = await toolManager.registerTool({
  id: 'my_tool',
  name: 'my_tool',
  description: '我的工具',
  parameters_schema: JSON.stringify({
    type: 'object',
    properties: {
      input: { type: 'string' }
    }
  })
}, async (params) => {
  // 工具处理逻辑
  return { result: 'success' };
});

// 关联技能和工具
await skillManager.addToolToSkill(skill.id, tool.id);
\`\`\`

## IPC接口

技能工具系统通过IPC提供前端调用接口:

### 技能相关

- \`skill:get-all\` - 获取所有技能
- \`skill:get-by-id\` - 根据ID获取技能
- \`skill:enable\` - 启用技能
- \`skill:disable\` - 禁用技能
- \`skill:get-doc\` - 获取技能文档

### 工具相关

- \`tool:get-all\` - 获取所有工具
- \`tool:get-by-id\` - 根据ID获取工具
- \`tool:enable\` - 启用工具
- \`tool:disable\` - 禁用工具
- \`tool:execute\` - 执行工具
- \`tool:get-doc\` - 获取工具文档

详细的IPC接口文档请参考 [IPC接口文档](./IPC.md)

## 数据库Schema

系统使用SQLite数据库,包含以下表:

- \`skills\` - 技能表
- \`tools\` - 工具表
- \`skill_tools\` - 技能-工具关联表
- \`skill_stats\` - 技能统计表
- \`tool_stats\` - 工具统计表
- \`skill_tool_usage_logs\` - 使用日志表

详细的数据库Schema请参考 [数据库文档](./Database.md)

## 插件开发

开发插件扩展技能和工具:

\`\`\`json
{
  "id": "com.example.my-plugin",
  "extensionPoints": [
    {
      "point": "ai.function-tool",
      "config": {
        "tools": [
          {
            "name": "my_tool",
            "description": "我的工具",
            "parameters": { /* schema */ },
            "handler": "myToolHandler"
          }
        ],
        "skills": [
          {
            "id": "my_skill",
            "name": "我的技能",
            "tools": ["my_tool"]
          }
        ]
      }
    }
  ]
}
\`\`\`

详细的插件开发指南请参考 [插件开发文档](./PluginDevelopment.md)

---

> 更多信息请参考各模块的详细文档
`;

    const indexFile = path.join(this.outputDir, "README.md");

    // 只在内容实际变化时才写入（忽略时间戳比较）
    if (await this._shouldUpdateDoc(indexFile, content)) {
      await fs.writeFile(indexFile, content, "utf-8");
      console.log(`[ApiDocGenerator] 索引文件已生成: ${indexFile}`);
    } else {
      console.log(`[ApiDocGenerator] 索引文件无变化，跳过: ${indexFile}`);
    }
  }

  /**
   * 生成模块文档
   */
  async generateModuleDoc(module) {
    try {
      const sourceCode = await fs.readFile(module.file, "utf-8");
      const methods = this.extractMethods(sourceCode);
      const properties = this.extractProperties(sourceCode);

      let content = `# ${module.name} API 文档

${module.description}

**文件路径**: \`${path.relative(process.cwd(), module.file)}\`

## 类概述

\`\`\`javascript
class ${module.name} {
${properties.map((p) => `  ${p.name}; // ${p.description || ""}`).join("\n")}
}
\`\`\`

## 构造函数

\`\`\`javascript
new ${module.name}(${methods.find((m) => m.name === "constructor")?.params.join(", ") || ""})
\`\`\`

## 方法

`;

      // 按类别分组方法
      const publicMethods = methods.filter(
        (m) => !m.name.startsWith("_") && m.name !== "constructor",
      );
      const privateMethods = methods.filter((m) => m.name.startsWith("_"));

      content += "### 公开方法\n\n";
      for (const method of publicMethods) {
        content += this.formatMethodDoc(method);
      }

      if (privateMethods.length > 0) {
        content += "\n### 私有方法\n\n";
        for (const method of privateMethods) {
          content += this.formatMethodDoc(method);
        }
      }

      content += `
## 事件

如果该类继承自EventEmitter,可以监听以下事件:

${
  this.extractEvents(sourceCode)
    .map((e) => `- \`${e.name}\` - ${e.description}`)
    .join("\n") || "(无)"
}

## 示例

\`\`\`javascript
const ${module.name.toLowerCase()} = new ${module.name}(/* 参数 */);

// 示例代码
// TODO: 添加实际使用示例
\`\`\`

---

> 自动生成时间: ${new Date().toLocaleString("zh-CN")}
`;

      const outputFile = path.join(this.outputDir, `${module.name}.md`);

      // 只在内容实际变化时才写入（忽略时间戳比较）
      if (await this._shouldUpdateDoc(outputFile, content)) {
        await fs.writeFile(outputFile, content, "utf-8");
        console.log(`[ApiDocGenerator] 模块文档已生成: ${outputFile}`);
      } else {
        console.log(`[ApiDocGenerator] 模块文档无变化，跳过: ${outputFile}`);
      }
    } catch (error) {
      console.error(`[ApiDocGenerator] 生成 ${module.name} 文档失败:`, error);
    }
  }

  /**
   * 提取方法
   */
  extractMethods(sourceCode) {
    const methods = [];
    const methodRegex =
      /(?:\/\*\*[\s\S]*?\*\/\s*)?(async\s+)?(\w+)\s*\(([^)]*)\)\s*{/g;
    const docCommentRegex = /\/\*\*([\s\S]*?)\*\//;

    let match;
    while ((match = methodRegex.exec(sourceCode)) !== null) {
      const [fullMatch, isAsync, methodName, params] = match;
      const startPos = match.index;

      // 查找前面的文档注释
      const precedingCode = sourceCode.substring(
        Math.max(0, startPos - 500),
        startPos,
      );
      const docMatch = docCommentRegex.exec(precedingCode);

      let description = "";
      let paramDocs = [];
      let returns = "";

      if (docMatch) {
        const docText = docMatch[1];
        const lines = docText
          .split("\n")
          .map((l) => l.trim().replace(/^\*\s?/, ""));

        description = lines.find((l) => l && !l.startsWith("@"))?.trim() || "";

        paramDocs = lines
          .filter((l) => l.startsWith("@param"))
          .map((l) => {
            const paramMatch = l.match(
              /@param\s+(?:\{([^}]+)\}\s+)?(\w+)\s*-?\s*(.*)/,
            );
            if (paramMatch) {
              return {
                type: paramMatch[1] || "any",
                name: paramMatch[2],
                description: paramMatch[3],
              };
            }
            return null;
          })
          .filter(Boolean);

        const returnLine = lines.find((l) => l.startsWith("@returns"));
        if (returnLine) {
          const returnMatch = returnLine.match(
            /@returns\s+(?:\{([^}]+)\}\s+)?(.*)/,
          );
          if (returnMatch) {
            returns = `\`${returnMatch[1] || "void"}\` - ${returnMatch[2]}`;
          }
        }
      }

      methods.push({
        name: methodName,
        isAsync: !!isAsync,
        params: params
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        paramDocs,
        description,
        returns,
      });
    }

    return methods;
  }

  /**
   * 提取属性
   */
  extractProperties(sourceCode) {
    const properties = [];
    const propertyRegex = /this\.(\w+)\s*=\s*([^;]+);/g;

    let match;
    while ((match = propertyRegex.exec(sourceCode)) !== null) {
      properties.push({
        name: match[1],
        initialValue: match[2].trim(),
        description: "",
      });
    }

    // 去重
    const uniqueProps = [];
    const seen = new Set();
    for (const prop of properties) {
      if (!seen.has(prop.name)) {
        seen.add(prop.name);
        uniqueProps.push(prop);
      }
    }

    return uniqueProps;
  }

  /**
   * 提取事件
   */
  extractEvents(sourceCode) {
    const events = [];
    const eventRegex = /this\.emit\s*\(\s*['"]([^'"]+)['"]/g;

    let match;
    while ((match = eventRegex.exec(sourceCode)) !== null) {
      events.push({
        name: match[1],
        description: "(待补充说明)",
      });
    }

    // 去重
    return [...new Set(events.map((e) => e.name))].map((name) => ({
      name,
      description: events.find((e) => e.name === name)?.description || "",
    }));
  }

  /**
   * 格式化方法文档
   */
  formatMethodDoc(method) {
    let doc = `#### \`${method.isAsync ? "async " : ""}${method.name}(${method.params.join(", ")})\`\n\n`;

    if (method.description) {
      doc += `${method.description}\n\n`;
    }

    if (method.paramDocs.length > 0) {
      doc += "**参数:**\n\n";
      for (const param of method.paramDocs) {
        doc += `- \`${param.name}\` (\`${param.type}\`) - ${param.description}\n`;
      }
      doc += "\n";
    }

    if (method.returns) {
      doc += `**返回:** ${method.returns}\n\n`;
    }

    doc += "---\n\n";

    return doc;
  }

  /**
   * 比较文档内容是否需要更新（忽略时间戳）
   * @private
   */
  async _shouldUpdateDoc(filePath, newContent) {
    try {
      const existingContent = await fs.readFile(filePath, "utf-8");

      // 移除时间戳行进行比较
      const timestampPattern = /(?:> 自动生成时间|\*\*文档生成时间\*\*): .+\n/g;
      const normalizedExisting = existingContent.replace(timestampPattern, "");
      const normalizedNew = newContent.replace(timestampPattern, "");

      return normalizedExisting !== normalizedNew;
    } catch (error) {
      if (error.code === "ENOENT") {
        // 文件不存在，需要创建
        return true;
      }
      throw error;
    }
  }

  /**
   * 手动生成单个模块文档
   */
  async generateSingleModule(moduleName) {
    const module = this.moduleFiles.find((m) => m.name === moduleName);
    if (!module) {
      throw new Error(`模块不存在: ${moduleName}`);
    }

    await fs.mkdir(this.outputDir, { recursive: true });
    await this.generateModuleDoc(module);

    return {
      success: true,
      file: path.join(this.outputDir, `${moduleName}.md`),
    };
  }
}

module.exports = ApiDocGenerator;

// 如果直接运行此文件,则生成所有文档
if (require.main === module) {
  const generator = new ApiDocGenerator();
  generator
    .generateAll()
    .then((result) => {
      if (result.success) {
        console.log("✅ API文档生成成功!");
        process.exit(0);
      } else {
        console.error("❌ API文档生成失败:", result.error);
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("❌ 发生错误:", error);
      process.exit(1);
    });
}
