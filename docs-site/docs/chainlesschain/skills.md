# Skills 技能系统

> **版本: v0.37.5 | 90内置技能 | Agent Skills开放标准 | 统一工具注册表**

Skills 系统提供 90 个内置技能，使用 Markdown 定义技能(SKILL.md)，支持四层加载、Agent Skills 开放标准(13扩展字段)、门控检查和自定义命令。v0.37.5 新增 30 个技能（含图像+数据+开发效率+文档+媒体+系统工具），Handler 覆盖率 90/90 (100%)。

## 系统概述

### 技能是什么

技能是预定义的 AI 能力模板，封装了特定任务的：

- **提示词** - AI 的行为指导
- **工具集** - 允许使用的工具 (通过 `tools` 字段声明)
- **参数** - 可配置的选项 (通过 `input-schema` 定义)
- **门控** - 执行条件检查
- **指南** - 使用说明 (通过 `instructions` 字段)
- **示例** - 使用示例 (通过 `examples` 字段)

### 基础技能 (30)

| 类别       | 技能                     | Handler | 说明           |
| ---------- | ------------------------ | ------- | -------------- |
| **开发**   | `/code-review`           | ✅      | 代码审查       |
| **开发**   | `/git-commit`            | ✅      | 智能提交       |
| **开发**   | `/test-generator`        | ✅      | 测试生成       |
| **开发**   | `/performance-optimizer` | ✅      | 性能优化       |
| **学习**   | `/explain-code`          | ✅      | 代码解释       |
| **自动化** | `/browser-automation`    | ✅      | 浏览器自动化   |
| **自动化** | `/computer-use`          | ✅      | 桌面操作       |
| **自动化** | `/workflow-automation`   | ✅      | 工作流自动化   |
| **数据**   | `/web-scraping`          | ✅      | 网页数据抓取   |
| **数据**   | `/data-analysis`         | ✅      | 数据分析       |
| **知识**   | `/memory-management`     | ✅      | 记忆管理       |
| **知识**   | `/smart-search`          | ✅      | 智能搜索       |
| **远程**   | `/remote-control`        | ✅      | 远程控制       |
| **安全**   | `/security-audit`        | ✅      | 安全审计       |
| **DevOps** | `/devops-automation`     | ✅      | DevOps自动化   |
| **开发**   | `/repo-map`              | ✅      | 代码库结构映射 |
| **开发**   | `/refactor`              | ✅      | 多文件代码重构 |
| **文档**   | `/doc-generator`         | ✅      | 文档自动生成   |
| **测试**   | `/api-tester`            | ✅      | API/IPC测试    |
| **开发**   | `/onboard-project`       | ✅      | 项目入门分析   |
| **开发**   | `/lint-and-fix`          | ✅      | Lint自动修复   |
| **测试**   | `/test-and-fix`          | ✅      | 测试自动修复   |
| **分析**   | `/dependency-analyzer`   | ✅      | 依赖分析       |
| **数据库** | `/db-migration`          | ✅      | 数据库迁移     |
| **开发**   | `/project-scaffold`      | ✅      | 项目脚手架     |
| **DevOps** | `/env-doctor`            | ✅      | 环境诊断       |
| **知识**   | `/context-loader`        | ✅      | 智能上下文     |
| **安全**   | `/vulnerability-scanner` | ✅      | 漏洞扫描       |
| **DevOps** | `/release-manager`       | ✅      | 发布管理       |
| **开发**   | `/mcp-server-generator`  | ✅      | MCP服务器生成  |

### 高级技能 v0.36.1 (10)

