# SQL 注入修复指南

> 如何安全地使用 better-sqlite3 和防止 SQL 注入
>
> **适用范围**: desktop-app-vue 主进程（Electron）
> **数据库**: better-sqlite3 / better-sqlite3-multiple-ciphers
> **紧急程度**: 🔴 高优先级 - 立即修复

---

## 🚨 问题背景

验证器检测到 **163 个 SQL 注入风险点**，主要原因：
- 使用 `db.exec()` 而非参数化查询
- 字符串拼接构造 SQL 语句
- 模板字符串插值（`${variable}`）

**风险等级**：
- 🔴 **Critical**: 用户输入直接拼接到 SQL（立即修复）
- 🟠 **High**: 使用 db.exec() 但当前无用户输入（建议修复）
- 🟡 **Medium**: DDL 语句（CREATE TABLE 等）使用 exec()（可接受，但建议改进）

---

## ✅ 正确的数据库操作方式

### 1. SELECT 查询

#### ❌ 错误示例

```javascript
// 危险！直接拼接用户输入
const userId = getUserInput();
const result = db.exec(`SELECT * FROM users WHERE id = ${userId}`);

// 危险！模板字符串插值
const result = db.exec(`SELECT * FROM users WHERE id = '${userId}'`);

// 不安全！即使看起来有参数
const result = db.exec('SELECT * FROM users WHERE id = ?', [userId]);
// ⚠️ db.exec() 不支持参数化查询！
```

#### ✅ 正确示例

```javascript
// 方法 1: 单行查询 (推荐)
const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
const user = stmt.get(userId);

// 方法 2: 多行查询
const stmt = db.prepare('SELECT * FROM users WHERE status = ?');
const users = stmt.all('active');

// 方法 3: 复杂查询
const stmt = db.prepare(`
  SELECT u.*, p.name as project_name
  FROM users u
  LEFT JOIN projects p ON u.project_id = p.id
  WHERE u.department = ? AND u.role = ?
`);
const results = stmt.all('engineering', 'developer');

// 方法 4: IN 子句
const ids = [1, 2, 3, 4, 5];
const placeholders = ids.map(() => '?').join(',');
const stmt = db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`);
const users = stmt.all(...ids);
```

---

### 2. INSERT 插入

#### ❌ 错误示例

```javascript
// 危险！字符串拼接
db.exec(`INSERT INTO notes (title, content) VALUES ('${title}', '${content}')`);

// 危险！模板字符串
db.exec(`INSERT INTO notes (title, content) VALUES ('${title}', '${content}')`);
```

#### ✅ 正确示例

```javascript
// 方法 1: 基本插入
const stmt = db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)');
const info = stmt.run(title, content);
console.log('插入成功，ID:', info.lastInsertRowid);

// 方法 2: 批量插入（推荐）
const insert = db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)');
const insertMany = db.transaction((notes) => {
  for (const note of notes) {
    insert.run(note.title, note.content);
  }
});

insertMany([
  { title: 'Note 1', content: 'Content 1' },
  { title: 'Note 2', content: 'Content 2' }
]);

// 方法 3: 返回插入的记录
const stmt = db.prepare(`
  INSERT INTO notes (title, content, created_at)
  VALUES (?, ?, ?)
  RETURNING *
`);
const newNote = stmt.get(title, content, Date.now());
```

---

### 3. UPDATE 更新

#### ❌ 错误示例

```javascript
// 危险！字符串拼接
db.exec(`UPDATE notes SET title = '${title}' WHERE id = ${id}`);

// 危险！动态拼接字段
const fields = Object.keys(updates).map(key => `${key} = '${updates[key]}'`).join(', ');
db.exec(`UPDATE notes SET ${fields} WHERE id = ${id}`);
```

#### ✅ 正确示例

```javascript
// 方法 1: 基本更新
const stmt = db.prepare('UPDATE notes SET title = ?, content = ? WHERE id = ?');
const info = stmt.run(title, content, id);
console.log('更新行数:', info.changes);

// 方法 2: 动态字段更新（安全版）
function updateNote(id, updates) {
  // 白名单验证字段
  const allowedFields = ['title', 'content', 'tags', 'updated_at'];
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) {
    throw new Error('没有有效的更新字段');
  }

  values.push(id); // WHERE 条件的参数

  const stmt = db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
}

// 使用示例
updateNote(123, { title: 'New Title', content: 'New Content' });

// 方法 3: 使用事务批量更新
const update = db.prepare('UPDATE notes SET status = ? WHERE id = ?');
const updateMany = db.transaction((notes) => {
  for (const note of notes) {
    update.run('archived', note.id);
  }
});

