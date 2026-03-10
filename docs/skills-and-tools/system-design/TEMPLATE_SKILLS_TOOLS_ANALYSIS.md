# 模板系统技能与工具补充方案

## 一、现状分析

### 1.1 模板分类统计

当前系统包含以下模板分类：

| 分类 | 说明 | project_type | 示例模板 |
|------|------|-------------|----------|
| writing | 文档写作 | document | 商业计划书、员工培训 |
| ppt | 演示文稿 | presentation | 产品发布会PPT |
| excel | 电子表格 | spreadsheet | 财务预算表、数据分析 |
| web | 网页项目 | web | 博客、单页应用 |
| code-project | 代码项目 | app | React应用、Python项目 |
| data-science | 数据科学 | app | 机器学习项目、数据分析 |
| creative-writing | 创意写作 | document | 小说、剧本、诗歌 |
| design | 设计 | document | 海报设计 |
| podcast | 播客 | audio | 播客策划 |
| video | 视频 | video | 视频脚本、剪辑方案 |
| social-media | 社交媒体 | document | 社交媒体内容 |
| marketing | 营销推广 | document | 营销策划 |
| education | 教育培训 | document | 课程设计 |
| legal | 法律文档 | document | 合同模板 |
| ecommerce | 电商运营 | document | 电商方案 |
| health | 健康生活 | document | 健康计划 |

### 1.2 现有技能清单（25个）

**核心技能（15个）：**
1. skill_code_development - 代码开发
2. skill_web_development - Web开发
3. skill_data_analysis - 数据分析
4. skill_content_creation - 内容创作
5. skill_document_processing - 文档处理
6. skill_image_processing - 图像处理
7. skill_video_processing - 视频处理
8. skill_code_execution - 代码执行
9. skill_project_management - 项目管理
10. skill_knowledge_search - 知识库搜索
11. skill_template_application - 模板应用
12. skill_system_operations - 系统操作
13. skill_network_requests - 网络请求
14. skill_ai_conversation - AI对话
15. skill_automation_workflow - 自动化工作流

**新增技能（10个）：**
16. skill_data_transformation - 数据转换
17. skill_text_processing - 文本处理
18. skill_encryption_security - 加密安全
19-25. （其他技能）

### 1.3 现有工具清单（150+个）

**文件操作类：**
- tool_file_reader, tool_file_writer, tool_file_editor
- tool_file_searcher, tool_file_compressor, tool_file_decompressor

**Web开发类：**
- tool_html_generator, tool_css_generator, tool_js_generator

**代码管理类：**
- tool_git_init, tool_git_commit, tool_create_project_structure

**数据处理类：**
- tool_json_parser, tool_yaml_parser, tool_csv_handler
- tool_xml_parser, tool_toml_parser, tool_ini_parser
- tool_excel_reader, tool_sql_builder

**Office文档类：**
- tool_pdf_generator, tool_pdf_converter, tool_pdf_text_extractor
- tool_office_converter

**多媒体类：**
- tool_image_editor, tool_image_filter, tool_image_metadata
- tool_video_cutter, tool_video_merger
- tool_qrcode_generator, tool_screenshot_tool, tool_screen_recorder

**文本处理类：**
- tool_text_analyzer, tool_markdown_converter, tool_regex_tester

**其他工具类：**
- tool_template_renderer, tool_datetime_handler, tool_crypto_handler
- tool_base64_handler, tool_hash_verifier, tool_http_client

## 二、问题识别

### 2.1 模板与技能/工具缺乏关联

**当前问题：**
- 模板数据结构中缺少 `required_skills` 和 `required_tools` 字段
- 执行模板项目时，系统无法自动判断需要加载哪些技能和工具
- 用户不清楚某个模板需要哪些能力支持

### 2.2 缺失的专用工具