| 类别     | 技能                  | Handler | 说明           |
| -------- | --------------------- | ------- | -------------- |
| **开发** | `/architect-mode`     | ✅      | 双阶段架构模式 |
| **测试** | `/bugbot`             | ✅      | 主动Bug检测    |
| **开发** | `/commit-splitter`    | ✅      | 智能提交拆分   |
| **开发** | `/diff-previewer`     | ✅      | 差异预览器     |
| **测试** | `/fault-localizer`    | ✅      | 故障定位器     |
| **分析** | `/impact-analyzer`    | ✅      | 变更影响分析   |
| **知识** | `/research-agent`     | ✅      | 技术研究代理   |
| **开发** | `/rules-engine`       | ✅      | 规则引擎       |
| **开发** | `/screenshot-to-code` | ✅      | 截图转代码     |
| **开发** | `/task-decomposer`    | ✅      | 任务分解器     |

### AI 会话增强 + 开发效率 v0.36.2 (10)

| 类别     | 技能                    | Handler | 说明           |
| -------- | ----------------------- | ------- | -------------- |
| **AI**   | `/prompt-enhancer`      | ✅      | 提示词增强     |
| **知识** | `/codebase-qa`          | ✅      | 代码库语义问答 |
| **AI**   | `/auto-context`         | ✅      | 智能上下文检测 |
| **AI**   | `/multi-model-router`   | ✅      | 多模型路由     |
| **开发** | `/code-translator`      | ✅      | 跨语言转换     |
| **开发** | `/dead-code-eliminator` | ✅      | 死代码检测     |
| **开发** | `/changelog-generator`  | ✅      | Changelog生成  |
| **开发** | `/mock-data-generator`  | ✅      | 模拟数据生成   |
| **分析** | `/git-history-analyzer` | ✅      | Git历史分析    |
| **开发** | `/i18n-manager`         | ✅      | 国际化管理     |

### Office文档 + 音视频 v0.37.3 (10)

| 类别     | 技能                  | Handler | 说明           |
| -------- | --------------------- | ------- | -------------- |
| **文档** | `/pdf-toolkit`        | ✅      | PDF处理工具箱  |
| **文档** | `/doc-converter`      | ✅      | 万能格式转换   |
| **文档** | `/excel-analyzer`     | ✅      | Excel深度分析  |
| **文档** | `/pptx-creator`       | ✅      | 演示文稿生成   |
| **文档** | `/doc-comparator`     | ✅      | 文档对比       |
| **媒体** | `/audio-transcriber`  | ✅      | 语音转文字     |
| **媒体** | `/video-toolkit`      | ✅      | 视频操作工具箱 |
| **媒体** | `/subtitle-generator` | ✅      | 字幕生成       |
| **媒体** | `/tts-synthesizer`    | ✅      | 文本转语音     |
| **媒体** | `/media-metadata`     | ✅      | 媒体元数据     |

### 图像+数据+工具 v0.37.4 (10)

| 类别       | 技能                 | Handler | 说明           |
| ---------- | -------------------- | ------- | -------------- |
| **媒体**   | `/image-editor`      | ✅      | 图片编辑处理   |
| **媒体**   | `/ocr-scanner`       | ✅      | OCR文字识别    |
| **AI**     | `/image-generator`   | ✅      | AI图像生成     |
| **数据**   | `/chart-creator`     | ✅      | 数据可视化图表 |
| **文档**   | `/word-generator`    | ✅      | Word文档生成   |
| **数据**   | `/csv-processor`     | ✅      | CSV数据处理    |
| **开发**   | `/template-renderer` | ✅      | 模板渲染引擎   |
| **开发**   | `/code-runner`       | ✅      | 安全代码执行   |
| **自动化** | `/voice-commander`   | ✅      | 语音命令管理   |
| **工具**   | `/file-compressor`   | ✅      | 文件压缩解压   |

### 开发效率+系统工具 v0.37.5 (10)

