# Skill Creator 系统 (v1.2.0)

> 内置系统技能，用于创建、测试、优化和验证自定义技能。v1.2.0 新增 LLM 驱动的描述优化循环。

## 概述

Skill Creator 是 ChainlessChain 内置的系统级技能（category: system），用于创建、测试、优化和验证自定义 AI 技能。它遵循 Agent Skills 开放标准，自动生成包含 YAML frontmatter 的 `SKILL.md` 声明文件和 `handler.js` 执行逻辑。v1.2.0 新增 LLM 驱动的描述优化循环（`optimize-description`），通过自动生成评估查询集、迭代改写描述、评分对比的闭环流程，持续提升技能的触发精度。

## 核心特性

- **一键生成技能骨架** — 从名称和描述自动生成标准 `SKILL.md` + `handler.js`，自动推断 6 种 category
- **LLM 驱动描述优化** — `optimize-description` 自动生成 20 条 eval 查询集，通过训练集/测试集闭环迭代提升触发精度
- **静态描述检查** — `optimize` 快速启发式检查：长度、触发词、冗余等问题秒级反馈
- **技能验证** — `validate` 检查 SKILL.md frontmatter 必填字段 + handler.js 可加载性与导出规范
- **测试执行** — `test` 直接调用 handler.js 的 `execute()` 并展示结果，支持快速迭代
- **内置模板库** — 5 种模板（basic / multi-action / api-integration / file-processor / code-analyzer），覆盖常见技能类型
- **60/40 数据集分割** — eval 查询集 60% 用于训练、40% 用于测试，防止描述过拟合训练集
- **workspace 层隔离写入** — 生成文件仅写入 `~/.chainlesschain/skills/`，不影响 bundled 或 marketplace 层
- **`_deps` 注入模式** — 生成的 handler.js 通过 `_deps` 对象管理外部依赖，测试时可完全 mock

## 系统架构

### 技能创建流水线

```
用户输入 → parseInput() 解析意图
  → 匹配动作 (create/test/optimize/validate/...)
  → [create] 推断 category → 选择内置模板 → 生成 SKILL.md + handler.js → 写入 workspace 层
  → [test] 加载目标 handler.js → 执行 execute() → 返回结果
  → [validate] 检查 SKILL.md frontmatter 必填字段 + handler.js 可加载性
```

### optimize-description 优化循环

```
读取 SKILL.md description
  → callLLM() 生成 20 条 eval 查询（10 应触发 / 10 不应触发）
  → 60/40 分割为训练集 / 测试集
  → evaluateDescriptionDetailed() 在测试集上评估基线分
  → 迭代（最多 N 次）:
      → 在训练集找出失败案例
      → improveDescription() 由 LLM 改写描述
      → 测试集重新评分，更高则记录为最优
  → 写回 SKILL.md（仅在有改进时）
  → 保存结果至 <skillDir>/.opt-workspace/results.json
```

LLM 调用通过 `callLLM()` 桥接，内部使用 `spawnSync` 调用 `chainlesschain ask` 命令，因此依赖 CLI 运行环境。

## 故障排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 创建技能时返回已有内容 | 同名技能目录已存在 | 设计预期行为，不会覆盖已有技能。若需重建，先 `skill remove <name>` 再重新创建 |
| `optimize-description` 返回提示信息而非优化结果 | LLM 不可用（Ollama 未启动、API Key 未配置等） | 确保 `chainlesschain ask "test"` 能正常返回结果；检查 Ollama 服务或云端 provider 配置 |
| `optimize-description` 生成 eval 查询不足 | LLM 返回的查询数 < 4 条 | 检查当前模型能力，尝试切换到更大的模型；或手动执行 `optimize`（静态检查）替代 |
| `validate` 报缺少必填字段 | SKILL.md frontmatter 缺少 `name`、`description` 或 `handler` | 补全 YAML frontmatter 中的必填字段 |
| `validate` 报 handler.js 加载失败 | handler.js 存在语法错误或 `require()` 依赖缺失 | 在 Node.js 中直接 `require("./handler.js")` 排查具体错误 |
| 中途 LLM 调用失败 | 网络超时或服务中断 | 循环自动终止，写回当前最优描述（非原始描述）；可再次运行继续优化 |