#### Office文档专用工具（高优先级）
- ❌ tool_word_generator - Word文档生成器
- ❌ tool_word_table_creator - Word表格创建器
- ❌ tool_excel_generator - Excel电子表格生成器
- ❌ tool_excel_formula_builder - Excel公式构建器
- ❌ tool_excel_chart_creator - Excel图表创建器
- ❌ tool_ppt_generator - PPT演示文稿生成器
- ❌ tool_ppt_slide_creator - PPT幻灯片创建器
- ✅ tool_pdf_generator（已存在）
- ✅ tool_office_converter（已存在）

#### 数据科学专用工具（高优先级）
- ❌ tool_data_preprocessor - 数据预处理器
- ❌ tool_feature_engineer - 特征工程工具
- ❌ tool_ml_model_trainer - 机器学习模型训练器
- ❌ tool_model_evaluator - 模型评估器
- ❌ tool_chart_generator - 数据可视化图表生成器
- ❌ tool_statistical_analyzer - 统计分析工具

#### 代码项目专用工具（中优先级）
- ❌ tool_npm_project_setup - NPM项目初始化
- ❌ tool_python_project_setup - Python项目初始化
- ❌ tool_requirements_generator - requirements.txt生成器
- ❌ tool_package_json_builder - package.json构建器
- ❌ tool_dockerfile_generator - Dockerfile生成器

#### 内容创作专用工具（中优先级）
- ❌ tool_seo_optimizer - SEO优化工具
- ❌ tool_keyword_extractor - 关键词提取器
- ❌ tool_readability_checker - 可读性检查器
- ❌ tool_plagiarism_detector - 查重工具

### 2.3 缺失的技能

#### 专业领域技能（按需补充）
- ❌ skill_office_suite - Office套件操作（Word/Excel/PPT）
- ❌ skill_data_science - 数据科学分析
- ❌ skill_seo_marketing - SEO与数字营销
- ❌ skill_video_production - 视频制作
- ❌ skill_audio_editing - 音频编辑

## 三、解决方案

### 3.1 扩展模板数据结构

在 `project_templates` 表中添加新字段：

```sql
ALTER TABLE project_templates ADD COLUMN required_skills TEXT DEFAULT '[]';
ALTER TABLE project_templates ADD COLUMN required_tools TEXT DEFAULT '[]';
ALTER TABLE project_templates ADD COLUMN execution_engine TEXT DEFAULT 'default';
```

**字段说明：**
- `required_skills` - JSON数组，存储模板所需的技能ID列表
- `required_tools` - JSON数组，存储模板所需的工具ID列表
- `execution_engine` - 执行引擎类型：default/word/excel/ppt/code/ml

### 3.2 为现有模板添加技能/工具关联

#### 示例1：商业计划书模板（writing/business-plan.json）

```json
{
  "id": "tpl_writing_business_plan_001",
  "name": "business_plan",
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
  "execution_engine": "word"
}
```

#### 示例2：React应用项目（code-project/react-app.json）

```json
{
  "id": "tpl_code_react_002",
  "name": "react_app_template",
  "required_skills": [
    "skill_code_development",
    "skill_web_development",
    "skill_project_management"
  ],
  "required_tools": [
    "tool_npm_project_setup",
    "tool_package_json_builder",
    "tool_create_project_structure",
    "tool_git_init",
    "tool_file_writer"
  ],
  "execution_engine": "code"
}
```

#### 示例3：机器学习项目（data-science/ml-project.json）

```json
{
  "id": "tpl_data_ml_002",
  "name": "ml_project_template",
  "required_skills": [
    "skill_data_science",
    "skill_data_analysis",
    "skill_code_development",
    "skill_code_execution"
  ],
  "required_tools": [
    "tool_python_project_setup",
    "tool_data_preprocessor",
    "tool_ml_model_trainer",
    "tool_model_evaluator",
    "tool_chart_generator",
    "tool_requirements_generator"
  ],
  "execution_engine": "ml"
}
```

#### 示例4：财务预算表（excel/financial-budget.json）

