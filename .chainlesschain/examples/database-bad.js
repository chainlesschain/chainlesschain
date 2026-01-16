/**
 * ❌ 数据库操作错误示例
 *
 * 本文件展示常见的 SQL 注入漏洞（仅供教学，切勿使用！）
 *
 * ⚠️ 警告: 这些代码都是不安全的，不要在生产环境中使用！
 */

const Database = require('better-sqlite3');

class UnsafeNotesManager {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        created_at INTEGER NOT NULL
      )
    `);
  }

  // ❌ 错误1: 直接拼接用户输入
  createNoteUnsafe1(title, content) {
    // 如果 title = "'; DROP TABLE notes; --"
    // SQL 会变成: INSERT INTO notes VALUES (''; DROP TABLE notes; --', ...)
    this.db.exec(`INSERT INTO notes (title, content, created_at) VALUES ('${title}', '${content}', ${Date.now()})`);
  }

  // ❌ 错误2: 使用模板字符串插值
  createNoteUnsafe2(title, content) {
    const now = Date.now();
    // 同样的问题，模板字符串也会被注入
    this.db.exec(`INSERT INTO notes (title, content, created_at) VALUES ('${title}', '${content}', ${now})`);
  }

  // ❌ 错误3: exec() 尝试使用参数（不会工作！）
  createNoteUnsafe3(title, content) {
    // ⚠️ 这看起来像参数化查询，但 exec() 不支持！
    // 第二个参数会被忽略，如果 SQL 中有变量会报错
    this.db.exec('INSERT INTO notes (title, content, created_at) VALUES (?, ?, ?)', [title, content, Date.now()]);
    // 实际上这会抛出错误: "SQLITE_ERROR: incomplete input"
  }

  // ❌ 错误4: 字符串拼接构建 WHERE 子句
  getNoteByIdUnsafe(id) {
    // 如果 id = "1 OR 1=1"
    // SQL 会变成: SELECT * FROM notes WHERE id = 1 OR 1=1
    // 这会返回所有记录！
    const result = this.db.exec(`SELECT * FROM notes WHERE id = ${id}`);

    if (result && result.length > 0) {
      return result[0].values[0];
    }
    return null;
  }

  // ❌ 错误5: LIKE 查询拼接
  searchNotesUnsafe(keyword) {
    // 如果 keyword = "%' OR '1'='1"
    // SQL 会变成: SELECT * FROM notes WHERE title LIKE '%%' OR '1'='1%'
    const result = this.db.exec(`SELECT * FROM notes WHERE title LIKE '%${keyword}%'`);
    return result[0]?.values || [];
  }

  // ❌ 错误6: 动态表名/列名拼接
  getNotesFromTableUnsafe(tableName) {
    // 如果 tableName = "notes; DROP TABLE users; --"
    // 可能会删除 users 表！
    const result = this.db.exec(`SELECT * FROM ${tableName}`);
    return result[0]?.values || [];
  }

  // ❌ 错误7: 不安全的动态字段更新
  updateNoteUnsafe(id, updates) {
    // 如果 updates = { "title = 'hacked', admin": "1 WHERE 1=1; --" }
    // SQL 可能变成恶意语句
    const fields = Object.keys(updates).map(key => `${key} = '${updates[key]}'`).join(', ');
    this.db.exec(`UPDATE notes SET ${fields} WHERE id = ${id}`);
  }

  // ❌ 错误8: ORDER BY 拼接
  getNotesOrderedUnsafe(orderBy) {
    // 如果 orderBy = "id; DROP TABLE notes; --"
    // 可能导致表被删除
    const result = this.db.exec(`SELECT * FROM notes ORDER BY ${orderBy}`);
    return result[0]?.values || [];
  }

  // ❌ 错误9: LIMIT 拼接
  getNotesWithLimitUnsafe(limit) {
    // 虽然风险较小，但仍然不安全
    const result = this.db.exec(`SELECT * FROM notes LIMIT ${limit}`);
    return result[0]?.values || [];
  }

  // ❌ 错误10: JSON 数据拼接
  saveJSONUnsafe(id, jsonData) {
    // JSON 字符串可能包含单引号导致注入
    const jsonStr = JSON.stringify(jsonData);
    this.db.exec(`UPDATE notes SET data = '${jsonStr}' WHERE id = ${id}`);
  }

  // ❌ 错误11: 二次注入
  getUserInputAndSave(userInput) {
    // 第一步：保存用户输入（假设这里是安全的）
    const stmt = this.db.prepare('INSERT INTO temp_data (value) VALUES (?)');
    stmt.run(userInput);

    // 第二步：取出数据后不安全地使用
    const data = this.db.prepare('SELECT value FROM temp_data WHERE id = 1').get();

    // ❌ 这里直接拼接，导致二次注入！
    this.db.exec(`UPDATE notes SET title = '${data.value}' WHERE id = 1`);
  }

  // ❌ 错误12: 使用不安全的 Base64 "加密"
  savePasswordUnsafe(userId, password) {
    // Base64 不是加密！这是明文！
    const encoded = Buffer.from(password).toString('base64');
    this.db.exec(`UPDATE users SET password = '${encoded}' WHERE id = ${userId}`);
  }

  close() {
    this.db.close();
  }
}

// ⚠️ 攻击示例（仅供教学）

function demonstrateAttacks() {
  const manager = new UnsafeNotesManager(':memory:');

  console.log('⚠️ 以下是 SQL 注入攻击示例（仅供学习）\n');

  // 攻击1: SQL 注入删除表
  try {
    const maliciousTitle = "'; DROP TABLE notes; --";
    console.log('尝试注入:', maliciousTitle);
    manager.createNoteUnsafe1(maliciousTitle, 'content');
  } catch (e) {
    console.log('攻击失败（幸运）:', e.message);
  }

  // 攻击2: 绕过认证
  try {
    const maliciousId = "1 OR 1=1";
    console.log('尝试绕过认证:', maliciousId);
    const allNotes = manager.getNoteByIdUnsafe(maliciousId);
    console.log('泄露数据:', allNotes);
  } catch (e) {
    console.log('攻击失败:', e.message);
  }

  // 攻击3: 联合查询注入
  try {
    const maliciousKeyword = "' UNION SELECT password FROM users WHERE '1'='1";
    console.log('尝试联合查询注入:', maliciousKeyword);
    manager.searchNotesUnsafe(maliciousKeyword);
  } catch (e) {
    console.log('攻击失败:', e.message);
  }

  manager.close();

  console.log('\n💡 防御方法: 使用参数化查询（见 database-good.js）');
}

// ✅ 如何修复这些问题？

class SafeNotesManager {
  constructor(dbPath) {
    this.db = new Database(dbPath);
  }

  // ✅ 修复方法: 使用 prepare() + 参数
  createNoteSafe(title, content) {
    const stmt = this.db.prepare('INSERT INTO notes (title, content, created_at) VALUES (?, ?, ?)');
    return stmt.run(title, content, Date.now());
  }

  // ✅ 修复方法: 参数化 WHERE 子句
  getNoteByIdSafe(id) {
    const stmt = this.db.prepare('SELECT * FROM notes WHERE id = ?');
    return stmt.get(id);
  }

  // ✅ 修复方法: LIKE 参数也通过占位符
  searchNotesSafe(keyword) {
    const stmt = this.db.prepare('SELECT * FROM notes WHERE title LIKE ?');
    return stmt.all(`%${keyword}%`);
  }

  // ✅ 修复方法: 表名/列名使用白名单
  getNotesFromTableSafe(tableName) {
    const allowedTables = ['notes', 'archived_notes'];
    if (!allowedTables.includes(tableName)) {
      throw new Error('Invalid table name');
    }
    const stmt = this.db.prepare(`SELECT * FROM ${tableName}`);
    return stmt.all();
  }

  // ✅ 修复方法: 动态字段使用白名单 + 参数化值
  updateNoteSafe(id, updates) {
    const allowedFields = ['title', 'content', 'tags'];
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);

    const stmt = this.db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`);
    return stmt.run(...values);
  }

  close() {
    this.db.close();
  }
}

module.exports = { UnsafeNotesManager, SafeNotesManager };

// 运行示例
if (require.main === module) {
  console.log('===== ❌ 不安全的代码示例 =====\n');
  demonstrateAttacks();

  console.log('\n===== ✅ 安全的代码示例 =====\n');
  const safeManager = new SafeNotesManager(':memory:');

  // 创建表
  safeManager.db.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // 安全地创建笔记
  const note = safeManager.createNoteSafe('安全的标题', '安全的内容');
  console.log('创建成功:', note);

  // 即使输入恶意数据也安全
  const maliciousInput = "'; DROP TABLE notes; --";
  safeManager.createNoteSafe(maliciousInput, '这只会作为普通文本存储');
  console.log('恶意输入已安全存储（作为普通文本）');

  // 搜索
  const results = safeManager.searchNotesSafe('标题');
  console.log('搜索结果:', results);

  safeManager.close();

  console.log('\n✅ 安全操作完成！');
}
