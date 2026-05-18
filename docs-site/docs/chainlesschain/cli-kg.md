# 知识图谱 (kg)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **实体管理**: 创建、查看、删除带类型和标签的实体
- **关系管理**: 在实体间建立有向加权关系
- **多跳推理**: BFS 多跳图遍历，支持方向和关系类型过滤
- **图统计**: 实体/关系计数、类型分布、平均度数、图密度
- **导入导出**: JSON 格式的完整图导入导出

## 概述

ChainlessChain CLI 知识图谱模块 (Phase 94) 提供企业级知识图谱管理。`add` 创建实体（名称、类型、属性、标签），`add-relation` 建立有向加权关系，`remove` 级联删除实体及其关系。`reason` 从起点实体进行 BFS 多跳推理，支持 `--direction` (out|in|both) 和 `--relation-type` 过滤。`stats` 展示图密度等统计，`export`/`import` 支持完整图的 JSON 序列化。

## 命令参考

### kg entity-types — 实体类型目录

```bash
chainlesschain kg entity-types
chainlesschain kg entity-types --json
```

列出推荐实体类型及其描述。

### kg add — 添加实体

```bash
chainlesschain kg add "用户管理模块" service
chainlesschain kg add "PostgreSQL" database -p '{"version":"16"}' -g "core,storage" --json
```

添加实体。`-p` 属性 JSON，`-g` 标签 (逗号分隔)。

### kg list — 列出实体

```bash
chainlesschain kg list
chainlesschain kg list -t service -n 用户 -g core --limit 20 --json
```

列出实体。可按类型、名称子串、标签过滤。

### kg show — 查看实体详情

```bash
chainlesschain kg show <entity-id> --json
```

显示实体完整信息：名称、类型、标签、属性。

### kg remove — 删除实体

```bash
chainlesschain kg remove <entity-id>
```

删除实体并级联删除相关关系。

### kg add-relation — 添加关系

```bash
chainlesschain kg add-relation <source-id> <target-id> depends_on
chainlesschain kg add-relation <source-id> <target-id> uses -w 0.8 -p '{"via":"REST"}' --json
```

创建有向关系。`-w` 权重 (默认 1.0)，`-p` 属性 JSON。

### kg relations — 列出关系

```bash
chainlesschain kg relations
chainlesschain kg relations -s <source-id> -t <target-id> -r depends_on --limit 20 --json
```

列出关系。可按源实体、目标实体、关系类型过滤。

### kg reason — 多跳推理

```bash
chainlesschain kg reason <start-id>
chainlesschain kg reason <start-id> -d 5 --direction both -r depends_on --include-start --json
```

从起点实体进行 BFS 多跳遍历。`-d` 最大深度 (默认 3)，`--direction` 方向 (out|in|both, 默认 out)，`-r` 关系类型过滤，`--include-start` 包含起点。

### kg stats — 图统计

```bash
chainlesschain kg stats
chainlesschain kg stats --json
```

返回实体数、关系数、平均度数、图密度、类型分布。

### kg export — 导出图

```bash
chainlesschain kg export
chainlesschain kg export graph.json
```

导出完整图为 JSON。指定文件名写入文件，否则输出到 stdout。

### kg import — 导入图

```bash
chainlesschain kg import graph.json
chainlesschain kg import graph.json --json
```

从 JSON 文件导入图 (`{entities[], relations[]}`)。返回导入和跳过的实体/关系数。

## 数据库表

| 表名 | 说明 |
|------|------|
| `kg_entities` | 实体（名称、类型、属性 JSON、标签、创建时间） |
| `kg_relations` | 关系（源实体、目标实体、关系类型、权重、属性 JSON） |

## 系统架构

```
用户命令 → kg.js (Commander) → knowledge-graph.js
                                      │
              ┌──────────────────────┼─────────────────────┐
              ▼                      ▼                      ▼
          实体管理               关系管理               推理 & 统计
   (add/list/show/remove)   (add-relation/relations)  (reason/stats)
              ▼                      ▼                      ▼
         kg_entities           kg_relations              BFS 遍历
                                                     + 聚合查询
```

## 配置参考

```bash
# kg add
<name> <type>                  # 名称和类型（必填）
-p, --properties <json>        # 属性 JSON
-g, --tags <csv>               # 标签 (逗号分隔)

# kg add-relation
<source-id> <target-id> <type> # 源、目标、关系类型（必填）
-w, --weight <n>               # 权重 (默认 1.0)
-p, --properties <json>        # 属性 JSON

# kg reason
<start-id>                     # 起点实体 ID（必填）
-d, --max-depth <n>            # 最大跳数 (默认 3)
--direction <d>                # out|in|both (默认 out)
-r, --relation-type <t>        # 关系类型过滤
--include-start                # 包含起点实体
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| add 添加实体 | < 200ms | ~80ms | OK |
| add-relation 添加关系 | < 200ms | ~70ms | OK |
| reason 3 跳推理 | < 1s | ~350ms | OK |
| stats 统计 | < 500ms | ~200ms | OK |
| export (1000 实体) | < 2s | ~900ms | OK |
| import (1000 实体) | < 3s | ~1.5s | OK |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/kg.js` | kg 命令主入口 (Phase 94) |
| `packages/cli/src/lib/knowledge-graph.js` | 实体/关系 CRUD、BFS 推理、统计、导入导出核心实现 |

## 测试覆盖率

```
__tests__/unit/knowledge-graph.test.js          — 113 tests
__tests__/unit/code-knowledge-graph-cli.test.js — 补充代码图谱测试
```

覆盖：实体/关系 CRUD、标签/属性过滤、BFS 推理（3 方向 × 深度）、权重传播、JSON/CSV 导入导出、统计聚合。

## 安全考虑

1. **属性 JSON 解析**：严格 JSON parse，拒绝 prototype 污染
2. **导入校验**：`import` 限制实体/关系总数，防止超量 OOM（默认 10 万）
3. **推理深度**：`reason --max-depth` 建议 ≤ 5，深层指数膨胀
4. **循环保护**：BFS 自带 visited 集合，环不会重复展开
5. **导出脱敏**：`export` 支持 `--exclude-properties` 剔除敏感字段

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| `add-relation` 失败 | 源/目标实体不存在 | 先 `kg add` 对应实体 |
| `reason` 结果过多 | max-depth 过大 | 缩小深度或加 `--relation-type` |
| `export` 文件空 | 过滤条件过严 | 先 `stats` 查看实体数 |
| `import` 冲突 | ID 重复 | 使用 `--merge` 合并模式 |

## 使用示例

```bash
# 1. 构建一个小型知识图谱
cc kg add Alice person -g dev,team-a
cc kg add Project chainlesschain -g active
cc kg add-relation alice-id project-id owns -w 1.0

# 2. 推理：从 Alice 出发找相关实体（3 跳、仅 owns）
cc kg reason alice-id -d 3 --direction out -r owns --include-start

# 3. 导出图谱
cc kg export graph.json
cc kg stats --json

# 4. 从代码知识图谱构建
cc kg import src-graph.json --merge
```

## 相关文档

- [Code Knowledge Graph CLI](/chainlesschain/cli-a2a)
- [Memory Manager](./cli-memory)
- [Hierarchical Memory (cli-hmemory)](./cli-hmemory)
- 设计文档：`docs/design/modules/70_知识图谱系统.md`
