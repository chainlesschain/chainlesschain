/**
 * 知识库命令处理器
 */

const { logger } = require('../../utils/logger');

class KnowledgeHandler {
  constructor(database, ragManager) {
    this.database = database;
    this.ragManager = ragManager;
    logger.info('[KnowledgeHandler] 知识库命令处理器已初始化');
  }

  async handle(action, params, context) {
    logger.debug('[KnowledgeHandler] 处理命令: ' + action);
    
    switch (action) {
      case 'createNote':
        return await this.createNote(params, context);
      case 'searchNotes':
        return await this.searchNotes(params, context);
      case 'getNoteById':
        return await this.getNoteById(params, context);
      case 'getTags':
        return await this.getTags(params, context);
      default:
        throw new Error('Unknown action: ' + action);
    }
  }

  async createNote(params, context) {
    const { title, content, tags = [] } = params;
    if (!title || !content) {
      throw new Error('Title and content are required');
    }

    logger.info('[KnowledgeHandler] 创建笔记: ' + title);

    const result = await this.database.run(
      'INSERT INTO notes (title, content, tags, created_by_did, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [title, content, JSON.stringify(tags), context.did, Date.now(), Date.now()]
    );

    return { noteId: result.lastID, title, message: 'Note created successfully' };
  }

  async searchNotes(params, context) {
    const { query, limit = 10 } = params;
    if (!query) throw new Error('Search query is required');

    logger.info('[KnowledgeHandler] 搜索笔记: ' + query);

    const rows = await this.database.all(
      'SELECT id, title, content, tags FROM notes WHERE title LIKE ? OR content LIKE ? LIMIT ?',
      ['%' + query + '%', '%' + query + '%', limit]
    );

    return { results: rows, total: rows.length };
  }

  async getNoteById(params, context) {
    const { noteId } = params;
    if (!noteId) throw new Error('Note ID is required');

    const row = await this.database.get('SELECT * FROM notes WHERE id = ?', [noteId]);
    if (!row) throw new Error('Note not found');

    return row;
  }

  async getTags(params, context) {
    const rows = await this.database.all('SELECT DISTINCT tags FROM notes WHERE tags IS NOT NULL');
    const tagSet = new Set();
    rows.forEach(row => {
      const tags = JSON.parse(row.tags || '[]');
      tags.forEach(tag => tagSet.add(tag));
    });

    return { tags: Array.from(tagSet).sort(), total: tagSet.size };
  }
}

module.exports = KnowledgeHandler;
