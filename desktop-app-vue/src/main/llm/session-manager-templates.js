/**
 * SessionManager — templates methods (prototype mixin).
 * Split verbatim from session-manager.js; mixed into SessionManager.prototype.
 * Methods reference `this` (db / sessionCache / llmManager / ...) exactly as before.
 *
 * @module llm/session-manager-templates
 */
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

module.exports = {
  async saveAsTemplate(sessionId, templateInfo) {
    const { name, description = "", category = "default" } = templateInfo;

    try {
      const session = await this.loadSession(sessionId);
      const templateId = uuidv4();
      const now = Date.now();

      const template = {
        id: templateId,
        name,
        description,
        category,
        sourceSessionId: sessionId,
        messages: session.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        metadata: {
          createdAt: now,
          updatedAt: now,
          useCount: 0,
        },
      };

      // 保存到数据库
      const stmt = this.db.prepare(`
        INSERT INTO llm_session_templates (
          id, name, description, category, source_session_id,
          messages, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        templateId,
        name,
        description,
        category,
        sessionId,
        JSON.stringify(template.messages),
        JSON.stringify(template.metadata),
        now,
        now,
      );

      logger.info(`[SessionManager] 会话 ${sessionId} 保存为模板: ${name}`);
      this.emit("template-created", { templateId, name });

      return template;
    } catch (error) {
      // 如果表不存在，尝试创建
      if (error.message.includes("no such table")) {
        await this._ensureTemplateTable();
        return this.saveAsTemplate(sessionId, templateInfo);
      }
      logger.error("[SessionManager] 保存模板失败:", error);
      throw error;
    }
  },

  async _ensureTemplateTable() {
    // 使用 prepare().run() 替代 exec() 以符合安全规范
    // 注意：此 SQL 是硬编码的 DDL，不包含用户输入
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS llm_session_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'default',
        source_session_id TEXT,
        messages TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      )
      .run();
    logger.info("[SessionManager] 模板表已创建");
  },

  async createFromTemplate(templateId, options = {}) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM llm_session_templates WHERE id = ?
      `);
      const template = stmt.get(templateId);

      if (!template) {
        throw new Error(`模板不存在: ${templateId}`);
      }

      const messages = JSON.parse(template.messages || "[]");

      // 创建新会话
      const newSession = await this.createSession({
        conversationId: options.conversationId || `template-${Date.now()}`,
        title: options.title || `来自模板: ${template.name}`,
        metadata: {
          templateId,
          templateName: template.name,
        },
      });

      // 添加模板消息
      for (const msg of messages) {
        await this.addMessage(newSession.id, msg);
      }

      // 更新模板使用次数
      const updateStmt = this.db.prepare(`
        UPDATE llm_session_templates
        SET metadata = json_set(metadata, '$.useCount', json_extract(metadata, '$.useCount') + 1),
            updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run(Date.now(), templateId);

      logger.info(`[SessionManager] 从模板 ${template.name} 创建会话`);
      return newSession;
    } catch (error) {
      logger.error("[SessionManager] 从模板创建失败:", error);
      throw error;
    }
  },

  async listTemplates(options = {}) {
    const { category, limit = 50 } = options;

    try {
      await this._ensureTemplateTable();

      let sql = `
        SELECT id, name, description, category, source_session_id,
               metadata, created_at, updated_at
        FROM llm_session_templates
      `;
      const params = [];

      if (category) {
        sql += " WHERE category = ?";
        params.push(category);
      }

      sql += " ORDER BY updated_at DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        sourceSessionId: row.source_session_id,
        metadata:
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata || "{}")
            : row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error("[SessionManager] 列出模板失败:", error);
      throw error;
    }
  },

  async deleteTemplate(templateId) {
    try {
      const stmt = this.db.prepare(
        "DELETE FROM llm_session_templates WHERE id = ?",
      );
      stmt.run(templateId);

      logger.info(`[SessionManager] 模板已删除: ${templateId}`);
      this.emit("template-deleted", { templateId });
    } catch (error) {
      logger.error("[SessionManager] 删除模板失败:", error);
      throw error;
    }
  },
};