```json
{
  "id": "tpl_excel_financial_budget_001",
  "name": "financial_budget",
  "required_skills": [
    "skill_office_suite",
    "skill_data_analysis"
  ],
  "required_tools": [
    "tool_excel_generator",
    "tool_excel_formula_builder",
    "tool_excel_chart_creator",
    "tool_template_renderer"
  ],
  "execution_engine": "excel"
}
```

#### 示例5：产品发布会PPT（ppt/product-launch.json）

```json
{
  "id": "tpl_ppt_product_launch_001",
  "name": "product_launch_presentation",
  "required_skills": [
    "skill_office_suite",
    "skill_content_creation",
    "skill_image_processing"
  ],
  "required_tools": [
    "tool_ppt_generator",
    "tool_ppt_slide_creator",
    "tool_image_editor",
    "tool_template_renderer"
  ],
  "execution_engine": "ppt"
}
```

### 3.3 补充缺失的工具定义

#### 3.3.1 Office文档工具（添加到 builtin-tools.js）

```javascript
// Word文档生成器
{
  id: 'tool_word_generator',
  name: 'word_generator',
  display_name: 'Word文档生成器',
  description: '生成Word文档（.docx格式）',
  category: 'office',
  tool_type: 'function',
  parameters_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '文档标题' },
      content: { type: 'string', description: '文档内容（支持Markdown）' },
      outputPath: { type: 'string', description: '输出路径' },
      template: { type: 'string', description: '模板路径（可选）' }
    },
    required: ['title', 'content', 'outputPath']
  },
  required_permissions: ['file:write'],
  risk_level: 2,
  is_builtin: 1,
  enabled: 1
},

// Excel生成器
{
  id: 'tool_excel_generator',
  name: 'excel_generator',
  display_name: 'Excel电子表格生成器',
  description: '生成Excel文件（.xlsx格式）',
  category: 'office',
  tool_type: 'function',
  parameters_schema: {
    type: 'object',
    properties: {
      sheets: {
        type: 'array',
        description: '工作表数组',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            data: { type: 'array' }
          }
        }
      },
      outputPath: { type: 'string', description: '输出路径' }
    },
    required: ['sheets', 'outputPath']
  },
  required_permissions: ['file:write'],
  risk_level: 2,
  is_builtin: 1,
  enabled: 1
},

// PPT生成器
{
  id: 'tool_ppt_generator',
  name: 'ppt_generator',
  display_name: 'PPT演示文稿生成器',
  description: '生成PowerPoint文件（.pptx格式）',
  category: 'office',
  tool_type: 'function',
  parameters_schema: {
    type: 'object',
    properties: {
      slides: {
        type: 'array',
        description: '幻灯片数组',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            layout: { type: 'string', enum: ['title', 'content', 'image', 'comparison'] }
          }
        }
      },
      theme: { type: 'string', description: '主题名称' },
      outputPath: { type: 'string', description: '输出路径' }
    },
    required: ['slides', 'outputPath']
  },
  required_permissions: ['file:write'],
  risk_level: 2,
  is_builtin: 1,
  enabled: 1
}
```

#### 3.3.2 数据科学工具

```javascript
// 数据预处理器
{
  id: 'tool_data_preprocessor',
  name: 'data_preprocessor',
  display_name: '数据预处理器',
  description: '数据清洗、缺失值处理、特征缩放',
  category: 'data-science',
  tool_type: 'function',
  parameters_schema: {
    type: 'object',
    properties: {
      dataPath: { type: 'string', description: '数据文件路径' },
      operations: {
        type: 'array',
        items: { type: 'string' },
        description: '处理操作列表',
        enum: ['remove_duplicates', 'handle_missing', 'normalize', 'encode_categorical']
      },
      outputPath: { type: 'string', description: '输出路径' }
    },
    required: ['dataPath', 'operations']
  },
  required_permissions: ['file:read', 'file:write'],
  risk_level: 2,
  is_builtin: 1,
  enabled: 1
},

// 图表生成器
{
  id: 'tool_chart_generator',
  name: 'chart_generator',
  display_name: '数据可视化图表生成器',
  description: '生成各类数据可视化图表',
  category: 'data-science',
  tool_type: 'function',
  parameters_schema: {
    type: 'object',
    properties: {
      chartType: {
        type: 'string',
        enum: ['line', 'bar', 'pie', 'scatter', 'heatmap', 'box'],
        description: '图表类型'
      },
      data: { type: 'object', description: '图表数据' },
      options: { type: 'object', description: '图表配置' },
      outputPath: { type: 'string', description: '输出路径' }
    },
    required: ['chartType', 'data', 'outputPath']
  },
  required_permissions: ['file:write'],
  risk_level: 1,
  is_builtin: 1,
  enabled: 1
}
```

