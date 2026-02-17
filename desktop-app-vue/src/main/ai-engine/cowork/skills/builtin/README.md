# Builtin Skills

此目录包含应用内置的技能。内置技能具有最低优先级，可以被 marketplace、managed（用户全局）或 workspace（项目级）技能覆盖。

## 当前内置技能 (90)

### 原有技能 (15)

| 技能                  | 类别        | Handler | 说明                                      |
| --------------------- | ----------- | ------- | ----------------------------------------- |
| code-review           | development | ✅      | 代码审查（多文件扫描、评分、建议）        |
| git-commit            | development | ✅      | Git 提交（diff分析、conventional commit） |
| explain-code          | learning    | ✅      | 代码讲解（函数提取、复杂度、依赖分析）    |
| browser-automation    | automation  | ✅      | 浏览器自动化（导航、点击、填表、截图）    |
| computer-use          | automation  | ✅      | 桌面操作控制（截图、鼠标键盘、视觉定位）  |
| workflow-automation   | automation  | ✅      | 工作流自动化（条件分支、循环、并行）      |
| web-scraping          | data        | ✅      | 网页数据采集（表格、链接、文本提取）      |
| data-analysis         | data        | ✅      | 数据分析（CSV/JSON处理、统计）            |
| memory-management     | knowledge   | ✅      | 永久记忆管理（保存、搜索、日记）          |
| smart-search          | knowledge   | ✅      | 智能搜索（向量+BM25混合搜索）             |
| remote-control        | remote      | ✅      | 远程设备控制（命令、文件、剪贴板）        |
| security-audit        | security    | ✅      | 代码安全审计（OWASP、密钥检测）           |
| devops-automation     | devops      | ✅      | DevOps自动化（CI/CD、Docker）             |
| test-generator        | development | ✅      | 测试生成（单元测试、Mock、覆盖率）        |
| performance-optimizer | development | ✅      | 性能优化（瓶颈识别、优化建议）            |

### 新增技能 v0.36.0 (15)

| 技能                  | 类别          | Handler | 说明                                      |
| --------------------- | ------------- | ------- | ----------------------------------------- |
| repo-map              | development   | ✅      | 代码库结构映射（AST符号索引、全局感知）   |
| refactor              | development   | ✅      | 多文件代码重构（重命名、提取、移动）      |
| doc-generator         | documentation | ✅      | 文档自动生成（JSDoc、API参考、序列图）    |
| api-tester            | testing       | ✅      | IPC/API测试（发现、生成、健康检查）       |
| onboard-project       | development   | ✅      | 项目入门分析（架构理解、快速上手指南）    |
| lint-and-fix          | development   | ✅      | Lint自动修复循环（ESLint→修复→重复）      |
| test-and-fix          | testing       | ✅      | 测试自动修复循环（运行→分析→修复→重复）   |
| dependency-analyzer   | analysis      | ✅      | 依赖分析（导入图、影响分析、CVE可达性）   |
| db-migration          | database      | ✅      | 数据库迁移（Schema检查、迁移脚本、漂移）  |
| project-scaffold      | development   | ✅      | 项目脚手架（模块/页面/技能的样板生成）    |
| env-doctor            | devops        | ✅      | 环境诊断（运行时、端口、服务健康检查）    |
| context-loader        | knowledge     | ✅      | 智能上下文预加载（意图分析、相关文件）    |
| vulnerability-scanner | security      | ✅      | 依赖漏洞扫描（CVE、可达性、SBOM、许可证） |
| release-manager       | devops        | ✅      | 发布管理（版本计算、Changelog、Tag）      |
| mcp-server-generator  | development   | ✅      | MCP服务器生成（从描述生成完整MCP服务器）  |

### 高级技能 v0.36.1 (10)

| 技能               | 类别        | Handler | 说明                                            |
| ------------------ | ----------- | ------- | ----------------------------------------------- |
| architect-mode     | development | ✅      | 架构模式（规划→审查→执行两阶段架构设计）        |
| bugbot             | testing     | ✅      | Bug扫描（16种模式、4级严重度、scan/diff/watch） |
| commit-splitter    | development | ✅      | 提交拆分（语义分组Git变更为原子提交）           |
| diff-previewer     | development | ✅      | Diff预览（Git差异解析、分支对比、变更统计）     |
| fault-localizer    | testing     | ✅      | 故障定位（堆栈解析、git blame交叉、修复建议）   |
| rules-engine       | development | ✅      | 规则引擎（加载/验证/应用项目编码规则）          |
| impact-analyzer    | analysis    | ✅      | 影响分析（导入图BFS、爆炸半径、测试映射）       |
| research-agent     | knowledge   | ✅      | 研究代理（库对比、错误解决、依赖评估）          |
| screenshot-to-code | development | ✅      | 截图转代码（图像分析→Vue/React/HTML生成）       |
| task-decomposer    | development | ✅      | 任务分解（复杂任务→子任务DAG、依赖分析）        |

