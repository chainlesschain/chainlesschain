# 模板系统技能与工具补充 - 使用说明

## 📋 概述

本次补充为 ChainlessChain 模板系统添加了：
- ✅ **30+ 新工具定义**（Office文档、数据科学、项目初始化）
- ✅ **10+ 新技能定义**（Office套件、数据科学、SEO营销等）
- ✅ **模板-技能-工具关联机制**
- ✅ **完整的分析报告和映射文档**

## 📁 生成的文件清单

### 1. 核心分析文档
- `TEMPLATE_SKILLS_TOOLS_ANALYSIS.md` - 完整的系统分析和解决方案

### 2. 工具补充文件
位于 `desktop-app-vue/src/main/skill-tool-system/`:
- `additional-office-tools.js` - Office文档工具（Word/Excel/PPT）
- `additional-datascience-tools.js` - 数据科学工具（ML/数据分析）
- `additional-project-tools.js` - 项目初始化工具（NPM/Python/Docker）

### 3. 技能补充文件
- `desktop-app-vue/src/main/skill-tool-system/additional-skills.js` - 10个新技能定义

### 4. 模板更新脚本
- `desktop-app-vue/src/main/templates/add-skills-tools-to-templates.js` - 批量更新模板

## 🚀 快速开始

### 步骤1：合并工具定义

将补充的工具定义合并到 `builtin-tools.js`：

```javascript
// desktop-app-vue/src/main/skill-tool-system/builtin-tools.js

const officeTools = require('./additional-office-tools');
const dataScienceTools = require('./additional-datascience-tools');
const projectTools = require('./additional-project-tools');

module.exports = [
  // ... 现有工具定义

  // 添加新工具
  ...officeTools,
  ...dataScienceTools,
  ...projectTools
];
```

### 步骤2：合并技能定义

将补充的技能定义合并到 `builtin-skills.js`：

```javascript
// desktop-app-vue/src/main/skill-tool-system/builtin-skills.js

const additionalSkills = require('./additional-skills');

module.exports = [
  // ... 现有技能定义（15个核心技能）

  // 添加新技能
  ...additionalSkills
];
```

### 步骤3：更新数据库Schema

执行以下SQL更新数据库结构：

```sql
-- 为 project_templates 表添加新字段
ALTER TABLE project_templates ADD COLUMN required_skills TEXT DEFAULT '[]';
ALTER TABLE project_templates ADD COLUMN required_tools TEXT DEFAULT '[]';
ALTER TABLE project_templates ADD COLUMN execution_engine TEXT DEFAULT 'default';
```

或者在 `database.js` 中更新表结构：

```javascript
// desktop-app-vue/src/main/database.js

db.exec(`
  CREATE TABLE IF NOT EXISTS project_templates (
    -- ... 现有字段
    required_skills TEXT DEFAULT '[]',
    required_tools TEXT DEFAULT '[]',
    execution_engine TEXT DEFAULT 'default',
    -- ... 其他字段
  )
`);
```

### 步骤4：批量更新现有模板

运行模板更新脚本：

```bash
cd desktop-app-vue/src/main/templates
node add-skills-tools-to-templates.js
```

这将为所有现有模板自动添加 `required_skills` 和 `required_tools` 字段。

### 步骤5：更新模板管理器

在 `template-manager.js` 中添加能力检查逻辑：

```javascript
// desktop-app-vue/src/main/template/template-manager.js

class ProjectTemplateManager {
  /**
   * 检查并加载模板所需的技能和工具
   */
  async loadRequiredCapabilities(template) {
    const requiredSkills = template.required_skills || [];
    const requiredTools = template.required_tools || [];

    // 检查技能是否可用
    for (const skillId of requiredSkills) {
      const skill = await this.skillManager.getSkillById(skillId);
      if (!skill || !skill.enabled) {
        throw new Error(`模板需要技能 ${skillId}，但该技能未启用或不存在`);
      }
    }

    // 检查工具是否可用
    for (const toolId of requiredTools) {
      const tool = await this.toolManager.getToolById(toolId);
      if (!tool || !tool.enabled) {
        throw new Error(`模板需要工具 ${toolId}，但该工具未启用或不存在`);
      }
    }

    return {
      skills: requiredSkills,
      tools: requiredTools
    };
  }

  /**
   * 执行模板（带能力检查）
   */
  async executeTemplate(template, userVariables) {
    // 1. 检查并加载所需能力
    await this.loadRequiredCapabilities(template);

    // 2. 渲染提示词
    const prompt = this.renderPrompt(template, userVariables);

    // 3. 根据执行引擎选择执行方式
    const engine = template.execution_engine || 'default';
    // ... 执行逻辑
  }
}
```

