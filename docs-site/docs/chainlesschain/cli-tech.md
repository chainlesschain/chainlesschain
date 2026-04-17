# 技术学习引擎 (tech)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔍 **技术栈分析**: 解析 package.json / requirements.txt / Cargo.toml / go.mod 等清单文件
- 🐛 **反模式检测**: 5 种启发式反模式扫描（大函数、深嵌套、硬编码密钥等）
- 📝 **实践记录**: 记录和管理技术实践经验（语言/框架/库/数据库/工具/模式）
- 🎯 **智能推荐**: 基于分析的技术栈匹配已有实践经验，生成推荐

## 概述

ChainlessChain CLI 技术学习引擎（Phase 62）帮助开发者分析项目技术栈、检测代码反模式、积累实践经验。`analyze` 解析项目目录中的依赖清单文件，识别语言、框架、数据库、工具，`detect` 对单个文件做反模式启发式扫描，`practice` 记录学到的技术实践，`recommend` 将已有实践与当前技术栈匹配推荐。

## 命令参考

### tech types — 目录信息

```bash
chainlesschain tech types
chainlesschain tech types --json
```

列出系统支持的技术类型（language / framework / library / database / tool / pattern）、实践级别和反模式种类。

### tech analyze — 技术栈分析

```bash
chainlesschain tech analyze
chainlesschain tech analyze /path/to/project --json
```

分析项目目录的技术栈。自动解析以下清单文件：

| 文件 | 识别内容 |
|------|---------|
| `package.json` | Node.js 依赖、框架（Vue/React/Express 等） |
| `requirements.txt` | Python 依赖、框架（Django/FastAPI 等） |
| `Cargo.toml` | Rust 依赖 |
| `go.mod` | Go 模块依赖 |

输出包含：语言列表、框架列表、数据库列表、工具列表、总依赖数。未指定路径时使用当前工作目录。

### tech profile — 查看缓存画像

```bash
chainlesschain tech profile
chainlesschain tech profile /path/to/project --json
```

显示上次 `analyze` 的缓存结果。若未分析过会提示先运行 `tech analyze`。

### tech detect — 反模式检测

```bash
chainlesschain tech detect <file>
chainlesschain tech detect src/main/index.js --json
```

对单个文件执行反模式启发式检测。返回：

| 反模式 | 说明 |
|--------|------|
| 大函数 | 函数体过长 |
| 深嵌套 | 嵌套层级过深 |
| 硬编码密钥 | 疑似硬编码 API Key / Secret |
| 过长文件 | 文件行数过多 |
| 过多参数 | 函数参数过多 |

每个发现包含类型、严重程度和详情。

### tech practice — 记录实践

```bash
chainlesschain tech practice <tech-type> <tech-name> <pattern> <level>
chainlesschain tech practice language typescript "strict-mode" advanced -d "始终启用 strict" -s 0.9
chainlesschain tech practice framework vue "composition-api" intermediate --source auto --json
```

记录一条技术实践经验：

| 参数 | 说明 |
|------|------|
| `tech-type` | 技术类型: language / framework / library / database / tool / pattern |
| `tech-name` | 技术名称（如 typescript, vue, postgresql） |
| `pattern` | 模式名称（如 strict-mode, composition-api） |
| `level` | 实践级别 |
| `-d` | 描述文本 |
| `-s` | 分数 0~1 |
| `--source` | 来源标签（默认 manual） |

### tech practices — 列出实践

```bash
chainlesschain tech practices
chainlesschain tech practices -t language -n typescript -l advanced --limit 20 --json
```

列出已记录的实践。`-t` 按技术类型过滤，`-n` 按技术名称过滤，`-l` 按级别过滤。

### tech recommend — 推荐实践

```bash
chainlesschain tech recommend
chainlesschain tech recommend --limit 10 --json
```

基于最近一次 `analyze` 的技术栈，匹配已有实践经验并推荐。需要先运行 `tech analyze` 建立画像，且已有 `practice` 记录。

## 系统架构

```
用户命令 → tech.js (Commander) → tech-learning-engine.js
                                        │
             ┌──────────────────────────┼──────────────────────┐
             ▼                          ▼                      ▼
        栈分析                     反模式检测               实践管理
  (清单文件解析)              (启发式扫描)           (record/list/recommend)
             ▼                          ▼                      ▼
     tech_profiles               findings[]              tech_practices
```

## 配置参考

```bash
# tech analyze / profile
[path]                         # 项目路径 (默认 cwd)

# tech detect
<file>                         # 要检测的文件路径（必填）

# tech practice
<tech-type>                    # 技术类型（必填）
<tech-name>                    # 技术名称（必填）
<pattern>                      # 模式名称（必填）
<level>                        # 实践级别（必填）
-d, --description <text>       # 描述
-s, --score <n>                # 分数 0~1
--source <tag>                 # 来源标签 (默认 manual)

# tech practices
-t, --type <type>              # 按技术类型过滤
-n, --name <name>              # 按技术名称过滤
-l, --level <level>            # 按级别过滤
--limit <n>                    # 最大条目数 (默认 50)

# 通用
--json                         # JSON 输出
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/tech.js` | tech 命令主入口 |
| `packages/cli/src/lib/tech-learning-engine.js` | 清单解析、反模式启发式、实践存储、推荐匹配核心实现 |

## 测试

```bash
cd packages/cli
npx vitest run __tests__/unit/tech-learning-engine.test.js
# 43 tests, all pass
```

## 使用示例

### 场景：技术栈分析与知识积累

```bash
# 1. 分析当前项目技术栈
chainlesschain tech analyze .

# 2. 查看分析结果
chainlesschain tech profile --json

# 3. 检测代码反模式
chainlesschain tech detect src/main/index.js

# 4. 记录最佳实践
chainlesschain tech practice language typescript "strict-mode" advanced -d "始终启用严格模式"
chainlesschain tech practice framework vue "composition-api" intermediate -d "优先使用组合式 API"
chainlesschain tech practice database postgresql "index-strategy" advanced -d "复合索引优先"

# 5. 查看已积累的实践
chainlesschain tech practices -t language

# 6. 获取推荐
chainlesschain tech recommend
```

## 相关文档

- [安全加固](./cli-hardening) — 安全审计与性能基线
- [合规管理](./cli-compliance) — 合规扫描与框架报告
- [进化引擎](./cli-evolution) — 系统演化与自学习