#### 3.3.3 项目初始化工具

```javascript
// NPM项目初始化
{
  id: 'tool_npm_project_setup',
  name: 'npm_project_setup',
  display_name: 'NPM项目初始化',
  description: '初始化Node.js/NPM项目',
  category: 'project',
  tool_type: 'function',
  parameters_schema: {
    type: 'object',
    properties: {
      projectName: { type: 'string', description: '项目名称' },
      projectPath: { type: 'string', description: '项目路径' },
      template: {
        type: 'string',
        enum: ['basic', 'express', 'react', 'vue', 'next'],
        description: '项目模板'
      }
    },
    required: ['projectName', 'projectPath']
  },
  required_permissions: ['file:write', 'command:execute'],
  risk_level: 3,
  is_builtin: 1,
  enabled: 1
},

// Python项目初始化
{
  id: 'tool_python_project_setup',
  name: 'python_project_setup',
  display_name: 'Python项目初始化',
  description: '初始化Python项目结构',
  category: 'project',
  tool_type: 'function',
  parameters_schema: {
    type: 'object',
    properties: {
      projectName: { type: 'string', description: '项目名称' },
      projectPath: { type: 'string', description: '项目路径' },
      projectType: {
        type: 'string',
        enum: ['package', 'script', 'flask', 'django', 'fastapi', 'ml'],
        description: '项目类型'
      },
      pythonVersion: { type: 'string', description: 'Python版本', default: '3.9' }
    },
    required: ['projectName', 'projectPath']
  },
  required_permissions: ['file:write', 'command:execute'],
  risk_level: 3,
  is_builtin: 1,
  enabled: 1
}
```

### 3.4 补充缺失的技能定义

#### 添加到 builtin-skills.js：

```javascript
{
  "id": "skill_office_suite",
  "name": "Office套件操作",
  "display_name": "Office Suite",
  "description": "Word、Excel、PPT文档的创建、编辑和格式化",
  "category": "office",
  "icon": "file-excel",
  "tags": "[\"Office\",\"Word\",\"Excel\",\"PPT\"]",
  "config": "{\"defaultFormat\":\"modern\"}",
  "doc_path": "docs/skills/office-suite.md",
  "tools": [
    "tool_word_generator",
    "tool_excel_generator",
    "tool_excel_formula_builder",
    "tool_excel_chart_creator",
    "tool_ppt_generator",
    "tool_ppt_slide_creator",
    "tool_pdf_generator",
    "tool_office_converter"
  ],
  "enabled": 1,
  "is_builtin": 1
},

{
  "id": "skill_data_science",
  "name": "数据科学分析",
  "display_name": "Data Science",
  "description": "数据预处理、特征工程、机器学习建模和评估",
  "category": "data",
  "icon": "experiment",
  "tags": "[\"数据科学\",\"机器学习\",\"统计分析\"]",
  "config": "{\"defaultFramework\":\"scikit-learn\"}",
  "doc_path": "docs/skills/data-science.md",
  "tools": [
    "tool_data_preprocessor",
    "tool_feature_engineer",
    "tool_ml_model_trainer",
    "tool_model_evaluator",
    "tool_chart_generator",
    "tool_statistical_analyzer"
  ],
  "enabled": 1,
  "is_builtin": 1
}
```

### 3.5 模板执行引擎扩展