| 类别     | 技能                 | Handler | 说明           |
| -------- | -------------------- | ------- | -------------- |
| **开发** | `/json-yaml-toolkit` | ✅      | JSON/YAML处理  |
| **开发** | `/regex-playground`  | ✅      | 正则表达式工具 |
| **运维** | `/log-analyzer`      | ✅      | 日志分析       |
| **运维** | `/system-monitor`    | ✅      | 系统监控       |
| **开发** | `/http-client`       | ✅      | HTTP客户端     |
| **文档** | `/markdown-enhancer` | ✅      | Markdown增强   |
| **开发** | `/snippet-library`   | ✅      | 代码片段库     |
| **知识** | `/knowledge-graph`   | ✅      | 知识图谱       |
| **工具** | `/clipboard-manager` | ✅      | 剪贴板管理     |
| **运维** | `/env-file-manager`  | ✅      | 环境变量管理   |

---

## 四层加载

### 加载优先级

```
workspace/     # 工作区技能（最高优先级）
    ↓
managed/       # 用户管理的技能
    ↓
marketplace/   # 插件市场安装的技能 (v0.34.0新增)
    ↓
bundled/       # 内置技能（80个，100% Handler覆盖，最低优先级）
```

高层技能可以覆盖低层同名技能。

### 技能目录

```
.chainlesschain/skills/          # 工作区技能
~/.chainlesschain/skills/        # 用户技能
<marketplace>/skills/            # 插件市场技能
<app>/skills/builtin/            # 内置技能 (70个)
```

---

## 技能定义格式

### Markdown 技能文件

```markdown
---
name: code-review
description: 执行代码审查，提供改进建议
version: 1.0.0
author: ChainlessChain Team
---

# Code Review 代码审查

## 门控检查

- platform: ["darwin", "linux", "win32"]
- binary: git
- env: GITHUB_TOKEN (optional)

## 参数

- `file` (required): 要审查的文件路径
- `focus` (optional): 审查重点 (security|performance|style)
- `severity` (optional): 最低报告级别 (info|warning|error)

## 工具

- Read
- Glob
- Grep

## 提示词

你是一个专业的代码审查员。请审查提供的代码，关注以下方面：

1. **代码质量** - 可读性、可维护性、命名规范
2. **潜在问题** - bug、边界情况、错误处理
3. **性能** - 算法效率、资源使用
4. **安全** - 常见漏洞、敏感信息处理
5. **最佳实践** - 设计模式、代码组织

请提供具体的改进建议，包括代码示例。
```

---

## 内置技能

### 开发类技能

```bash
/code-review src/auth/login.js          # 代码审查
/code-review src/ --focus=security      # 安全审查

/git-commit                              # 智能提交
/explain-code src/utils/crypto.js        # 代码解释
/test-generator src/services/user.js     # 生成测试
/performance-optimizer src/api/          # 性能优化
```

### 自动化类技能 (可执行Handler)

```bash
/browser-automation                      # 浏览器自动化
  # 导航、点击、输入、表单填充、截图、数据提取

/computer-use                            # 桌面操作
  # 桌面截图、坐标点击、键盘输入、视觉AI

/workflow-automation                     # 工作流自动化
  # 条件分支、循环、并行执行、子工作流
```

### 知识与数据类技能 (可执行Handler)

```bash
/memory-management                       # 记忆管理
  # 保存笔记、搜索知识、查看日志、提取洞察

/smart-search                            # 智能混合搜索
  # 向量60% + BM25 40% 混合搜索

/web-scraping                            # 网页数据抓取
  # 表格、链接、文本提取

/remote-control                          # 远程设备控制
  # 命令、文件传输、剪贴板同步
```

### 安全与运维类技能

```bash
/security-audit src/                     # 安全审计 (OWASP)
/devops-automation                       # CI/CD自动化
/data-analysis data.csv                  # 数据分析
```

---

## 统一工具注册表 (v0.36.0新增)

### 概述

统一工具注册表 (UnifiedToolRegistry) 聚合三大工具系统：

| 工具系统       | 工具数    | 说明                              |
| -------------- | --------- | --------------------------------- |
| FunctionCaller | 60+       | 内置工具 (文件/代码/Git/Office等) |
| MCP            | 8 servers | 社区MCP服务器                     |
| Skills         | 50        | 内置技能Handler注册的工具         |

