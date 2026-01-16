-- 迁移008: 会话模板系统
-- 创建日期: 2026-01-16
-- 用于 SessionManager 模板功能

-- =====================================================
-- 1. 会话模板表 (llm_session_templates)
-- =====================================================
CREATE TABLE IF NOT EXISTS llm_session_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'default',
  source_session_id TEXT,
  messages TEXT NOT NULL,  -- JSON 数组，存储模板消息
  metadata TEXT,  -- JSON 对象，存储元数据（创建时间、使用次数等）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_session_id) REFERENCES llm_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_templates_name ON llm_session_templates(name);
CREATE INDEX IF NOT EXISTS idx_llm_templates_category ON llm_session_templates(category);
CREATE INDEX IF NOT EXISTS idx_llm_templates_updated_at ON llm_session_templates(updated_at);

-- =====================================================
-- 2. 更新 llm_sessions 表（添加摘要和标签相关索引）
-- =====================================================
-- 注意：SQLite 不支持创建基于 JSON 的索引，但可以通过触发器维护

-- =====================================================
-- 3. 插入默认模板
-- =====================================================
INSERT OR IGNORE INTO llm_session_templates (
  id, name, description, category,
  messages, metadata, created_at, updated_at
) VALUES (
  'default-coding-assistant',
  '编程助手',
  '用于代码编写、调试和优化的对话模板',
  'coding',
  '[{"role":"system","content":"你是一个专业的编程助手，擅长代码编写、调试和优化。请提供清晰、可维护的代码示例。"}]',
  '{"useCount":0,"createdAt":' || (strftime('%s', 'now') * 1000) || ',"updatedAt":' || (strftime('%s', 'now') * 1000) || '}',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);

INSERT OR IGNORE INTO llm_session_templates (
  id, name, description, category,
  messages, metadata, created_at, updated_at
) VALUES (
  'default-writing-assistant',
  '写作助手',
  '用于文章写作、内容创作和编辑的对话模板',
  'writing',
  '[{"role":"system","content":"你是一个专业的写作助手，擅长内容创作、文章编辑和润色。请提供有创意且表达清晰的内容。"}]',
  '{"useCount":0,"createdAt":' || (strftime('%s', 'now') * 1000) || ',"updatedAt":' || (strftime('%s', 'now') * 1000) || '}',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);

INSERT OR IGNORE INTO llm_session_templates (
  id, name, description, category,
  messages, metadata, created_at, updated_at
) VALUES (
  'default-learning-assistant',
  '学习助手',
  '用于知识学习、概念解释和问题解答的对话模板',
  'learning',
  '[{"role":"system","content":"你是一个耐心的学习助手，擅长解释复杂概念，并通过示例帮助用户理解。请循序渐进地讲解知识点。"}]',
  '{"useCount":0,"createdAt":' || (strftime('%s', 'now') * 1000) || ',"updatedAt":' || (strftime('%s', 'now') * 1000) || '}',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);

INSERT OR IGNORE INTO llm_session_templates (
  id, name, description, category,
  messages, metadata, created_at, updated_at
) VALUES (
  'default-analysis-assistant',
  '数据分析助手',
  '用于数据分析、报告解读和业务洞察的对话模板',
  'analysis',
  '[{"role":"system","content":"你是一个数据分析专家，擅长数据解读、趋势分析和业务洞察。请提供基于数据的客观分析和建议。"}]',
  '{"useCount":0,"createdAt":' || (strftime('%s', 'now') * 1000) || ',"updatedAt":' || (strftime('%s', 'now') * 1000) || '}',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);