updateMany(notesToArchive);
```

---

### 4. DELETE 删除

#### ❌ 错误示例

```javascript
// 危险！直接拼接 ID
db.exec(`DELETE FROM notes WHERE id = ${id}`);

// 危险！模板字符串
db.exec(`DELETE FROM notes WHERE user_id = '${userId}'`);
```

#### ✅ 正确示例

```javascript
// 方法 1: 单条删除
const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
const info = stmt.run(id);
console.log('删除行数:', info.changes);

// 方法 2: 批量删除
const ids = [1, 2, 3, 4, 5];
const placeholders = ids.map(() => '?').join(',');
const stmt = db.prepare(`DELETE FROM notes WHERE id IN (${placeholders})`);
stmt.run(...ids);

// 方法 3: 条件删除
const stmt = db.prepare('DELETE FROM notes WHERE user_id = ? AND status = ?');
stmt.run(userId, 'draft');

// 方法 4: 软删除（推荐）
const stmt = db.prepare('UPDATE notes SET deleted_at = ?, deleted_by = ? WHERE id = ?');
stmt.run(Date.now(), currentUserId, noteId);
```

---

### 5. DDL 操作（CREATE/ALTER/DROP）

#### 🟡 可接受的 exec() 使用

```javascript
// ✅ CREATE TABLE - 无用户输入，可以使用 exec()
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    created_at INTEGER NOT NULL
  )
`);

// ✅ CREATE INDEX - 静态 DDL
db.exec('CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)');

// ✅ 元数据查询 - 静态 SQL
const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
```

#### ❌ 不安全的 DDL

```javascript
// 危险！动态表名（即使是 DDL 也要验证）
const tableName = getUserInput();
db.exec(`CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)`);

// ✅ 正确做法：白名单验证
function createDynamicTable(tableName) {
  const allowedTables = ['temp_notes', 'temp_users', 'temp_logs'];
  if (!allowedTables.includes(tableName)) {
    throw new Error('Invalid table name');
  }
  db.exec(`CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)`);
}
```

---

## 🔧 自动化修复工具

### 使用修复工具（预览模式）

```bash
cd desktop-app-vue
node scripts/fix-sql-injection.js
```

这将扫描所有 `.js` 文件并输出修复建议（不会修改文件）。

### 应用修复（实际修改）

```bash
cd desktop-app-vue
node scripts/fix-sql-injection.js --apply
```

⚠️ **警告**: 自动修复可能不完美，建议：
1. 先运行预览模式查看建议
2. 备份代码或创建新分支
3. 逐个文件手动修复（更安全）

---

## 📊 修复优先级

### P0 - 立即修复（本周内）

**特征**：用户输入直接拼接到 SQL

```javascript
// 🔴 Critical - 立即修复
const searchTerm = req.query.search; // 用户输入
db.exec(`SELECT * FROM notes WHERE title LIKE '%${searchTerm}%'`);
```

**修复后**：

```javascript
// ✅ 安全
const stmt = db.prepare('SELECT * FROM notes WHERE title LIKE ?');
const results = stmt.all(`%${searchTerm}%`);
```

### P1 - 高优先级（本月内）

**特征**：虽然当前无用户输入，但使用不安全的 API

```javascript
// 🟠 High - 建议修复
db.exec('SELECT * FROM notes ORDER BY created_at DESC');
```

**修复后**：

```javascript
// ✅ 更好
const stmt = db.prepare('SELECT * FROM notes ORDER BY created_at DESC');
const notes = stmt.all();
```

### P2 - 中优先级（计划修复）

**特征**：DDL 语句，但可以改进

```javascript
// 🟡 Medium - 可以保留，但建议统一风格
db.exec('CREATE TABLE IF NOT EXISTS contacts (...)');
```

---

## 🧪 测试修复结果

### 1. 单元测试

```javascript
// tests/unit/database/sql-injection.test.js
const { describe, it, expect } = require('vitest');
const Database = require('better-sqlite3');

describe('SQL 注入防护测试', () => {
  it('应该防止 SQL 注入攻击', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO users (name) VALUES (?)').run('Alice');

    // 尝试注入
    const maliciousInput = "'; DROP TABLE users; --";

    // 使用参数化查询（安全）
    const stmt = db.prepare('SELECT * FROM users WHERE name = ?');
    const result = stmt.get(maliciousInput);

    // 应该返回 undefined（没有匹配），而不是删除表
    expect(result).toBeUndefined();

    // 表应该仍然存在
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    expect(tables).toBeDefined();
  });

  it('应该正确处理特殊字符', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)');

    const specialContent = "It's a test with 'quotes' and \"double quotes\"";
    const stmt = db.prepare('INSERT INTO notes (content) VALUES (?)');
    stmt.run(specialContent);

    const result = db.prepare('SELECT * FROM notes WHERE id = 1').get();
    expect(result.content).toBe(specialContent);
  });
});
```