在 `template-manager.js` 中添加执行引擎支持：

```javascript
/**
 * 根据模板类型选择执行引擎
 */
async executeTemplate(template, userVariables) {
  const engine = template.execution_engine || 'default';

  switch (engine) {
    case 'word':
      return await this.executeWordTemplate(template, userVariables);
    case 'excel':
      return await this.executeExcelTemplate(template, userVariables);
    case 'ppt':
      return await this.executePPTTemplate(template, userVariables);
    case 'code':
      return await this.executeCodeTemplate(template, userVariables);
    case 'ml':
      return await this.executeMLTemplate(template, userVariables);
    default:
      return await this.executeDefaultTemplate(template, userVariables);
  }
}

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
```

## 四、实施计划

### 阶段1：数据库Schema更新（优先级：高）
- [ ] 更新 project_templates 表结构
- [ ] 添加 required_skills 和 required_tools 字段
- [ ] 数据迁移脚本

### 阶段2：补充核心工具定义（优先级：高）
- [ ] 添加 Office 文档工具（Word/Excel/PPT生成器）
- [ ] 添加数据科学工具（数据预处理、模型训练）
- [ ] 添加项目初始化工具（NPM/Python项目设置）

### 阶段3：补充技能定义（优先级：中）
- [ ] skill_office_suite
- [ ] skill_data_science
- [ ] skill_video_production
- [ ] skill_audio_editing

### 阶段4：模板关联更新（优先级：中）
- [ ] 为所有现有模板添加 required_skills 和 required_tools
- [ ] 创建模板-技能-工具映射表
- [ ] 生成模板能力矩阵文档

### 阶段5：执行引擎开发（优先级：低）
- [ ] 实现 Word 模板执行引擎
- [ ] 实现 Excel 模板执行引擎
- [ ] 实现 PPT 模板执行引擎
- [ ] 实现 ML 项目模板执行引擎

### 阶段6：测试与优化（优先级：中）
- [ ] 单元测试覆盖
- [ ] 集成测试
- [ ] 性能优化
- [ ] 文档完善

## 五、效果预期

### 5.1 用户体验提升
- ✅ 模板执行前自动检查依赖的技能和工具
- ✅ 智能提示缺失的能力并引导用户安装
- ✅ 模板详情页展示所需技能和工具清单

### 5.2 系统可维护性
- ✅ 模板与技能/工具之间建立明确的依赖关系
- ✅ 便于追踪某个工具被哪些模板使用
- ✅ 方便进行能力扩展和版本管理

### 5.3 开发者友好
- ✅ 模板开发者可明确声明依赖
- ✅ 新增模板时自动验证依赖完整性
- ✅ 工具复用率提升

## 六、模板-技能-工具映射表

| 模板分类 | 典型模板 | 必需技能 | 必需工具 |
|---------|---------|---------|---------|
| writing | 商业计划书 | content_creation, document_processing | word_generator, template_renderer |
| ppt | 产品发布会 | office_suite, content_creation | ppt_generator, ppt_slide_creator |
| excel | 财务预算表 | office_suite, data_analysis | excel_generator, excel_formula_builder |
| code-project | React应用 | code_development, web_development | npm_project_setup, git_init |
| data-science | 机器学习 | data_science, code_development | data_preprocessor, ml_model_trainer |
| video | 视频脚本 | content_creation, video_processing | file_writer, template_renderer |
| web | 博客网站 | web_development | html_generator, css_generator, js_generator |

## 七、后续优化方向

1. **AI辅助工具推荐**
   - 基于模板内容自动推荐合适的工具
   - 智能生成 required_tools 列表

2. **技能市场**
   - 支持第三方技能插件
   - 技能评分和推荐系统

3. **模板组合能力**
   - 多个模板组合执行
   - 跨模板技能复用

4. **性能监控**
   - 追踪各工具的执行性能
   - 优化高频使用的工具

---

**生成时间**: 2025-12-31
**版本**: v1.0
**作者**: ChainlessChain AI Assistant