### 自动技能映射

- **SkillMdParser**: 解析SKILL.md中的`tools`字段，关联工具到技能
- **ToolSkillMapper**: 未覆盖工具自动分组到10个默认类别
- **MCPSkillGenerator**: MCP服务器连接时自动生成技能

### 工具浏览器

访问 `#/tools/explorer` 可以按技能分组浏览所有工具。

### IPC接口

| 处理器                      | 功能                    |
| --------------------------- | ----------------------- |
| `tools:get-all-with-skills` | 获取所有工具+技能元数据 |
| `tools:get-skill-manifest`  | 获取所有技能清单        |
| `tools:get-by-skill`        | 按技能获取工具          |
| `tools:search-unified`      | 搜索工具                |
| `tools:get-tool-context`    | 获取工具上下文          |
| `tools:refresh-unified`     | 刷新注册表              |

---

## 演示模板 (v0.36.0新增)

10个演示模板展示技能组合能力：

| 类别     | 模板            | 使用技能                                      | 难度 |
| -------- | --------------- | --------------------------------------------- | ---- |
| 自动化   | Web表单自动填充 | browser-automation, workflow-automation       | 入门 |
| 自动化   | 批量截图        | browser-automation, workflow-automation       | 入门 |
| 自动化   | 数据提取流水线  | web-scraping, workflow-automation             | 中级 |
| AI工作流 | AI研究助手      | smart-search, memory-management, web-scraping | 中级 |
| AI工作流 | 日报生成器      | memory-management, smart-search               | 入门 |
| AI工作流 | 代码审查流水线  | code-review, workflow-automation              | 中级 |
| 知识     | 个人知识库      | memory-management, smart-search               | 入门 |
| 知识     | 会议记录管理    | memory-management                             | 入门 |
| 远程     | 多设备同步      | remote-control, workflow-automation           | 中级 |
| 远程     | 远程桌面监控    | remote-control, computer-use                  | 高级 |

访问 `#/demo-templates` 浏览和运行演示模板。

---

## 门控检查

### 平台检查

```yaml
# 仅在 macOS 和 Linux 可用
- platform: ["darwin", "linux"]
```

### 二进制依赖

```yaml
# 需要安装 git
- binary: git

# 需要安装 node 和 npm
- binary: [node, npm]
```

### 环境变量

```yaml
# 必需的环境变量
- env: OPENAI_API_KEY

# 可选的环境变量
- env: GITHUB_TOKEN (optional)
```

### 自定义检查

```yaml
# 自定义检查脚本
- check: scripts/check-prerequisites.js
```

---

## 使用技能

### 命令行调用

```bash
# 基本调用
/skill-name

# 带参数
/skill-name file.js --option=value

# 多参数
/code-review src/index.js --focus=security --severity=error
```

### API 调用

```javascript
// 执行技能
const result = await skillSystem.execute("code-review", {
  file: "src/auth/login.js",
  focus: "security",
});

// 获取技能信息
const skill = await skillSystem.get("code-review");
console.log(skill.description);
console.log(skill.parameters);
```

---

## 创建自定义技能

### 1. 创建技能文件

```bash
# 在工作区创建
mkdir -p .chainlesschain/skills
touch .chainlesschain/skills/my-skill.md
```

### 2. 编写技能定义

```markdown
---
name: my-skill
description: 我的自定义技能
version: 1.0.0
---

# My Custom Skill

## 门控检查

- platform: ["darwin", "linux", "win32"]

## 参数

- `input` (required): 输入参数

## 工具

- Read
- Write
- Bash

## 提示词

你是一个专业的助手。请根据用户输入执行以下任务...
```

### 3. 测试技能

```bash
# 列出可用技能
/skills

# 执行技能
/my-skill input="test"
```

---

## 技能模板

### 文档生成技能