### 2. 运行验证器

```bash
cd desktop-app-vue
npm run validate:rules
```

应该看到错误数量减少。

---

## 📚 常见问题 FAQ

### Q1: 为什么不能用 `db.exec()` 传参数？

**A**: better-sqlite3 的 `exec()` 方法**不支持**参数化查询，它只能执行静态 SQL。必须使用 `db.prepare()` 来支持参数。

```javascript
// ❌ 这不会工作！exec() 忽略第二个参数
db.exec('SELECT * FROM users WHERE id = ?', [123]);

// ✅ 正确
db.prepare('SELECT * FROM users WHERE id = ?').get(123);
```

---

### Q2: 动态字段更新如何安全实现？

**A**: 使用白名单验证 + 参数化值：

```javascript
function safeUpdate(table, id, updates) {
  // 白名单验证表名
  const allowedTables = ['notes', 'users', 'contacts'];
  if (!allowedTables.includes(table)) {
    throw new Error('Invalid table');
  }

  // 白名单验证字段
  const allowedFields = {
    notes: ['title', 'content', 'tags'],
    users: ['name', 'email', 'avatar'],
    contacts: ['nickname', 'trust_score']
  };

  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields[table].includes(key)) {
      fields.push(`${key} = ?`); // 字段名安全（来自白名单）
      values.push(value);         // 值使用参数化
    }
  }

  values.push(id);

  const stmt = db.prepare(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
}
```

---

### Q3: LIKE 查询如何防止注入？

**A**: 通配符也通过参数传递：

```javascript
// ❌ 错误
const search = getUserInput();
db.exec(`SELECT * FROM notes WHERE title LIKE '%${search}%'`);

// ✅ 正确
const stmt = db.prepare('SELECT * FROM notes WHERE title LIKE ?');
const results = stmt.all(`%${search}%`);
```

---

### Q4: 事务中如何使用参数化查询？

**A**: 事务包裹 prepare 语句：

```javascript
const insertNote = db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)');
const updateUser = db.prepare('UPDATE users SET note_count = note_count + 1 WHERE id = ?');

const addNoteTransaction = db.transaction((userId, title, content) => {
  insertNote.run(title, content);
  updateUser.run(userId);
});

addNoteTransaction(123, 'My Note', 'Content here');
```

---

### Q5: sql.js 和 better-sqlite3 的 API 区别？

| 功能 | sql.js | better-sqlite3 |
|------|--------|----------------|
| 参数化查询 | `db.exec(sql, params)` | `db.prepare(sql).run(params)` |
| 单行查询 | `db.exec(sql)[0].values[0]` | `db.prepare(sql).get(params)` |
| 多行查询 | `db.exec(sql)[0].values` | `db.prepare(sql).all(params)` |
| 事务 | `BEGIN; ...; COMMIT;` | `db.transaction(() => {})` |

**当前项目使用**: better-sqlite3-multiple-ciphers

---

## 🎯 修复进度跟踪

建议在项目管理工具中创建任务：

```markdown
## SQL 注入修复任务

### 模块分工
- [ ] database.js (核心数据库) - 负责人: XXX
- [ ] contacts/ (联系人模块) - 负责人: XXX
- [ ] social/ (社交模块) - 负责人: XXX
- [ ] trade/ (交易模块) - 负责人: XXX
- [ ] blockchain/ (区块链模块) - 负责人: XXX
- [ ] p2p/ (P2P 模块) - 负责人: XXX

### 时间线
- Week 1: P0 问题修复（Critical）
- Week 2: P1 问题修复（High）
- Week 3: P2 问题修复（Medium）
- Week 4: 代码审查 + 测试

### 完成标准
- [ ] 规则验证器 0 错误
- [ ] 单元测试覆盖率 > 80%
- [ ] 代码审查通过
```

---

## 📞 获取帮助

- **文档**: `.chainlesschain/rules.md`
- **工具**: `desktop-app-vue/scripts/rules-validator.js`
- **参考**: [better-sqlite3 官方文档](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- **安全**: [OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection)

---

**最后更新**: 2026-01-16
**维护者**: 安全团队