## 安全考虑

| 方面 | 说明 |
|------|------|
| 文件写入范围 | 技能文件仅写入 workspace 层（`~/.chainlesschain/skills/`），不触碰 bundled 或系统目录 |
| 文件系统访问 | handler.js 通过 `_deps` 注入 `fs` 模块，测试时可完全替换为 mock，生产环境受限于 Node.js 进程权限 |
| LLM 调用 | 遵循用户当前 provider 配置（本地 Ollama 或云端），不额外发起未授权的网络请求 |
| 生成的 handler.js | 在 Agent sandbox 环境中执行，受 Plan Mode 和 Permission Gate 约束 |
| 敏感数据 | 技能描述通过 LLM 优化时仅传递技能名称和描述文本，不包含用户私有数据 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/SKILL.md` | 技能声明文件（YAML frontmatter + 使用说明） |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js` | 核心执行逻辑：parseInput、create/test/optimize/validate 等全部动作处理 |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-loader.js` | 技能加载器，四层加载机制（bundled → marketplace → managed → workspace） |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/index.js` | 技能注册表入口，管理技能生命周期 |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/__tests__/v1.2.0-skill-creator.test.js` | 单元测试（50 tests，_deps 注入 mock） |
| `packages/cli/__tests__/integration/skill-creator-handler.test.js` | 集成测试（12 tests，跨模块生命周期验证） |
| `packages/cli/__tests__/e2e/skill-creator-commands.test.js` | E2E 测试（14 tests，完整 CLI 命令行验证） |

## 快速开始

```bash
# 创建一个新技能
chainlesschain skill run skill-creator "create my-skill \"搜索笔记并生成摘要\""

# 测试技能
chainlesschain skill run skill-creator "test my-skill 搜索示例"

# 验证技能完整性
chainlesschain skill run skill-creator "validate my-skill"

# 优化技能描述（LLM 驱动，v1.2.0）
chainlesschain skill run skill-creator "optimize-description my-skill"
```

## 功能概览

| 动作 | 说明 |
|------|------|
| `create` | 生成技能骨架（SKILL.md + handler.js） |
| `test` | 执行技能的 handler.js 并展示结果 |
| `optimize` | 静态检查描述质量（快速启发式） |
| `optimize-description` | LLM 驱动迭代优化，自动提升触发精度 |
| `validate` | 检查技能文件完整性和格式 |
| `list-templates` | 列出所有内置模板 |
| `get-template` | 获取指定模板内容 |

## create — 创建技能

从名称和描述生成 `SKILL.md` + `handler.js` 骨架文件。

```bash
chainlesschain skill run skill-creator "create my-skill \"做某件事的技能\""
```

- 自动推断 `category`（knowledge / automation / development / system / media / productivity）
- 若技能目录已存在，返回现有内容而不覆盖

生成的文件结构：

```
~/.chainlesschain/skills/my-skill/
├── SKILL.md       # 技能声明（YAML frontmatter + 描述）
└── handler.js     # 执行逻辑（导出 execute() + init()）
```

## test — 测试技能

调用技能的 `handler.js` 并展示执行结果：

```bash
chainlesschain skill run skill-creator "test smart-search 搜索示例"
```

## optimize — 快速优化（静态）

静态检查 `SKILL.md` 的 `description` 字段：

```bash
chainlesschain skill run skill-creator "optimize code-review"
```

检查规则：
- 长度 < 50 字符 → 建议补充触发场景
- 缺少 `use when` / `trigger` 关键词 → 建议添加触发语句
- 长度 > 200 字符 → 建议精简

## optimize-description — LLM 优化循环（v1.2.0 新增）

使用 LLM 自动迭代优化技能描述，使触发精度最大化：

```bash
# 默认 5 次迭代
chainlesschain skill run skill-creator "optimize-description code-review"

# 指定迭代次数
chainlesschain skill run skill-creator "optimize-description code-review --iterations 3"