### AI会话增强 + 开发效率 v0.36.2 (10)

| 技能                 | 类别        | Handler | 说明                                             |
| -------------------- | ----------- | ------- | ------------------------------------------------ |
| prompt-enhancer      | ai          | ✅      | 提示词增强（意图分析→上下文注入→提示词重写）     |
| codebase-qa          | knowledge   | ✅      | 代码库语义问答（文件索引、符号提取、关键词匹配） |
| auto-context         | ai          | ✅      | 智能上下文检测（文件评分、Token预算管理）        |
| multi-model-router   | ai          | ✅      | 多模型路由（复杂度评分→模型选择→成本优化）       |
| code-translator      | development | ✅      | 跨语言转换（JS↔TS、Python↔JS语法映射）           |
| dead-code-eliminator | development | ✅      | 死代码检测（未用导出/变量/文件、安全删除建议）   |
| changelog-generator  | development | ✅      | Changelog生成（Git commits→分类→Markdown）       |
| mock-data-generator  | development | ✅      | 模拟数据生成（Schema/类型→真实测试数据）         |
| git-history-analyzer | analysis    | ✅      | Git历史分析（热点/贡献者/流失率/耦合检测）       |
| i18n-manager         | development | ✅      | 国际化管理（字符串提取/翻译缺失/Locale生成）     |

### Office文档 + 音视频 v0.37.3 (10)

| 技能               | 类别     | Handler | 说明                                            |
| ------------------ | -------- | ------- | ----------------------------------------------- |
| pdf-toolkit        | document | ✅      | PDF处理（提取文本/合并/拆分/OCR/信息/水印）     |
| doc-converter      | document | ✅      | 万能格式转换（DOCX↔PDF↔MD↔HTML↔TXT）            |
| excel-analyzer     | document | ✅      | Excel深度分析（公式审计/数据验证/透视摘要）     |
| pptx-creator       | document | ✅      | 演示文稿生成（大纲/Markdown→PPTX, 4种主题）     |
| doc-comparator     | document | ✅      | 文档对比（文本差异/结构对比/相似度/LCS diff）   |
| audio-transcriber  | media    | ✅      | 语音转文字（Whisper API/本地, SRT/VTT/JSON）    |
| video-toolkit      | media    | ✅      | 视频操作（信息/缩略图/提取音频/压缩/裁剪/转换） |
| subtitle-generator | media    | ✅      | 字幕生成（SRT/VTT生成/转换/时间轴调整/翻译）    |
| tts-synthesizer    | media    | ✅      | 文本转语音（多语言/多引擎/文件朗读）            |
| media-metadata     | media    | ✅      | 媒体元数据（图片EXIF/音频/视频元信息/批量提取） |

### 图像+数据+工具 v0.37.4 (10)

| 技能              | 类别        | Handler | 说明                                                |
| ----------------- | ----------- | ------- | --------------------------------------------------- |
| image-editor      | media       | ✅      | 图片编辑（缩放/压缩/格式转换/缩略图/旋转/裁剪）     |
| ocr-scanner       | media       | ✅      | OCR文字识别（多语言/批量/置信度/Tesseract.js）      |
| image-generator   | ai          | ✅      | AI图像生成（文生图/增强/锐化/降噪/放大）            |
| chart-creator     | data        | ✅      | 数据可视化（折线/柱状/饼图/散点/雷达/漏斗/ECharts） |
| word-generator    | document    | ✅      | Word文档生成（Markdown→DOCX/模板/读取/docx库）      |
| csv-processor     | data        | ✅      | CSV数据处理（读取/分析/过滤/排序/转换/合并）        |
| template-renderer | development | ✅      | 模板渲染（Handlebars/变量替换/条件循环/批量生成）   |
| code-runner       | development | ✅      | 代码执行（Python/JS/Bash/超时控制/输出捕获）        |
| voice-commander   | automation  | ✅      | 语音命令（命令注册/宏定义/命令链/上下文感知）       |
| file-compressor   | utility     | ✅      | 文件压缩（ZIP创建/解压/文件列表/压缩率分析）        |

### 开发效率+系统工具 v0.37.5 (10)

