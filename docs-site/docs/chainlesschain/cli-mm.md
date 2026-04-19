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

## 核心特性

- **5 种模态加权融合** — text / code / image / audio / structured，各自权重可配置
- **7 种原生文档解析** — 无外部依赖，CLI 进程内完成 txt/md/csv/json/xml/yaml/html
- **4000-token 上下文上限** — 超限自动裁剪，保留高权重模态
- **6 种输出格式** — summary / report / code / analysis / presentation / qa
- **工件（artifact）持久化** — 输入、融合结果、输出均存入 SQLite，可事后审计
- **会话状态机** — active → completed / archived，可 delete 级联清理 artifacts
- **V2 治理层** — 101 V2 tests 覆盖 5 态 session maturity + 3 态 artifact lifecycle（`multimodal_v2_phase27_cli.md`）

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│          chainlesschain mm (Phase 27)                 │
├──────────────────────────────────────────────────────┤
│  Session            │  Input Fusion                  │
│  create / status    │  5 modalities × weight         │
│                     │  → unified context             │
├──────────────────────────────────────────────────────┤
│  Document Parser (原生)                                │
│  txt / md / csv / json / xml / yaml / html            │
├──────────────────────────────────────────────────────┤
│  Context Manager                                      │
│  build / get / trim --max-tokens / clear              │
├──────────────────────────────────────────────────────┤
│  Output Generator                                     │
│  summary / report / code / analysis / presentation /  │
│  qa                                                   │
├──────────────────────────────────────────────────────┤
│  Artifact Store (SQLite)                              │
│  mm_sessions / mm_artifacts (input/fusion/output)     │
└──────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项                    | 含义                    | 默认            |
| ------------------------- | ----------------------- | --------------- |
| `context.maxTokens`       | 上下文 token 上限       | 4000            |
| `modality.weights.text`   | text 权重               | 1.0             |
| `modality.weights.code`   | code 权重               | 0.9             |
| `modality.weights.image`  | image 权重              | 0.7             |
| `modality.weights.audio`  | audio 权重              | 0.7             |
| `modality.weights.structured` | structured 权重    | 0.8             |
| V2 `perOwnerActiveSessCap` | V2 活跃会话上限        | 见 memory 文件  |
| V2 `perSessionArtifactCap` | V2 每会话 artifact 上限 | 见 memory 文件 |

查看：`chainlesschain mm modalities`、`mm input-formats`、`mm output-formats`。

---

## 性能指标

| 操作                           | 典型耗时          |
| ------------------------------ | ----------------- |
| session-create                 | < 10 ms           |
| add 模态输入                   | < 20 ms           |
| parse（单文档 100KB）          | < 50 ms           |
| fuse（5 模态各 1k tokens）     | < 30 ms           |
| build-context（含 trim）       | < 50 ms           |
| generate（模板化格式）         | < 100 ms          |
| V2 session-v2 dispatch         | < 50 ms           |

---

## 测试覆盖率

```
__tests__/unit/multimodal.test.js — 101 tests (1126 lines)
```

覆盖：5 种模态 add/delete、7 种 parse、加权融合、build-context + trim 边界、
6 种 generate 输出格式、artifact 级联删除、session 状态机、JSON 输出一致性。
V2 surface：101 V2 tests（见 `multimodal_v2_phase27_cli.md`）。

---

## 安全考虑

1. **原生 parser** — 不依赖 npm 包解析器，减少供应链攻击面
2. **内容存 SQLite** — 可启用 SQLCipher；`session-delete` 级联清理 artifacts
3. **token 裁剪** — trim 会按权重保留高优先级模态，防止关键上下文丢失
4. **fuse 幂等** — 相同输入产生相同 fusion artifact，便于对比
5. **大文件拒绝** — parse 对超大文件会拒绝以防 OOM（依赖配置）

---

## 故障排查

**Q: `generate` 返回空结果?**

1. 先 `fuse <session-id>` 生成融合上下文（未融合直接 generate 会基于空 context）
2. 检查已添加的模态数（`modalities-of <session-id>`）
3. `build-context` 后 `get-context` 确认有内容再 generate

**Q: 上下文超出 4000 tokens?**

1. 用 `trim-context <session-id> --max-tokens 3500` 主动裁剪
2. 考虑减少低权重模态的输入量（如 image 描述）
3. 拆分为多个 session 分别 generate

**Q: `parse` 报 unsupported format?**

1. `mm input-formats` 确认枚举
2. 可先将格式转为 md/txt 后再 parse
3. 自定义格式需扩展 `multimodal.js`

---

## 关键文件

- `packages/cli/src/commands/multimodal.js` — Commander 子命令（~700 行）
- `packages/cli/src/lib/multimodal.js` — 5 模态 + 7 parser + 融合
- `packages/cli/__tests__/unit/multimodal.test.js` — 单测（101 tests）
- 数据表：`mm_sessions` / `mm_artifacts`
- 设计文档：`docs/design/modules/27_多模态协作.md`

---

## 使用示例

```bash
# 1. 创建会话并混合输入
sid=$(chainlesschain mm session-create --name "项目分析" --json | jq -r .id)
chainlesschain mm add $sid --modality text --content "需求文档..."
chainlesschain mm add $sid --modality code --content "function login() {}"
chainlesschain mm add $sid --modality structured --file ./data.json

# 2. 融合 + 构建上下文
chainlesschain mm fuse $sid
chainlesschain mm build-context $sid
chainlesschain mm trim-context $sid --max-tokens 2000

# 3. 多格式输出
chainlesschain mm generate $sid --format summary
chainlesschain mm generate $sid --format report --json
chainlesschain mm generate $sid --format qa

# 4. 查看工件链 + 收尾
chainlesschain mm artifacts $sid
chainlesschain mm session-complete $sid
```

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
- [Perception 多模态感知 →](/chainlesschain/cli-perception)
- [NL Programming →](/chainlesschain/cli-nlprog)
- [Session Manager →](/chainlesschain/cli-session)
