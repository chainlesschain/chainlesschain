# add-social-foreign-keys

**Source**: `src\main\migrations\add-social-foreign-keys.js`

**Generated**: 2026-01-27T06:44:03.839Z

---

## async function up(db)

```javascript
async function up(db)
```

* 数据库迁移：为社交功能表添加外键约束
 *
 * Migration ID: 001_add_social_foreign_keys
 * Date: 2026-01-04
 * Description:
 *   - 为 post_likes 表添加外键约束（posts.id）
 *   - 为 post_comments 表添加外键约束（posts.id 和 parent_id）
 *   - 使用重建表的方式（SQLite不支持直接添加外键）

---

## async function up(db)

```javascript
async function up(db)
```

* 执行迁移
 * @param {Object} db - 数据库实例

---

## async function down(db)

```javascript
async function down(db)
```

* 回滚迁移
 * @param {Object} db - 数据库实例

---

