# 智能推荐 (recommend)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📊 **兴趣画像**: 为用户创建/管理兴趣画像（主题权重 + 交互权重）
- 🎯 **智能推荐**: 基于画像与内容池的相关性评分生成推荐
- 📈 **反馈闭环**: 支持 like/dislike/later 反馈，持续优化推荐准确度
- ⏱️ **时间衰减**: 自动衰减旧兴趣权重，保持画像时效性
- 📋 **统计洞察**: 推荐命中率、反馈率、热门兴趣、主题建议

## 概述

ChainlessChain CLI 智能推荐模块（Phase 48）提供完整的内容推荐管线。通过 `profile` 系列子命令管理用户兴趣画像，`generate` 基于画像对内容池评分并生成推荐列表，`feedback` / `view` / `dismiss` 收集用户反馈，`stats` / `top-interests` / `suggest` 提供统计洞察和主题调整建议。

## 命令参考

### recommend content-types — 内容类型目录

```bash
chainlesschain recommend content-types
chainlesschain recommend content-types --json
```

列出系统支持的所有内容类型（ID、名称、描述）。

### recommend statuses — 推荐状态

```bash
chainlesschain recommend statuses
chainlesschain recommend statuses --json
```

列出推荐的所有可能状态值。

### recommend feedback-values — 反馈值

```bash
chainlesschain recommend feedback-values --json
```

列出支持的反馈值（like / dislike / later）。

### recommend profile — 查看兴趣画像

```bash
chainlesschain recommend profile <user-id>
chainlesschain recommend profile user_alice --json
```

显示指定用户的兴趣画像：主题权重、衰减因子、更新次数。

### recommend create-profile — 创建画像

```bash
chainlesschain recommend create-profile <user-id>
chainlesschain recommend create-profile user_alice -t '{"ai":0.9,"p2p":0.6}' -w '{"view":1,"like":3}'
chainlesschain recommend create-profile user_bob --json
```

为用户创建兴趣画像。`-t` 指定主题权重 JSON，`-w` 指定交互权重 JSON。

### recommend update-profile — 更新画像

```bash
chainlesschain recommend update-profile <user-id>
chainlesschain recommend update-profile user_alice -t '{"blockchain":0.8}' -d 0.95
```

更新画像的主题权重、交互权重或衰减因子。

### recommend delete-profile — 删除画像

```bash
chainlesschain recommend delete-profile <user-id>
chainlesschain recommend delete-profile user_alice --json
```

### recommend profiles — 列出所有画像

```bash
chainlesschain recommend profiles
chainlesschain recommend profiles --limit 20 --json
```

### recommend decay — 应用时间衰减

```bash
chainlesschain recommend decay <user-id>
chainlesschain recommend decay user_alice --json
```

对用户画像的所有主题权重应用衰减因子，降低过时兴趣的影响。

### recommend generate — 生成推荐

```bash
chainlesschain recommend generate <user-id> -p '<content-pool-json>'
chainlesschain recommend generate user_alice -p '[{"id":"c1","type":"article","title":"AI入门","topics":["ai"]}]' -l 10 -m 0.3
```

从内容池中为用户生成推荐。`--pool` 为 JSON 数组，`--limit` 限制数量，`--min-score` 设定最低分数阈值。

### recommend show — 查看推荐详情

```bash
chainlesschain recommend show <rec-id>
chainlesschain recommend show rec-001 --json
```

### recommend list — 列出推荐

```bash
chainlesschain recommend list <user-id>
chainlesschain recommend list user_alice -s pending -t article -m 0.5 --limit 20 --json
```

按状态 (`-s`)、内容类型 (`-t`)、最低分数 (`-m`) 过滤。

### recommend view — 标记已查看

```bash
chainlesschain recommend view <rec-id>
```

### recommend feedback — 提供反馈

```bash
chainlesschain recommend feedback <rec-id> like
chainlesschain recommend feedback <rec-id> dislike --json
```

### recommend dismiss — 忽略推荐

```bash
chainlesschain recommend dismiss <rec-id>
```

### recommend stats — 推荐统计

```bash
chainlesschain recommend stats <user-id>
chainlesschain recommend stats user_alice --json
```

返回总数、待处理数、已查看数、已忽略数、反馈率、平均分数。

### recommend top-interests — 热门兴趣

```bash
chainlesschain recommend top-interests <user-id> --limit 10 --json
```

### recommend suggest — 主题调整建议

```bash
chainlesschain recommend suggest <user-id> --json
```

基于反馈模式，建议增强或降低特定主题的权重。

## 系统架构

```
用户命令 → recommend.js (Commander) → content-recommendation.js
                                            │
              ┌─────────────────────────────┼──────────────────────┐
              ▼                             ▼                      ▼
        画像管理                       推荐生成                 反馈洞察
  (create/update/decay)          (score/generate)        (feedback/stats/suggest)
              ▼                             ▼                      ▼
     recommendation_profiles      recommendation_items      recommendation_feedback
```

## 配置参考

```bash
# 画像管理
-t, --topics <json>            # 主题权重 JSON
-w, --weights <json>           # 交互权重 JSON
-d, --decay <factor>           # 衰减因子 (0..1)

# 推荐生成
-p, --pool <json>              # 内容池 JSON 数组（必填）
-l, --limit <n>                # 最大推荐数
-m, --min-score <n>            # 最低分数阈值

# 通用
--json                         # JSON 输出
--limit <n>                    # 列表最大条目数
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/recommend.js` | recommend 命令主入口 |
| `packages/cli/src/lib/content-recommendation.js` | 画像管理、评分、推荐生成核心实现 |

## 使用示例

### 场景：完整推荐流程

```bash
# 1. 创建用户画像
chainlesschain recommend create-profile user_alice -t '{"ai":0.9,"blockchain":0.7,"p2p":0.5}'

# 2. 从内容池生成推荐
chainlesschain recommend generate user_alice -p '[
  {"id":"c1","type":"article","title":"深度学习入门","topics":["ai","ml"]},
  {"id":"c2","type":"article","title":"P2P网络协议","topics":["p2p","network"]}
]' --limit 5

# 3. 查看并反馈
chainlesschain recommend list user_alice -s pending
chainlesschain recommend feedback rec-001 like

# 4. 查看统计 & 调整建议
chainlesschain recommend stats user_alice
chainlesschain recommend suggest user_alice
```

## 相关文档

- [社交管理](./cli-social) — 社交互动与内容发布
- [知识库](./cli-note) — 笔记与知识管理
