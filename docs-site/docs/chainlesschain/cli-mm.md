# 多模态协作 CLI（Phase 27）

> `chainlesschain mm` — 多模态输入融合、上下文构建与输出生成。
>
> 5 种模态 + 加权融合 + 原生文档解析 + 4000-token 上下文上限 + 6 种输出格式。

---

## 目录

- [概述](#概述)
- [目录/枚举](#目录枚举)
- [会话管理](#会话管理)
- [模态输入](#模态输入)
- [文档解析](#文档解析)
- [上下文构建](#上下文构建)
- [输出生成](#输出生成)
- [工件查看](#工件查看)
- [统计](#统计)

---

## 概述

多模态协作模块允许在一个会话中混合文本、代码、图像描述、音频转录和
结构化数据等多种输入，通过加权融合生成统一上下文，再以多种格式输出。

支持的 5 种模态：`text`、`code`、`image`、`audio`、`structured`。
支持的 7 种文档格式：`txt`、`md`、`csv`、`json`、`xml`、`yaml`、`html`。
支持的 6 种输出格式：`summary`、`report`、`code`、`analysis`、`presentation`、`qa`。

---

## 目录/枚举

```bash
chainlesschain mm modalities       # 列出 5 种模态及权重
chainlesschain mm input-formats    # 列出 7 种支持的文档格式
chainlesschain mm output-formats   # 列出 6 种输出格式
chainlesschain mm statuses         # 列出会话状态
```

---

## 会话管理

```bash
# 创建多模态会话
chainlesschain mm session-create --name "项目分析"

# 查看会话详情
chainlesschain mm session-show <session-id>

# 列出所有会话
chainlesschain mm sessions
chainlesschain mm sessions --json

# 标记会话完成
chainlesschain mm session-complete <session-id>

# 删除会话及所有工件
chainlesschain mm session-delete <session-id>
```

---

## 模态输入

```bash
# 添加文本模态
chainlesschain mm add <session-id> --modality text --content "项目需求说明..."

# 添加代码模态
chainlesschain mm add <session-id> --modality code --content "function hello() { return 'world'; }"

# 添加结构化数据
chainlesschain mm add <session-id> --modality structured --file ./data.json

# 列出会话中已添加的模态
chainlesschain mm modalities-of <session-id>

# 加权融合所有输入
chainlesschain mm fuse <session-id>
```

---

## 文档解析

```bash
# 解析文档（支持 txt/md/csv/json/xml/yaml/html）
chainlesschain mm parse ./readme.md
chainlesschain mm parse ./data.csv --json
```

原生解析无需外部依赖，直接在 CLI 进程中完成。

---

## 上下文构建

```bash
# 从会话工件构建上下文（最大 4000 tokens）
chainlesschain mm build-context <session-id>

# 获取已缓存的上下文
chainlesschain mm get-context <session-id>

# 裁剪上下文到指定 token 数
chainlesschain mm trim-context <session-id> --max-tokens 2000

# 清除会话上下文缓存
chainlesschain mm clear-context <session-id>
```

---

## 输出生成

```bash
# 生成摘要
chainlesschain mm generate <session-id> --format summary

# 生成分析报告
chainlesschain mm generate <session-id> --format report

# 生成代码
chainlesschain mm generate <session-id> --format code

# 生成 Q&A
chainlesschain mm generate <session-id> --format qa

# JSON 输出
chainlesschain mm generate <session-id> --format analysis --json
```

---

## 工件查看

```bash
# 列出会话的所有工件（输入 + 融合 + 输出）
chainlesschain mm artifacts <session-id>
chainlesschain mm artifacts <session-id> --json
```

---

## 统计

```bash
chainlesschain mm stats          # 多模态系统统计
chainlesschain mm stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/27_多模态协作.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
