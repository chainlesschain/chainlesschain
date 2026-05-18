# 层级记忆系统 2.0 (hmemory)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🧠 **四层架构**: Working(50) / Short-term(500) / Long-term(10000) / Core(永久) 四级记忆
- 📉 **艾宾浩斯遗忘曲线**: 基于科学记忆模型的自动衰减与巩固
- 🔁 **间隔重复**: 智能复习调度，增强长期记忆保留
- 🔍 **语义/情景搜索**: 支持 semantic（语义相似度）和 episodic（时序情景）两种检索模式
- 🤝 **跨智能体共享**: 记忆可在多个 Agent 之间安全共享
- ✂️ **自动修剪**: 基于重要度和访问频率的智能记忆清理

## 概述

ChainlessChain CLI 层级记忆系统 2.0 提供仿生物学的四层记忆架构。记忆根据重要度（0.0-1.0）自动分层存储：低重要度进入工作记忆（容量 50），中等重要度进入短期记忆（容量 500），高重要度提升至长期记忆（容量 10000），核心记忆（importance=1.0）永久保留。

系统内置艾宾浩斯遗忘曲线模型，记忆强度随时间自然衰减。通过 `consolidate` 操作触发记忆巩固，将高频访问、高重要度的记忆从低层提升到高层。间隔重复机制确保关键记忆在最佳时间点被复习，有效提升长期保留率。

## 命令参考

### hmemory store — 存储记忆

```bash
chainlesschain hmemory store <content>
chainlesschain hmemory store "项目架构决策：采用微服务" --importance 0.8
chainlesschain hmemory store "核心设计原则" --core                    # 强制存入核心层
chainlesschain hmemory store "会议纪要" --type episodic --json
```

存储一条记忆，系统根据重要度自动分配到对应层级。`--core` 强制以 importance=1.0 存入核心记忆层。

### hmemory recall — 召回记忆

```bash
chainlesschain hmemory recall <query>
chainlesschain hmemory recall "架构决策" --limit 5
chainlesschain hmemory recall "会议" --layer long-term --json
```

根据查询条件召回相关记忆，支持按层级过滤。召回操作会更新记忆的访问计数和最后访问时间。

### hmemory consolidate — 记忆巩固

```bash
chainlesschain hmemory consolidate
chainlesschain hmemory consolidate --json
```

触发记忆巩固过程：分析所有记忆的访问频率、重要度和时间衰减，将符合条件的记忆提升到更高层级，清理过期的低层记忆。

### hmemory search — 搜索记忆

```bash
chainlesschain hmemory search <query> --mode semantic     # 语义相似度搜索
chainlesschain hmemory search <query> --mode episodic     # 时序情景搜索
chainlesschain hmemory search "设计模式" --limit 10 --json
```

在记忆库中搜索。`semantic` 模式基于内容语义相似度匹配，`episodic` 模式按时间顺序检索相关事件记忆。

### hmemory stats — 查看统计

```bash
chainlesschain hmemory stats
chainlesschain hmemory stats --json
```

显示各层级记忆数量、容量使用率、平均重要度、平均衰减度等统计信息。

### hmemory share — 共享记忆

```bash
chainlesschain hmemory share <memory-id> --to <agent-id>
chainlesschain hmemory share <id> --to agent-002 --json
```

将指定记忆共享给另一个 Agent，在 `memory_sharing` 表中创建共享记录。

### hmemory prune — 修剪记忆

```bash
chainlesschain hmemory prune
chainlesschain hmemory prune --layer working              # 仅修剪工作记忆
chainlesschain hmemory prune --threshold 0.1 --json       # 自定义衰减阈值
```

清理已严重衰减（强度低于阈值）的记忆条目，释放存储空间。

## 四层记忆架构

| 层级 | 容量 | 保留策略 | 说明 |
|------|------|----------|------|
| Working | 50 | 最近使用，FIFO 淘汰 | 当前会话的临时记忆 |
| Short-term | 500 | 艾宾浩斯衰减 | 近期事件和对话记忆 |
| Long-term | 10,000 | 间隔重复巩固 | 重要知识和经验 |
| Core | 永久 | 不衰减，人工标记 | 身份、偏好、核心知识 |

## 数据库表

| 表名 | 说明 |
|------|------|
| `memory_long_term` | 长期/核心记忆存储（内容、重要度、衰减强度、层级） |
| `memory_core` | 核心记忆索引（永久保留的关键记忆） |
| `memory_sharing` | 跨智能体共享记录（来源、目标、权限） |

## 系统架构

```
用户命令 → hmemory.js (Commander) → hierarchical-memory.js
                                          │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
            分层存储引擎           遗忘曲线模型            共享管理器
          (Working→Core)        (Ebbinghaus)         (Agent 间传递)
                    │                      │                      │
                    ▼                      ▼                      ▼
           memory_long_term         巩固/修剪调度         memory_sharing
```