| 技能              | 类别        | Handler | 说明                                                   |
| ----------------- | ----------- | ------- | ------------------------------------------------------ |
| json-yaml-toolkit | development | ✅      | JSON/YAML处理（格式化/验证/转换/JSONPath/Diff/Schema） |
| regex-playground  | development | ✅      | 正则工具（测试/替换/解释/模式库/文件提取）             |
| log-analyzer      | devops      | ✅      | 日志分析（解析/过滤/错误提取/统计/模式搜索）           |
| system-monitor    | devops      | ✅      | 系统监控（CPU/内存/磁盘/进程/网络/健康评分）           |
| http-client       | development | ✅      | HTTP客户端（GET/POST/PUT/DELETE/认证/自定义头）        |
| markdown-enhancer | document    | ✅      | Markdown增强（TOC/统计/链接检查/Lint/表格/HTML）       |
| snippet-library   | development | ✅      | 代码片段库（保存/搜索/标签/导入导出/模板）             |
| knowledge-graph   | knowledge   | ✅      | 知识图谱（实体提取/关系发现/中心性分析/导出）          |
| clipboard-manager | utility     | ✅      | 剪贴板管理（读写/历史/搜索/置顶/敏感过滤）             |
| env-file-manager  | devops      | ✅      | 环境变量管理（解析/对比/缺失检测/模板/安全检查）       |

### 系统+安全+设计+分析 v0.37.6 (10)

| 技能                 | 类别      | Handler | 说明                                                   |
| -------------------- | --------- | ------- | ------------------------------------------------------ |
| backup-manager       | system    | ✅      | 数据备份（ZIP创建/恢复/清理/信息/定时建议/archiver）   |
| query-enhancer       | knowledge | ✅      | RAG查询优化（多查询/HyDE/分解/扩展/分析）              |
| memory-insights      | knowledge | ✅      | 知识库分析（概览/健康评分/关键词/趋势/知识空白）       |
| data-exporter        | data      | ✅      | 多格式导出（JSON↔CSV↔MD↔HTML↔TSV/批量/格式检测）       |
| crypto-toolkit       | security  | ✅      | 加密工具（哈希/HMAC/AES-256-GCM/编解码/UUID/随机数）   |
| network-diagnostics  | devops    | ✅      | 网络诊断（Ping/DNS/端口检测/扫描/Traceroute/HTTP检查） |
| password-generator   | security  | ✅      | 密码生成（随机密码/口令/PIN/Token/UUID/强度检测）      |
| text-transformer     | utility   | ✅      | 文本转换（Base64/URL/HTML编解码/哈希/大小写/Slug）     |
| color-picker         | design    | ✅      | 颜色工具（HEX↔RGB↔HSL/调色板/WCAG对比度/明暗调节）     |
| performance-profiler | devops    | ✅      | 性能分析（快照/基准测试/内存分析/启动时间/报告）       |

## 目录结构

每个技能是一个独立的子目录，包含 `SKILL.md` 文件和 `handler.js`（100% Handler 覆盖率）：

```
builtin/
├── README.md
├── code-review/
│   ├── SKILL.md
│   └── handler.js
├── browser-automation/
│   ├── SKILL.md
│   └── handler.js
└── ...（共90个技能目录）
```

## SKILL.md 格式 (Agent Skills Open Standard)

```markdown
---
name: example-skill
display-name: Example Skill
description: A brief description of the skill
version: 1.0.0
category: general
user-invocable: true
tags: [example, demo]
capabilities: [example_task]
tools:
  - tool_name_1
  - tool_name_2
instructions: |
  Detailed instructions for AI on when and how to use this skill.
examples:
  - input: "/example-skill arg1"
    output: "Expected result description"
dependencies: [other-skill]
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types: [.txt, .md]
---

# Detailed Usage Instructions

Write detailed instructions here in Markdown format.
```

## 技能层级优先级

| 层级        | 目录                                | 优先级   |
| ----------- | ----------------------------------- | -------- |
| bundled     | `skills/builtin/`                   | 0 (最低) |
| marketplace | marketplace 安装的技能              | 1        |
| managed     | `~/.chainlesschain/skills/`         | 2        |
| workspace   | `<project>/.chainlesschain/skills/` | 3 (最高) |

同名技能会被高优先级层级覆盖。

## Handler 契约

```javascript
module.exports = {
  async init(skill) {
    // 初始化（可选），skill 为 MarkdownSkill 实例
  },
  async execute(task, context, skill) {
    // 执行技能逻辑
    // task: { action, params, ... }
    // context: 执行上下文
    // skill: MarkdownSkill 实例
    return { success: true, result: ... };
  }
};
```
