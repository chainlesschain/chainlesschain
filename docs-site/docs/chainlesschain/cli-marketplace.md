# 技能市场 (marketplace)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **技能服务发布**: 发布技能服务，支持版本管理、定价、端点配置
- **服务状态管理**: 草稿、已发布、已弃用、已暂停四种状态流转
- **调用记录**: 记录每次技能调用的输入输出、耗时、状态
- **调用统计**: 聚合调用次数、成功率、平均耗时等指标
- **所有者与定价**: 绑定 DID 所有者，支持自定义定价策略

## 概述

ChainlessChain CLI 技能市场模块 (Phase 65) 提供去中心化的技能服务发布和调用管理。`publish` 发布技能服务（名称、版本、描述、端点、定价），`status` 管理服务生命周期状态。`record` 记录调用事件（调用者、输入输出、耗时、成功/失败），`invocations` 查看调用列表，`stats` 聚合统计。

## 命令参考

### marketplace status-types — 服务状态类型

```bash
chainlesschain marketplace status-types
chainlesschain marketplace status-types --json
```

列出服务状态：draft、published、deprecated、suspended。

### marketplace invocation-statuses — 调用状态类型

```bash
chainlesschain marketplace invocation-statuses --json
```

列出调用状态：pending、running、success、failed、timeout。

### marketplace publish — 发布服务

```bash
chainlesschain marketplace publish "weather-skill"
chainlesschain marketplace publish "code-review" -v 2.0.0 -d "代码审查服务" -e "https://api.example.com/review" -o did:key:abc -p '{"perCall":0.01}' --json
```

发布技能服务。`-v` 版本 (默认 1.0.0)，`-d` 描述，`-e` 调用端点，`-o` 所有者 DID，`-p` 定价 JSON，`-s` 初始状态 (默认 published)。

### marketplace list — 列出服务

```bash
chainlesschain marketplace list
chainlesschain marketplace list -s published -o did:key:abc -n weather --limit 20 --json
```

列出服务。可按状态、所有者 DID、名称子串过滤。

### marketplace show — 查看服务详情

```bash
chainlesschain marketplace show <service-id> --json
```

显示服务完整信息：名称、版本、状态、描述、端点、所有者、调用次数。

### marketplace status — 更新服务状态

```bash
chainlesschain marketplace status <service-id> deprecated
chainlesschain marketplace status <service-id> suspended --json
```

转换服务状态 (draft|published|deprecated|suspended)。

### marketplace record — 记录调用

```bash
chainlesschain marketplace record <service-id>
chainlesschain marketplace record <service-id> -c did:key:xyz -i '{"query":"天气"}' -o '{"result":"晴"}' -s success -d 230 --json
chainlesschain marketplace record <service-id> -s failed -e "超时" -d 5000
```

记录技能调用。`-c` 调用者 DID，`-i` 输入 JSON，`-o` 输出 JSON，`-s` 状态 (默认 success)，`-d` 耗时 (ms)，`-e` 错误信息。

### marketplace invocations — 列出调用

```bash
chainlesschain marketplace invocations
chainlesschain marketplace invocations -s <service-id> -c did:key:xyz -S failed --limit 20 --json
```

列出调用记录。可按服务、调用者、状态过滤。

### marketplace stats — 调用统计

```bash
chainlesschain marketplace stats
chainlesschain marketplace stats -s <service-id> --json
```

聚合调用统计。可按单个服务过滤。返回总调用数、各状态分布、平均耗时等。

## 数据库表

| 表名 | 说明 |
|------|------|
| `marketplace_services` | 技能服务（名称、版本、描述、端点、所有者、定价、状态、调用数） |
| `marketplace_invocations` | 调用记录（服务 ID、调用者、输入输出、状态、耗时、错误信息） |

## 系统架构

```
用户命令 → marketplace.js (Commander) → skill-marketplace.js
                                              │
                 ┌───────────────────────────┼───────────────┐
                 ▼                           ▼               ▼
            服务管理                      调用管理          统计
   (publish/list/show/status)       (record/invocations)  (stats)
                 ▼                           ▼               ▼
      marketplace_services       marketplace_invocations   聚合查询
```

## 配置参考

```bash
# marketplace publish
<name>                         # 服务名称（必填）
-v, --version <v>              # 版本 (默认 1.0.0)
-d, --description <text>       # 描述
-e, --endpoint <url>           # 调用端点
-o, --owner <did>              # 所有者 DID
-p, --pricing <json>           # 定价 JSON
-s, --status <s>               # 初始状态 (默认 published)

# marketplace record
<service-id>                   # 服务 ID（必填）
-c, --caller <did>             # 调用者 DID
-i, --input <json>             # 输入 JSON
-o, --output <json>            # 输出 JSON
-s, --status <s>               # pending|running|success|failed|timeout
-d, --duration-ms <n>          # 耗时 (ms)
-e, --error <text>             # 错误信息

# marketplace list / invocations
--limit <n>                    # 最大条目数 (默认 50)
--json                         # JSON 输出
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| publish 发布服务 | < 200ms | ~100ms | OK |
| record 记录调用 | < 150ms | ~70ms | OK |
| list 列出 (50 条) | < 300ms | ~130ms | OK |
| stats 聚合统计 | < 500ms | ~250ms | OK |
| invocations 列出 | < 300ms | ~140ms | OK |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/marketplace.js` | marketplace 命令主入口 (Phase 65) |
| `packages/cli/src/lib/skill-marketplace.js` | 服务发布、调用记录、统计聚合核心实现 |

## 测试覆盖率

```
__tests__/unit/skill-marketplace.test.js — 73 tests
```

覆盖服务 publish/list/show/delete、invocation 记录与状态、按 provider/tag 聚合统计、搜索、分页。

## 安全考虑

1. **服务鉴权**：`publish` 仅记录元数据，真实调用走上游 gateway；密钥不落 SQLite 明文
2. **价格/配额**：CLI 不强制，业务层应通过策略/SLA 校验
3. **调用幂等**：`record` 带 `requestId` 去重
4. **审计**：所有发布/调用事件进 `marketplace_audit`
5. **恶意服务**：建议叠加 allowlist / signed manifest（生产环境）

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| `publish` 拒 | name 冲突 / tag 非法 | `list` 检查或改名 |
| `record` 丢失 | provider 未注册 | 先 `publish` |
| `stats` 空 | 时间窗太窄 | `--since` 放宽 |
| 搜索无结果 | 索引未更新 | 重启 CLI 或 `rebuild-index` |

## 使用示例

```bash
# 1. 发布服务
sid=$(cc marketplace publish "image-ocr" --provider did:key:z6... \
  --version 1.0.0 --tags ocr,vision --json | jq -r .id)

# 2. 记录调用
cc marketplace record $sid --caller did:key:alice --status ok --latency-ms 120

# 3. 查看
cc marketplace list --tag ocr
cc marketplace show $sid
cc marketplace stats $sid
cc marketplace invocations $sid --limit 50
```

## 相关文档

- [Skill Loader](./cli-skill)
- [Agent Economy](./cli-economy)
- [V2 设计文档](/chainlesschain/skill_marketplace_v2)（如可用）
- 设计文档：`docs/design/modules/77_技能市场.md`