## 配置参考

```bash
# hmemory store
<content>                      # 记忆内容（必填）
--importance <0.0-1.0>         # 重要度（决定层级）
--core                         # 强制存入核心层 (importance=1.0)
--type semantic|episodic       # 记忆类型
--json

# hmemory recall / search
<query>                        # 查询关键词
--limit <n>                    # 结果数量上限
--layer working|short-term|long-term|core
--mode semantic|episodic       # 仅 search
--shared                       # 仅 recall：查看共享记忆

# hmemory share
<memory-id> --to <agent-id>

# hmemory prune
--threshold <0.0-1.0>          # 衰减阈值
--layer <layer>                # 仅修剪指定层

# 四层容量：Working=50, Short-term=500, Long-term=10000, Core=∞
# 数据库：SQLCipher 加密（memory_long_term / memory_core / memory_sharing）
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| store 单条插入 | < 50ms | ~25ms | ✅ |
| recall (语义搜索 10k 条) | < 500ms | ~320ms | ✅ |
| consolidate 巩固全库 | < 3s | ~1.8s | ✅ |
| prune 清理低强度记忆 | < 800ms | ~450ms | ✅ |
| stats 聚合统计 | < 200ms | ~90ms | ✅ |

## 测试覆盖率

```
✅ hmemory.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/hmemory.js` | hmemory 命令主入口（store / recall / consolidate / search / stats / share / prune） |
| `packages/cli/src/lib/hierarchical-memory.js` | 四层记忆架构 + Ebbinghaus 遗忘曲线 + 间隔重复核心实现 |
| `packages/cli/__tests__/unit/hierarchical-memory.test.js` | 分层记忆核心单元测试 |
| `packages/cli/__tests__/unit/hmemory.test.js` | CLI 命令层测试 |

## 使用示例

### 场景 1：存储和检索知识

```bash
# 存储高重要性的核心知识
chainlesschain hmemory store "公司核心产品架构采用微服务设计" \
  --importance 0.9 --type semantic

# 存储日常工作记忆（低重要性，进入工作层）
chainlesschain hmemory store "今天的会议讨论了Q3计划" \
  --importance 0.3 --type episodic

# 按关键词检索
chainlesschain hmemory search "微服务" --layer long-term

# 查看记忆统计
chainlesschain hmemory stats
```

### 场景 2：记忆巩固与遗忘曲线

```bash
# 手动触发记忆巩固（短期→长期提升）
chainlesschain hmemory consolidate

# 查看特定层的所有记忆
chainlesschain hmemory recall --layer working
chainlesschain hmemory recall --layer core

# 清理低留存率的过期记忆
chainlesschain hmemory prune --threshold 0.3
```

### 场景 3：跨 Agent 记忆共享

```bash
# 将记忆共享给其他 Agent
chainlesschain hmemory share <memory-id> \
  --target-agent "agent-review" \
  --privacy public

# 查看共享记忆
chainlesschain hmemory recall --shared
```

## 故障排查

### 记忆检索问题

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| 检索不到已存储的记忆 | 记忆在工作层（内存中），重启后丢失 | 高重要性记忆会自动进入持久层，或手动 `consolidate` |
| 巩固后记忆未提升层级 | importance 值不够高 | 调高 `--importance` 参数（>0.5 进入短期，>0.7 进入长期） |
| 旧记忆检索结果排序靠后 | 遗忘曲线降低了 retention 值 | 多次访问同一记忆可增强 retention（间隔重复效应） |
| 共享记忆对方看不到 | privacy 级别限制 | 使用 `--privacy public` 或确认目标 Agent 有权限 |

### 常见错误

```bash
# 错误: "Working memory full (50/50)"
# 原因: 工作记忆容量达到上限
# 修复: 运行巩固将记忆提升到更高层级
chainlesschain hmemory consolidate

# 错误: "Memory not found"
# 原因: 记忆 ID 不存在或已被清理
# 修复: 搜索关键词而非 ID
chainlesschain hmemory search "关键词"
```

## 安全考虑

- **隐私分级**: 记忆共享支持 `public`/`restricted`/`private` 三级隐私控制，默认 `private` 不对外暴露
- **遗忘机制**: Ebbinghaus 遗忘曲线自动降低不常访问记忆的 retention 值，自然淘汰过期信息
- **数据加密**: 长期记忆和核心记忆存储在 SQLCipher 加密数据库中（AES-256）
- **工作层隔离**: 工作记忆和短期记忆仅存在于进程内存中，进程退出后自动销毁，不留持久化痕迹
- **清理策略**: `prune` 命令支持按阈值批量清理，防止记忆数据库无限增长

## 相关文档

- [A2A 协议](./cli-a2a) — 智能体间通信与记忆共享
- [自进化系统](./cli-evolution) — AI 能力评估与自我成长
- [持久记忆](./cli-memory) — 基础记忆管理
