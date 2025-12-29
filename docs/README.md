# Skill-Tool 系统文档中心

**生成时间**: 2025-12-29
**文档总数**: 27个（15个技能 + 12个工具）

---

## 📚 文档导航

### 技能文档（15个）

#### 代码开发类 (2个)
- [代码开发 (Code Development)](./skills/code_development.md) - 完整的软件开发能力
- [代码执行 (Code Execution)](./skills/code_execution.md) - 安全执行代码片段

#### Web开发类 (1个)
- [Web开发 (Web Development)](./skills/web_development.md) - Web前端开发

#### 数据处理类 (1个)
- [数据分析 (Data Analysis)](./skills/data_analysis.md) - 数据读取、处理和可视化

#### 内容创作类 (2个)
- [内容创作 (Content Creation)](./skills/content_creation.md) - 文本内容创作和编辑
- [文档处理 (Document Processing)](./skills/document_processing.md) - Word/PDF/Excel处理

#### 媒体处理类 (2个)
- [图像处理 (Image Processing)](./skills/image_processing.md) - 图片编辑和OCR
- [视频处理 (Video Processing)](./skills/video_processing.md) - 视频剪辑和转码

#### 项目管理类 (1个)
- [项目管理 (Project Management)](./skills/project_management.md) - 项目创建和版本控制

#### AI功能类 (2个)
- [知识库搜索 (Knowledge Search)](./skills/knowledge_search.md) - RAG增强搜索
- [AI对话 (AI Conversation)](./skills/ai_conversation.md) - 多轮对话和上下文理解

#### 模板应用类 (1个)
- [模板应用 (Template Application)](./skills/template_application.md) - 快速项目生成

#### 系统操作类 (1个)
- [系统操作 (System Operations)](./skills/system_operations.md) - 文件系统和环境配置

#### 网络请求类 (1个)
- [网络请求 (Network Requests)](./skills/network_requests.md) - HTTP请求和API调用

#### 自动化类 (1个)
- [自动化工作流 (Automation Workflow)](./skills/automation_workflow.md) - 自动化任务流程

---

### 工具文档（12个）

#### 文件操作类 (3个)
- [file_reader](./tools/file_reader.md) - 读取文件内容
- [file_writer](./tools/file_writer.md) - 写入文件内容
- [file_editor](./tools/file_editor.md) - 编辑现有文件

#### 代码生成类 (3个)
- [html_generator](./tools/html_generator.md) - 生成HTML代码
- [css_generator](./tools/css_generator.md) - 生成CSS样式
- [js_generator](./tools/js_generator.md) - 生成JavaScript代码

#### 项目管理类 (3个)
- [create_project_structure](./tools/create_project_structure.md) - 创建项目结构
- [git_init](./tools/git_init.md) - 初始化Git仓库
- [git_commit](./tools/git_commit.md) - 提交代码变更

#### 通用工具类 (3个)
- [info_searcher](./tools/info_searcher.md) - 信息检索
- [format_output](./tools/format_output.md) - 格式化输出
- [generic_handler](./tools/generic_handler.md) - 通用处理器

---

## 📊 分类统计

### 技能分类

| 分类 | 数量 | 技能列表 |
|------|------|----------|
| code | 2 | 代码开发、代码执行 |
| web | 1 | Web开发 |
| data | 1 | 数据分析 |
| content | 1 | 内容创作 |
| document | 1 | 文档处理 |
| media | 2 | 图像处理、视频处理 |
| project | 1 | 项目管理 |
| ai | 2 | 知识库搜索、AI对话 |
| template | 1 | 模板应用 |
| system | 1 | 系统操作 |
| network | 1 | 网络请求 |
| automation | 1 | 自动化工作流 |

### 工具分类

| 分类 | 数量 | 工具列表 |
|------|------|----------|
| file | 3 | file_reader, file_writer, file_editor |
| code | 3 | html_generator, css_generator, js_generator |
| project | 3 | create_project_structure, git_init, git_commit |
| system | 1 | generic_handler |
| data | 1 | format_output |
| ai | 1 | info_searcher |

---

## 🎯 快速查找

### 按功能查找

**文件操作**: file_reader, file_writer, file_editor
**代码生成**: html_generator, css_generator, js_generator
**版本控制**: git_init, git_commit
**项目管理**: create_project_structure, 项目管理技能
**AI功能**: info_searcher, 知识库搜索, AI对话

### 按风险等级查找

**低风险 (1级)**: file_reader 等读取类工具
**中等风险 (2-3级)**: file_writer 等写入类工具
**高风险 (4-5级)**: git_commit 等系统级操作

---

## 📖 文档规范

### 技能文档结构
```
1. 概述 - 基本信息和描述
2. 标签 - 分类标签
3. 配置选项 - JSON配置
4. 包含的工具 - 关联工具列表
5. 使用场景 - 应用场景说明
6. 权限要求 - 所需权限
7. 文档路径 - 文件位置
```

### 工具文档结构
```
1. 基本信息 - ID、名称、类型等
2. 功能描述 - 工具说明
3. 参数Schema - 输入参数定义
4. 返回值Schema - 输出格式定义
5. 配置选项 - 可选配置
6. 权限要求 - 所需权限
7. 使用示例 - 代码示例
8. 性能指标 - 统计数据
9. 文档路径 - 文件位置
```

---

## 🔧 文档维护

### 更新文档

运行以下命令重新生成所有文档：

```bash
cd desktop-app-vue
node generate-all-docs.js
```

### 生成单个文档

使用 DocGenerator 类生成：

```javascript
const docGen = new DocGenerator();
await docGen.generateSkillDoc(skill);
await docGen.generateToolDoc(tool);
```

---

## 📝 贡献指南

1. 添加新技能时，确保更新 `builtin-skills.js`
2. 添加新工具时，确保更新 `builtin-tools.js`
3. 运行 `generate-all-docs.js` 重新生成文档
4. 提交时包含新生成的 Markdown 文件

---

## 🔗 相关资源

- [Skill-Tool 系统设计文档](../SKILL_TOOL_SYSTEM_IMPLEMENTATION_PLAN.md)
- [系统测试报告](../SKILL_TOOL_SYSTEM_TEST_REPORT.md)
- [完成报告](../SKILL_TOOL_SYSTEM_COMPLETION_REPORT.md)

---

**文档版本**: v1.0.0
**最后更新**: 2025-12-29
**维护者**: ChainlessChain Team
