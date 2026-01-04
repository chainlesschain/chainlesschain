/**
 * 数据库迁移：为社交功能表添加外键约束
 *
 * Migration ID: 001_add_social_foreign_keys
 * Date: 2026-01-04
 * Description:
 *   - 为 post_likes 表添加外键约束（posts.id）
 *   - 为 post_comments 表添加外键约束（posts.id 和 parent_id）
 *   - 使用重建表的方式（SQLite不支持直接添加外键）
 */

/**
 * 执行迁移
 * @param {Object} db - 数据库实例
 */
async function up(db) {
  console.log('[Migration] 开始执行：添加社交功能外键约束');

  try {
    // 启用外键约束检查
    db.exec('PRAGMA foreign_keys = ON');

    // ========================================
    // 1. 迁移 post_likes 表
    // ========================================
    console.log('[Migration] 迁移 post_likes 表...');

    // 检查表是否存在
    const likesTableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='post_likes'"
    ).get();

    if (likesTableExists) {
      // 检查是否已经有外键（通过 pragma 检查）
      const foreignKeys = db.prepare('PRAGMA foreign_key_list(post_likes)').all();

      if (foreignKeys.length === 0) {
        // 没有外键，需要迁移

        // 1.1 创建临时表（带外键约束）
        db.exec(`
          CREATE TABLE post_likes_new (
            post_id TEXT NOT NULL,
            user_did TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (post_id, user_did),
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
          )
        `);

        // 1.2 复制数据（只复制有效的数据，即post_id存在于posts表中的）
        db.exec(`
          INSERT INTO post_likes_new (post_id, user_did, created_at)
          SELECT pl.post_id, pl.user_did, pl.created_at
          FROM post_likes pl
          WHERE EXISTS (SELECT 1 FROM posts WHERE id = pl.post_id)
        `);

        // 1.3 删除旧表
        db.exec('DROP TABLE post_likes');

        // 1.4 重命名新表
        db.exec('ALTER TABLE post_likes_new RENAME TO post_likes');

        console.log('[Migration] post_likes 表迁移完成');
      } else {
        console.log('[Migration] post_likes 表已有外键约束，跳过迁移');
      }
    } else {
      console.log('[Migration] post_likes 表不存在，跳过迁移');
    }

    // ========================================
    // 2. 迁移 post_comments 表
    // ========================================
    console.log('[Migration] 迁移 post_comments 表...');

    const commentsTableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='post_comments'"
    ).get();

    if (commentsTableExists) {
      // 检查是否已经有外键
      const foreignKeys = db.prepare('PRAGMA foreign_key_list(post_comments)').all();

      if (foreignKeys.length === 0) {
        // 没有外键，需要迁移

        // 2.1 创建临时表（带外键约束）
        db.exec(`
          CREATE TABLE post_comments_new (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            author_did TEXT NOT NULL,
            content TEXT NOT NULL,
            parent_id TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE
          )
        `);

        // 2.2 复制数据（只复制有效的数据）
        db.exec(`
          INSERT INTO post_comments_new (id, post_id, author_did, content, parent_id, created_at)
          SELECT pc.id, pc.post_id, pc.author_did, pc.content, pc.parent_id, pc.created_at
          FROM post_comments pc
          WHERE EXISTS (SELECT 1 FROM posts WHERE id = pc.post_id)
            AND (pc.parent_id IS NULL OR EXISTS (SELECT 1 FROM post_comments WHERE id = pc.parent_id))
        `);

        // 2.3 删除旧表
        db.exec('DROP TABLE post_comments');

        // 2.4 重命名新表
        db.exec('ALTER TABLE post_comments_new RENAME TO post_comments');

        // 2.5 重建索引
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_comments_post_id ON post_comments(post_id);
          CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON post_comments(parent_id);
        `);

        console.log('[Migration] post_comments 表迁移完成');
      } else {
        console.log('[Migration] post_comments 表已有外键约束，跳过迁移');
      }
    } else {
      console.log('[Migration] post_comments 表不存在，跳过迁移');
    }

    console.log('[Migration] 迁移完成：添加社交功能外键约束');
    return true;
  } catch (error) {
    console.error('[Migration] 迁移失败:', error);
    throw error;
  }
}

/**
 * 回滚迁移
 * @param {Object} db - 数据库实例
 */
async function down(db) {
  console.log('[Migration] 回滚：移除社交功能外键约束');

  try {
    // ========================================
    // 1. 回滚 post_likes 表
    // ========================================
    console.log('[Migration] 回滚 post_likes 表...');

    const likesTableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='post_likes'"
    ).get();

    if (likesTableExists) {
      // 创建无外键约束的临时表
      db.exec(`
        CREATE TABLE post_likes_rollback (
          post_id TEXT NOT NULL,
          user_did TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (post_id, user_did)
        )
      `);

      // 复制数据
      db.exec(`
        INSERT INTO post_likes_rollback
        SELECT * FROM post_likes
      `);

      // 删除旧表
      db.exec('DROP TABLE post_likes');

      // 重命名
      db.exec('ALTER TABLE post_likes_rollback RENAME TO post_likes');

      console.log('[Migration] post_likes 表回滚完成');
    }

    // ========================================
    // 2. 回滚 post_comments 表
    // ========================================
    console.log('[Migration] 回滚 post_comments 表...');

    const commentsTableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='post_comments'"
    ).get();

    if (commentsTableExists) {
      // 创建无外键约束的临时表
      db.exec(`
        CREATE TABLE post_comments_rollback (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL,
          author_did TEXT NOT NULL,
          content TEXT NOT NULL,
          parent_id TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      // 复制数据
      db.exec(`
        INSERT INTO post_comments_rollback
        SELECT * FROM post_comments
      `);

      // 删除旧表
      db.exec('DROP TABLE post_comments');

      // 重命名
      db.exec('ALTER TABLE post_comments_rollback RENAME TO post_comments');

      // 重建索引
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_comments_post_id ON post_comments(post_id);
        CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON post_comments(parent_id);
      `);

      console.log('[Migration] post_comments 表回滚完成');
    }

    console.log('[Migration] 回滚完成');
    return true;
  } catch (error) {
    console.error('[Migration] 回滚失败:', error);
    throw error;
  }
}

module.exports = {
  id: '001_add_social_foreign_keys',
  description: '为社交功能表添加外键约束',
  up,
  down
};
