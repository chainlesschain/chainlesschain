# CLI-Anything 集成设计

**版本**: v5.0.1
**创建日期**: 2026-03-14
**状态**: ✅ 已实现

---

## 一、模块概述

### 1.1 背景

[CLI-Anything](https://github.com/HKUDS/CLI-Anything)（GitHub 11.8k+ Stars）是一个 Python 工具，能为任意桌面软件自动生成 Agent 可控的 CLI 接口。ChainlessChain 已有 4 层 skill 体系（bundled / marketplace / managed / workspace）和 Agent REPL，整合后 Agent 可直接调用任意外部软件。

### 1.2 设计目标

| 目标              | 描述                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| **零侵入集成**    | 不修改 skill-loader.js 或 agent-repl.js，完全复用现有 4 层扫描机制   |
| **scan 而非 generate** | ChainlessChain 只负责发现和注册已生成的工具，不直接调用 CLI-Anything 流水线 |
| **managed 层注册** | 技能放在 `<userData>/skills/`，优先级适中，不覆盖 bundled/marketplace |
| **可测试性**       | `_deps` 注入模式，纯 JS 无原生依赖，56 个测试覆盖                   |

---

## 二、技术架构

### 2.1 模块结构

```
packages/cli/
├── src/
│   ├── commands/cli-anything.js    # Commander 命令（5 子命令）
│   └── lib/cli-anything-bridge.js  # 核心桥接库
├── __tests__/
│   ├── unit/cli-anything-bridge.test.js        # 32 单��测试
│   ├── integration/cli-anything-workflow.test.js # 11 集成测试
│   └── e2e/cli-anything-commands.test.js        # 13 端到端测试
```

### 2.2 数据库表

```sql
CREATE TABLE IF NOT EXISTS cli_anything_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  software_path TEXT,
  cli_command TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  description TEXT,
  subcommands TEXT,          -- JSON array
  skill_name TEXT,
  status TEXT DEFAULT 'discovered',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)
```

### 2.3 集成流程

```
CLI-Anything 生成 cli-anything-<name>
        ↓
chainlesschain cli-anything scan → 发现 PATH 中 cli-anything-* 工具
        ↓
chainlesschain cli-anything register <name>
  ├── 解析 cli-anything-<name> --help
  ├── 生成 <userData>/skills/cli-anything-<name>/SKILL.md
  ├── 生成 <userData>/skills/cli-anything-<name>/handler.js
  └── 写入 cli_anything_tools 表
        ↓
Agent REPL → run_skill("cli-anything-<name>", "subcommand args")
  → handler.js → execSync("cli-anything-<name> subcommand args")
  → JSON/text 结果返回 LLM
```

---

## 三、CLI 命令

| 子命令       | 参数      | 选项              | 说明                          |
| ------------ | --------- | ----------------- | ----------------------------- |
| `doctor`     | 无        | `--json`          | 检测 Python + CLI-Anything 环境 |
| `scan`       | 无        | `--json`          | 扫描 PATH 中 cli-anything-* 工具 |
| `register`   | `<name>`  | `--force --json`  | 注册为 ChainlessChain 技能    |
| `list`       | 无        | `--json`          | 列出已注册工具（默认子命令）  |
| `remove`     | `<name>`  | `--json`          | 移除已注册工具                |

---

## 四、核心 API

### 4.1 cli-anything-bridge.js 导出

| 函数                           | 用途                                                    |
| ------------------------------ | ------------------------------------------------------- |
| `ensureCliAnythingTables(db)`  | 建表（幂等）                                            |
| `detectPython()`               | 检测 python3/python/py，返回 `{ found, command, version }` |
| `detectCliAnything()`          | 检测 CLI-Anything 是否已安装                            |
| `installCliAnything(pythonCmd)` | `pip install cli-anything`                              |
| `scanPathForTools()`           | 扫描 PATH 中 `cli-anything-*` 可执行文件                |
| `parseToolHelp(command)`       | 解析 `--help` 输出为 `{ description, subcommands[] }`   |
| `registerTool(db, name, opts)` | 生成 SKILL.md + handler.js → managed 层                 |
| `removeTool(db, name)`         | 删除 skill 目录 + DB 记录                               |
| `listTools(db)`                | 查询已注册工具列表                                      |
| `_generateSkillMd(name, help)` | 生成 SKILL.md 内容                                      |
| `_generateHandlerJs(name, cmd)` | 生成 handler.js 内容                                   |

### 4.2 生成的 handler.js 模板

```javascript
const { execSync } = require("child_process");
module.exports = {
  async execute(task, context) {
    const input = (task?.params?.input || task?.action || "").trim();
    if (!input) return { success: false, error: "No input provided" };
    try {
      const output = execSync(`<command> ${input}`, {
        encoding: "utf-8", timeout: 60000,
        cwd: context?.projectRoot || process.cwd(),
      });
      let result;
      try { result = JSON.parse(output); } catch (_e) { result = { output: output.trim() }; }
      return { success: true, result, message: "Completed" };
    } catch (err) {
      return { success: false, error: err.stderr?.toString("utf8") || err.message };
    }
  },
};
```

---

## 五、测试覆盖

| 测试类型 | 文件                                  | 测试数 | 覆盖范围                                    |
| -------- | ------------------------------------- | ------ | ------------------------------------------- |
| 单元测试 | `cli-anything-bridge.test.js`         | 32     | 所有导出函数，成功/失败路径，边缘情况       |
| 集成测试 | `cli-anything-workflow.test.js`       | 11     | 完整 register→list→remove 生命周期，MockDB  |
| 端到端   | `cli-anything-commands.test.js`       | 13     | CLI 二进制调用，help/doctor/scan/list/remove |
| **合计** |                                       | **56** |                                             |

---

## 六、设计决策

1. **managed 层注册**：技能放在 `<userData>/skills/`，4 层优先级中位于第 3 层，不覆盖内置技能
2. **不修改 skill-loader.js**：完全复用现有扫描机制，新注册的技能自动被发现
3. **不修改 agent-repl.js**：Agent 的 `run_skill` 工具已支持动态发现
4. **`_deps` 注入**：遵循项目 Vitest CJS mock 模式，支持纯 mock 测试
5. **scan 而非 generate**：ChainlessChain 不调用 CLI-Anything 的 7 阶段生成流水线，只负责发现和注册
6. **help 解析**：简单正则解析 `--help` 输出，提取描述和子命令列表，容错处理