# 通过 --advanced 标志触发（等价）
chainlesschain skill run skill-creator "optimize code-review --advanced"
chainlesschain skill run skill-creator "optimize code-review --advanced --iterations 3"
```

### 优化流程

1. **生成 eval 查询集**：LLM 生成 20 条真实用户请求（10 应触发 / 10 不应触发）
2. **60/40 分割**：前 60% 为训练集，后 40% 为测试集（防止过拟合）
3. **评估基线分**：在测试集上评估当前描述的触发准确率
4. **迭代优化**（最多 N 次）：
   - 在训练集找出失败案例
   - 若全部正确 → 提前终止
   - LLM 根据失败案例改写描述
   - 测试集重新评分，更高则记录为最优
5. **写回 SKILL.md**：仅在有改进时替换 `description` 字段
6. **保存结果**：输出至 `<skillDir>/.opt-workspace/results.json`

### 降级处理

| 场景 | 行为 |
|------|------|
| LLM 不可用 | 返回提示信息，建议通过 CLI 运行 |
| eval 生成失败（< 4 条） | 同上 |
| 中途 LLM 失败 | 停止迭代，写回当前最优描述 |
| 描述已是最优 | 不更新 SKILL.md，报告"already optimal" |

> **注意**：`optimize-description` 仅在 `chainlesschain skill run` 上下文中可用（需要 CLI 环境调用 `chainlesschain ask`）。

## validate — 验证技能

检查技能目录完整性和格式：

```bash
chainlesschain skill run skill-creator "validate ultrathink"
```

检查项：
- `SKILL.md` 存在且包含 YAML frontmatter
- 包含 `name`、`description`、`handler` 必填字段
- `handler.js` 存在且可正常 `require()`
- `handler.js` 导出 `execute()` 和 `init()` 函数

## list-templates / get-template — 内置模板

```bash
chainlesschain skill run skill-creator "list-templates"
chainlesschain skill run skill-creator "get-template basic"
chainlesschain skill run skill-creator "get-template api-integration"
```

| 模板名 | 说明 |
|--------|------|
| `basic` | 最简技能骨架，单动作结构 |
| `multi-action` | 多动作任务追踪器（create/list/complete/stats） |
| `api-integration` | REST API 调用，含 `_deps` 注入和认证处理 |
| `file-processor` | Markdown 文件分析，含 `_deps.fs` 注入 |
| `code-analyzer` | 纯正则表达式代码复杂度分析 |

## 使用示例

### 完整技能开发生命周期

```bash
# 1. 创建新技能
chainlesschain skill run skill-creator "create smart-search \"搜索笔记并生成摘要，当用户询问笔记内容或需要知识检索时触发\""
# → 生成 ~/.chainlesschain/skills/smart-search/SKILL.md + handler.js

# 2. 验证技能文件完整性
chainlesschain skill run skill-creator "validate smart-search"
# → 检查 name/description/handler 字段、handler.js 可加载性和导出规范

# 3. 测试技能执行
chainlesschain skill run skill-creator "test smart-search 搜索关于 TypeScript 的笔记"
# → 直接调用 handler.js execute()，展示实际输出

# 4. 快速检查描述质量（静态）
chainlesschain skill run skill-creator "optimize smart-search"
# → 检查描述长度、触发词、冗余等问题

# 5. LLM 驱动精细优化（v1.2.0）
chainlesschain skill run skill-creator "optimize-description smart-search"
# → 生成 20 条 eval 查询集，迭代 5 次优化描述触发精度
# → 结果保存至 ~/.chainlesschain/skills/smart-search/.opt-workspace/results.json
```

### 使用内置模板创建不同类型技能

```bash
# 查看所有内置模板
chainlesschain skill run skill-creator "list-templates"

# 获取 API 集成模板（含 _deps 注入和认证处理）
chainlesschain skill run skill-creator "get-template api-integration"

# 获取多动作模板（含 create/list/complete/stats 动作结构）
chainlesschain skill run skill-creator "get-template multi-action"
```

### 限定迭代次数的描述优化

```bash
# 快速优化（3 次迭代，适合简单技能）
chainlesschain skill run skill-creator "optimize-description code-review --iterations 3"