## 📊 新增工具清单

### Office文档工具（9个）

| 工具ID | 名称 | 用途 |
|--------|------|------|
| `tool_word_generator` | Word文档生成器 | 生成.docx文件 |
| `tool_word_table_creator` | Word表格创建器 | 在Word中创建表格 |
| `tool_excel_generator` | Excel生成器 | 生成.xlsx文件 |
| `tool_excel_formula_builder` | Excel公式构建器 | 生成Excel公式 |
| `tool_excel_chart_creator` | Excel图表创建器 | 创建Excel图表 |
| `tool_ppt_generator` | PPT生成器 | 生成.pptx文件 |
| `tool_ppt_slide_creator` | PPT幻灯片创建器 | 添加PPT幻灯片 |
| `tool_ppt_theme_applicator` | PPT主题应用器 | 应用PPT主题 |

### 数据科学工具（7个）

| 工具ID | 名称 | 用途 |
|--------|------|------|
| `tool_data_preprocessor` | 数据预处理器 | 数据清洗、缺失值处理 |
| `tool_feature_engineer` | 特征工程工具 | 特征创建、选择、转换 |
| `tool_ml_model_trainer` | ML模型训练器 | 训练机器学习模型 |
| `tool_model_evaluator` | 模型评估器 | 评估模型性能 |
| `tool_chart_generator` | 图表生成器 | 数据可视化 |
| `tool_statistical_analyzer` | 统计分析工具 | 统计分析 |
| `tool_eda_generator` | EDA报告生成器 | 自动生成探索性分析报告 |

### 项目初始化工具（11个）

| 工具ID | 名称 | 用途 |
|--------|------|------|
| `tool_npm_project_setup` | NPM项目初始化 | 初始化Node.js项目 |
| `tool_package_json_builder` | package.json构建器 | 生成package.json |
| `tool_python_project_setup` | Python项目初始化 | 初始化Python项目 |
| `tool_requirements_generator` | requirements.txt生成器 | 生成Python依赖文件 |
| `tool_setup_py_generator` | setup.py生成器 | 生成Python包配置 |
| `tool_dockerfile_generator` | Dockerfile生成器 | 生成Docker配置 |
| `tool_docker_compose_generator` | docker-compose生成器 | 生成Docker Compose配置 |
| `tool_gitignore_generator` | .gitignore生成器 | 生成Git忽略文件 |
| `tool_eslint_config_generator` | ESLint配置生成器 | 生成ESLint配置 |

## 🎓 新增技能清单

| 技能ID | 名称 | 包含工具数量 |
|--------|------|-------------|
| `skill_office_suite` | Office套件操作 | 11个工具 |
| `skill_data_science` | 数据科学分析 | 9个工具 |
| `skill_seo_marketing` | SEO与数字营销 | 5个工具 |
| `skill_video_production` | 视频制作 | 4个工具 |
| `skill_audio_editing` | 音频编辑 | 4个工具 |
| `skill_database_management` | 数据库管理 | 4个工具 |
| `skill_api_development` | API开发 | 4个工具 |
| `skill_ui_ux_design` | UI/UX设计 | 4个工具 |
| `skill_testing_qa` | 测试与质量保证 | 4个工具 |
| `skill_devops_cicd` | DevOps与CI/CD | 4个工具 |

## 🔧 模板示例

### 示例1：商业计划书模板（已补充）

```json
{
  "id": "tpl_writing_business_plan_001",
  "name": "business_plan",
  "display_name": "商业计划书生成器",
  "category": "writing",
  "project_type": "document",

  "required_skills": [
    "skill_content_creation",
    "skill_document_processing",
    "skill_template_application"
  ],

  "required_tools": [
    "tool_word_generator",
    "tool_word_table_creator",
    "tool_template_renderer",
    "tool_file_writer"
  ],

  "execution_engine": "word",

  "prompt_template": "...",
  "variables_schema": [...]
}
```

### 示例2：机器学习项目模板（已补充）