```markdown
---
name: generate-docs
description: 为代码生成文档
---

# Generate Documentation

## 工具

- Read
- Glob
- Write

## 提示词

分析提供的代码文件，生成详细的文档：

1. 模块概述
2. 函数/类说明
3. 参数和返回值
4. 使用示例
5. 注意事项

使用 JSDoc/TSDoc 格式生成注释。
```

### API 测试技能

```markdown
---
name: test-api
description: 测试 API 端点
---

# Test API

## 门控检查

- binary: curl

## 参数

- `url` (required): API URL
- `method` (optional): HTTP 方法 (GET|POST|PUT|DELETE)

## 工具

- Bash
- WebFetch

## 提示词

测试提供的 API 端点：

1. 发送请求
2. 分析响应
3. 验证状态码
4. 检查响应格式
5. 报告问题
```

---

## 技能管理

### 列出技能

```javascript
// 获取所有技能
const skills = await skillSystem.list();

// 按来源筛选
const bundled = await skillSystem.list({ source: "bundled" });
const workspace = await skillSystem.list({ source: "workspace" });
```

### 安装技能

```javascript
// 从 URL 安装
await skillSystem.install({
  url: "https://example.com/skills/my-skill.md",
  location: "managed", // 或 'workspace'
});

// 从本地文件安装
await skillSystem.install({
  path: "/path/to/skill.md",
  location: "workspace",
});
```

### 卸载技能

```javascript
// 卸载技能
await skillSystem.uninstall("my-skill");
```

### 更新技能

```javascript
// 更新技能
await skillSystem.update("my-skill");
```

---

## IPC 处理器

Skills 系统提供 17 个 IPC 处理器：

| 处理器              | 功能         |
| ------------------- | ------------ |
| `skills:list`       | 列出技能     |
| `skills:get`        | 获取技能详情 |
| `skills:execute`    | 执行技能     |
| `skills:install`    | 安装技能     |
| `skills:uninstall`  | 卸载技能     |
| `skills:update`     | 更新技能     |
| `skills:validate`   | 验证技能定义 |
| `skills:enable`     | 启用技能     |
| `skills:disable`    | 禁用技能     |
| `skills:getHistory` | 获取执行历史 |
| `skills:search`     | 搜索技能     |
| `skills:reload`     | 重新加载     |
| ...                 | ...          |

---

## 配置选项

```javascript
{
  "skills": {
    // 技能目录
    "directories": {
      "workspace": ".chainlesschain/skills",
      "managed": "~/.chainlesschain/skills"
    },

    // 自动加载
    "autoLoad": true,

    // 门控检查
    "gateChecks": {
      "enabled": true,
      "strict": false  // 严格模式下失败则禁用技能
    },

    // 执行限制
    "execution": {
      "timeout": 60000,  // 60秒超时
      "maxConcurrent": 3
    }
  }
}
```

---

## 最佳实践

### 1. 清晰的技能描述

```yaml
---
name: optimize-imports
description: 优化 JavaScript/TypeScript 文件的 import 语句，移除未使用的导入，排序并分组
---
```

### 2. 合理的工具限制

```markdown
## 工具

<!-- 只授予必要的工具权限 -->

- Read
- Glob
<!-- 不需要 Write，只分析不修改 -->
```

### 3. 详细的参数说明

```markdown
## 参数

- `file` (required): 要处理的文件路径
  - 支持 glob 模式
  - 示例: `src/**/*.ts`

- `style` (optional): 排序风格
  - `alphabetical`: 按字母排序（默认）
  - `grouped`: 按类型分组
```

---

## 下一步

- [Hooks系统](/chainlesschain/hooks) - 钩子扩展
- [Plan Mode](/chainlesschain/plan-mode) - 规划模式
- [Cowork系统](/chainlesschain/cowork) - 多智能体协作
- [Computer Use](/chainlesschain/computer-use) - 电脑操作能力
- [Remote Control](/chainlesschain/remote-control) - 远程控制系统

---

**50个内置技能 (100% Handler覆盖) + Agent Skills标准 + 统一工具注册表** 🛠️