# 深度优化（10 次迭代，适合触发场景复杂的技能）
chainlesschain skill run skill-creator "optimize-description code-review --iterations 10"

# 通过 --advanced 标志触发（等价于 optimize-description）
chainlesschain skill run skill-creator "optimize code-review --advanced --iterations 5"
```

### 批量验证多个技能

```bash
# 在 Agent 模式下批量操作
chainlesschain agent
# > 验证 smart-search、code-review、data-analyzer 三个技能的完整性
# > 对所有描述长度不足 80 字符的技能运行 optimize-description
```

## 相关命令

```bash
# 查看所有已安装技能
chainlesschain skill list

# 在 skill run 之外创建/删除自定义技能
chainlesschain skill add my-skill
chainlesschain skill remove my-skill

# 列出技能层路径
chainlesschain skill sources
```

## 配置参考

Skill Creator 作为 bundled 系统技能，通过 `.chainlesschain/config.json` 读取 LLM 配置：

```javascript
{
  "llm": {
    "provider": "ollama",           // 用于 optimize-description 的 LLM provider
    "model": "qwen2:7b",            // 用于生成 eval 查询集和改写描述
    "ollamaHost": "http://localhost:11434"
  },
  "skillCreator": {
    "defaultIterations": 5,         // optimize-description 默认迭代次数
    "evalQueryCount": 20,           // 生成 eval 查询集的数量（10 正 + 10 负）
    "trainTestSplitRatio": 0.6,     // 训练集比例（剩余为测试集）
    "workspaceDir": "~/.chainlesschain/skills",  // 技能写入目录
    "optWorkspaceSubdir": ".opt-workspace"       // 优化结果子目录
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `llm.provider` | string | `"ollama"` | optimize-description 使用的 LLM provider |
| `llm.model` | string | 当前活跃模型 | 用于生成 eval 查询集和改写描述 |
| `skillCreator.defaultIterations` | number | `5` | optimize-description 默认最大迭代次数 |
| `skillCreator.evalQueryCount` | number | `20` | 每次生成的 eval 查询数量 |
| `skillCreator.trainTestSplitRatio` | number | `0.6` | 训练集占 eval 查询的比例 |
| `skillCreator.workspaceDir` | string | `"~/.chainlesschain/skills"` | 技能文件写入目录 |

## 性能指标

以下数据来自本地基准测试（配置：Ollama qwen2:7b，Core i7，16GB RAM）：

### 各动作执行耗时

| 动作 | 平均耗时 | 说明 |
|------|----------|------|
| `create` | < 1s | 模板渲染 + 文件写入，无 LLM 调用 |
| `validate` | < 100ms | 文件系统检查 + `require()` 验证 |
| `test` | 依赖 handler | 调用目标 handler.js `execute()`，耗时取决于技能本身 |
| `optimize`（静态） | < 100ms | 纯字符串分析，无 LLM 调用 |
| `list-templates` | < 50ms | 返回内置模板列表 |

### optimize-description 优化耗时

| 迭代次数 | eval 查询数 | LLM 模型 | 平均总耗时 |
|----------|-------------|---------|------------|
| 3 次 | 20 条 | qwen2:7b | 45–90s |
| 5 次（默认） | 20 条 | qwen2:7b | 75–150s |
| 10 次 | 20 条 | qwen2:7b | 150–300s |
| 5 次 | 20 条 | claude-3-haiku | 20–40s |

### 描述优化效果

| 场景 | 优化前准确率 | 优化后准确率 | 提升 |
|------|--------------|--------------|------|
| 描述过短（< 50 字符） | 55–65% | 80–90% | +20–30% |
| 缺少触发场景描述 | 60–70% | 82–92% | +15–25% |
| 描述已较完整 | 80–85% | 85–92% | +5–10% |

## 测试覆盖

| 层次 | 测试数 |
|------|--------|
| 单元测试 | 50 |
| 集成测试 | 12 |
| E2E 测试 | 14 |
| **合计** | **76** |

## 相关文档

- [技能系统 (skill)](./cli-skill) — 技能层、加载机制、`skill run` 完整说明
- [设计文档 — 模块 76](../design/modules/76-skill-creator) — 内部实现架构
