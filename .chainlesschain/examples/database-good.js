/**
 * ✅ 数据库操作正确示例
 *
 * 本文件展示如何安全地使用 better-sqlite3 进行数据库操作
 */

const Database = require('better-sqlite3');

class NotesManager {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.initTables();
  }

  /**
   * 初始化表结构
   * ✅ 静态 DDL 可以使用 exec()
   */
  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notes_created_at
      ON notes(created_at)
    `);
  }

  /**
   * 创建笔记
   * ✅ 使用 prepare() + run() 进行参数化插入
   */
  createNote(title, content, tags = '') {
    const stmt = this.db.prepare(`
      INSERT INTO notes (title, content, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    const info = stmt.run(title, content, tags, now, now);

    return {
      id: info.lastInsertRowid,
      title,
      content,
      tags,
      created_at: now,
      updated_at: now
    };
  }

  /**
   * 批量创建笔记
   * ✅ 使用事务提高性能
   */
  createNotesInBulk(notes) {
    const insert = this.db.prepare(`
      INSERT INTO notes (title, content, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((notesArray) => {
      const now = Date.now();
      const results = [];

      for (const note of notesArray) {
        const info = insert.run(
          note.title,
          note.content,
          note.tags || '',
          now,
          now
        );
        results.push({ id: info.lastInsertRowid, ...note });
      }

      return results;
    });

    return insertMany(notes);
  }

  /**
   * 获取单个笔记
   * ✅ 使用 prepare() + get() 查询单行
   */
  getNoteById(id) {
    const stmt = this.db.prepare('SELECT * FROM notes WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * 获取所有笔记
   * ✅ 使用 prepare() + all() 查询多行
   */
  getAllNotes() {
    const stmt = this.db.prepare('SELECT * FROM notes ORDER BY created_at DESC');
    return stmt.all();
  }

  /**
   * 搜索笔记
   * ✅ LIKE 查询的通配符也通过参数传递
   */
  searchNotes(keyword) {
    const stmt = this.db.prepare(`
      SELECT * FROM notes
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY created_at DESC
    `);

    const pattern = `%${keyword}%`;
    return stmt.all(pattern, pattern);
  }

  /**
   * 根据标签过滤
   * ✅ IN 子句使用动态占位符
   */
  getNotesByTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
      return [];
    }

    const placeholders = tags.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM notes
      WHERE tags IN (${placeholders})
      ORDER BY created_at DESC
    `);

    return stmt.all(...tags);
  }

  /**
   * 更新笔记
   * ✅ 使用参数化 UPDATE
   */
  updateNote(id, updates) {
    const now = Date.now();

    // 方法1: 固定字段更新
    if (updates.title !== undefined && updates.content !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE notes
        SET title = ?, content = ?, updated_at = ?
        WHERE id = ?
      `);
      const info = stmt.run(updates.title, updates.content, now, id);
      return info.changes > 0;
    }

    // 方法2: 动态字段更新（使用白名单）
    return this.updateNoteDynamic(id, updates);
  }

  /**
   * 动态字段更新
   * ✅ 白名单验证 + 参数化值
   */
  updateNoteDynamic(id, updates) {
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

    // 添加 updated_at
    fields.push('updated_at = ?');
    values.push(Date.now());

    // 添加 WHERE 条件的参数
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE notes SET ${fields.join(', ')} WHERE id = ?
    `);

    const info = stmt.run(...values);
    return info.changes > 0;
  }

  /**
   * 删除笔记
   * ✅ 参数化 DELETE
   */
  deleteNote(id) {
    const stmt = this.db.prepare('DELETE FROM notes WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
  }

  /**
   * 批量删除
   * ✅ 使用事务 + 参数化
   */
  deleteNotes(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return 0;
    }

    const deleteStmt = this.db.prepare('DELETE FROM notes WHERE id = ?');

    const deleteMany = this.db.transaction((idArray) => {
      let deleted = 0;
      for (const id of idArray) {
        deleted += deleteStmt.run(id).changes;
      }
      return deleted;
    });

    return deleteMany(ids);
  }

  /**
   * 软删除（推荐）
   * ✅ 使用 deleted_at 标记而非真正删除
   */
  softDeleteNote(id, deletedBy) {
    // 注意: 需要先添加 deleted_at 和 deleted_by 列
    const stmt = this.db.prepare(`
      UPDATE notes
      SET deleted_at = ?, deleted_by = ?
      WHERE id = ? AND deleted_at IS NULL
    `);

    const info = stmt.run(Date.now(), deletedBy, id);
    return info.changes > 0;
  }

  /**
   * 分页查询
   * ✅ LIMIT 和 OFFSET 也使用参数
   */
  getNotesWithPagination(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;

    const stmt = this.db.prepare(`
      SELECT * FROM notes
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    const countStmt = this.db.prepare('SELECT COUNT(*) as total FROM notes');

    return {
      data: stmt.all(pageSize, offset),
      total: countStmt.get().total,
      page,
      pageSize
    };
  }

  /**
   * 复杂条件查询
   * ✅ 动态构建 WHERE 子句（安全）
   */
  searchWithFilters(filters) {
    const conditions = [];
    const values = [];

    // 白名单验证字段
    const allowedFilters = {
      title: (val) => {
        conditions.push('title LIKE ?');
        values.push(`%${val}%`);
      },
      tags: (val) => {
        conditions.push('tags = ?');
        values.push(val);
      },
      dateFrom: (val) => {
        conditions.push('created_at >= ?');
        values.push(val);
      },
      dateTo: (val) => {
        conditions.push('created_at <= ?');
        values.push(val);
      }
    };

    for (const [key, value] of Object.entries(filters)) {
      if (allowedFilters[key]) {
        allowedFilters[key](value);
      }
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const stmt = this.db.prepare(`
      SELECT * FROM notes
      ${whereClause}
      ORDER BY created_at DESC
    `);

    return stmt.all(...values);
  }

  /**
   * 关闭数据库连接
   */
  close() {
    this.db.close();
  }
}

module.exports = NotesManager;

// ✅ 使用示例
if (require.main === module) {
  const manager = new NotesManager(':memory:');

  // 创建笔记
  const note1 = manager.createNote('我的第一篇笔记', '这是内容', 'work');
  console.log('创建成功:', note1);

  // 批量创建
  const notes = manager.createNotesInBulk([
    { title: '笔记2', content: '内容2', tags: 'personal' },
    { title: '笔记3', content: '内容3', tags: 'work' }
  ]);
  console.log('批量创建:', notes.length);

  // 搜索
  const results = manager.searchNotes('笔记');
  console.log('搜索结果:', results.length);

  // 更新
  manager.updateNote(note1.id, { title: '更新后的标题' });

  // 分页
  const page = manager.getNotesWithPagination(1, 10);
  console.log('分页数据:', page);

  manager.close();
}