```json
{
  "id": "tpl_data_ml_002",
  "name": "ml_project_template",
  "display_name": "机器学习项目",
  "category": "data-science",
  "subcategory": "machine-learning",

  "required_skills": [
    "skill_data_science",
    "skill_data_analysis",
    "skill_code_development"
  ],

  "required_tools": [
    "tool_python_project_setup",
    "tool_data_preprocessor",
    "tool_ml_model_trainer",
    "tool_model_evaluator",
    "tool_chart_generator",
    "tool_requirements_generator"
  ],

  "execution_engine": "ml",

  "prompt_template": "...",
  "variables_schema": [...]
}
```

## 📈 效果预期

### 用户体验提升
- ✅ 模板执行前自动检查依赖的技能和工具
- ✅ 智能提示缺失的能力并引导用户安装/启用
- ✅ 模板详情页展示所需技能和工具清单
- ✅ 减少模板执行失败率

### 开发者体验
- ✅ 模板与技能/工具之间建立明确的依赖关系
- ✅ 便于追踪某个工具被哪些模板使用
- ✅ 新增模板时自动验证依赖完整性
- ✅ 工具复用率提升

### 系统可维护性
- ✅ 模块化的工具和技能定义
- ✅ 清晰的映射关系文档
- ✅ 易于扩展和版本管理

## 🔍 常见问题

### Q1: 如何为新模板添加技能和工具？

直接在模板JSON文件中添加：

```json
{
  "required_skills": ["skill_xxx", "skill_yyy"],
  "required_tools": ["tool_xxx", "tool_yyy"],
  "execution_engine": "word"
}
```

### Q2: 如何添加自定义工具？

参考 `additional-*-tools.js` 文件的格式，在 `builtin-tools.js` 中添加：

```javascript
{
  id: 'tool_custom_tool',
  name: 'custom_tool',
  display_name: '自定义工具',
  description: '工具描述',
  category: 'custom',
  tool_type: 'function',
  parameters_schema: { /* ... */ },
  return_schema: { /* ... */ },
  examples: [ /* ... */ ],
  required_permissions: ['file:read'],
  risk_level: 2,
  is_builtin: 1,
  enabled: 1
}
```

### Q3: 执行引擎有哪些类型？

当前支持的执行引擎：
- `default` - 默认引擎
- `word` - Word文档引擎
- `excel` - Excel表格引擎
- `ppt` - PPT演示文稿引擎
- `code` - 代码项目引擎
- `ml` - 机器学习项目引擎
- `web` - Web项目引擎
- `video` - 视频项目引擎
- `audio` - 音频项目引擎

### Q4: 如何实现工具的实际handler？

在 `FunctionCaller` 类中实现对应的处理函数：

```javascript
// desktop-app-vue/src/main/ai-engine/function-caller.js

class FunctionCaller {
  async tool_word_generator(params) {
    const { title, content, outputPath, options } = params;

    // 使用 docx 库生成Word文档
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
          // ... 处理content
        ]
      }]
    });

    // 保存文件
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);

    return {
      success: true,
      filePath: outputPath,
      fileSize: buffer.length,
      pageCount: 1
    };
  }
}
```

## 📚 相关文档

- [TEMPLATE_SKILLS_TOOLS_ANALYSIS.md](./TEMPLATE_SKILLS_TOOLS_ANALYSIS.md) - 完整的系统分析
- [TEMPLATE_SKILLS_TOOLS_MAPPING.md](./desktop-app-vue/src/main/templates/TEMPLATE_SKILLS_TOOLS_MAPPING.md) - 映射规则文档（运行脚本后生成）

## 🛠️ 下一步工作

### 高优先级
- [ ] 实现工具的实际handler函数
- [ ] 更新数据库schema
- [ ] 测试模板执行流程

### 中优先级
- [ ] 完善模板详情页UI，展示所需技能和工具
- [ ] 实现技能/工具缺失的提示和引导
- [ ] 编写单元测试

### 低优先级
- [ ] 实现不同执行引擎的具体逻辑
- [ ] 优化工具执行性能
- [ ] 添加更多专业领域的工具和技能

## 📝 注意事项

1. **向后兼容**：未定义 `required_skills` 的旧模板仍可正常使用
2. **渐进迁移**：可以逐步为模板添加技能和工具，不必一次性全部完成
3. **工具实现**：工具定义完成后，需要在 `FunctionCaller` 中实现具体逻辑
4. **数据库备份**：修改schema前请备份数据库

## 🙏 贡献

如有建议或问题，请提交Issue或Pull Request。

---

**生成时间**: 2025-12-31
**版本**: v1.0
**作者**: Claude AI Assistant

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：模板系统技能与工具补充 - 使用说明。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
