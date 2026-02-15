# add-token-tracking

**Source**: `src/main/migrations/add-token-tracking.js`

**Generated**: 2026-02-15T08:42:37.219Z

---

## async function migrate(db)

```javascript
async function migrate(db)
```

* 数据库迁移: 添加 Token 追踪和成本优化支持
 *
 * 新增表:
 * - llm_usage_log: Token 使用日志 (审计追踪)
 * - llm_cache: 响应缓存表
 * - llm_budget_config: 预算配置表
 *
 * 扩展表:
 * - conversations: 添加成本和 token 统计字段

---

## async function migrate(db)

```javascript
async function migrate(db)
```

* 执行数据库迁移
 * @param {import('better-sqlite3').Database} db - SQLite 数据库实例

---

## async function rollback(db)

```javascript
async function rollback(db)
```

* 回滚迁移 (可选, 用于测试)
 * @param {import('better-sqlite3').Database} db

---

