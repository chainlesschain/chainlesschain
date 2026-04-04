# Skill Creator 系统 (v1.2.0)

> 内置系统技能，用于创建、测试、优化和验证自定义技能。v1.2.0 新增 LLM 驱动的描述优化循环。

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
