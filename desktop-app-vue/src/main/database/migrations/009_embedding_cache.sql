-- 009_embedding_cache.sql
-- Embedding 缓存表 (用于 Permanent Memory 永久记忆系统)
-- 缓存已计算的 Embedding，避免重复计算，节省 70% 计算时间
-- 创建时间: 2026-02-01

-- ============================================
-- Embedding 缓存表
-- ============================================

CREATE TABLE IF NOT EXISTS embedding_cache (
  -- 主键: 内容 hash (SHA-256)
  content_hash TEXT PRIMARY KEY,

  -- Embedding 向量 (序列化为 BLOB)
  -- Float32Array → Buffer
  embedding BLOB NOT NULL,

  -- 模型名称 (如 'qwen2:7b', 'text-embedding-ada-002')
  model TEXT NOT NULL,

  -- 向量维度 (用于验证)
  dimension INTEGER NOT NULL,

  -- 原始内容 (可选，用于调试)
  -- 生产环境可设置为 NULL 以节省空间
  original_content TEXT,

  -- 创建时间 (Unix timestamp, ms)
  created_at INTEGER NOT NULL,

  -- 最后访问时间 (用于 LRU 清理)
  last_accessed_at INTEGER NOT NULL,

  -- 访问计数 (用于统计)
  access_count INTEGER DEFAULT 1
);

-- 索引: 按模型查询
CREATE INDEX IF NOT EXISTS idx_embedding_cache_model
ON embedding_cache(model);

-- 索引: 按最后访问时间 (用于清理过期缓存)
CREATE INDEX IF NOT EXISTS idx_embedding_cache_last_accessed
ON embedding_cache(last_accessed_at);

-- 索引: 按创建时间
CREATE INDEX IF NOT EXISTS idx_embedding_cache_created
ON embedding_cache(created_at);

-- ============================================
-- 文件 Hash 跟踪表
-- ============================================

CREATE TABLE IF NOT EXISTS memory_file_hashes (
  -- 文件路径 (相对路径)
  file_path TEXT PRIMARY KEY,

  -- 文件内容 hash (SHA-256)
  content_hash TEXT NOT NULL,

  -- 文件大小 (bytes)
  file_size INTEGER NOT NULL,

  -- 最后修改时间 (Unix timestamp, ms)
  last_modified_at INTEGER NOT NULL,

  -- 最后索引时间
  last_indexed_at INTEGER NOT NULL,

  -- 索引状态: 'pending', 'indexed', 'failed'
  index_status TEXT DEFAULT 'pending',

  -- 分块数量
  chunk_count INTEGER DEFAULT 0,

  -- 错误信息 (如果索引失败)
  error_message TEXT
);

-- 索引: 按索引状态
CREATE INDEX IF NOT EXISTS idx_memory_file_hashes_status
ON memory_file_hashes(index_status);

-- 索引: 按最后修改时间
CREATE INDEX IF NOT EXISTS idx_memory_file_hashes_modified
ON memory_file_hashes(last_modified_at);

-- ============================================
-- Daily Notes 元数据表
-- ============================================

CREATE TABLE IF NOT EXISTS daily_notes_metadata (
  -- 日期 (YYYY-MM-DD)
  date TEXT PRIMARY KEY,

  -- 标题
  title TEXT,

  -- 对话数
  conversation_count INTEGER DEFAULT 0,

  -- 完成任务数
  completed_tasks INTEGER DEFAULT 0,

  -- 待办任务数
  pending_tasks INTEGER DEFAULT 0,

  -- 技术发现数
  discoveries_count INTEGER DEFAULT 0,

  -- 字数统计
  word_count INTEGER DEFAULT 0,

  -- 创建时间
  created_at INTEGER NOT NULL,

  -- 最后更新时间
  updated_at INTEGER NOT NULL
);

-- 索引: 按日期降序 (查询最近日志)
CREATE INDEX IF NOT EXISTS idx_daily_notes_date_desc
ON daily_notes_metadata(date DESC);

-- ============================================
-- MEMORY.md 内容分类表
-- ============================================

CREATE TABLE IF NOT EXISTS memory_sections (
  -- 自增主键
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 分类: 'user_preference', 'architecture_decision', 'troubleshooting', 'discovery', 'config'
  category TEXT NOT NULL,

  -- 子分类 (可选)
  subcategory TEXT,

  -- 标题
  title TEXT NOT NULL,

  -- 内容 (Markdown)
  content TEXT NOT NULL,

  -- 标签 (JSON 数组)
  tags TEXT,

  -- 重要程度: 1-5
  importance INTEGER DEFAULT 3,

  -- 创建时间
  created_at INTEGER NOT NULL,

  -- 最后更新时间
  updated_at INTEGER NOT NULL
);

-- 索引: 按分类
CREATE INDEX IF NOT EXISTS idx_memory_sections_category
ON memory_sections(category);

-- 索引: 按重要程度
CREATE INDEX IF NOT EXISTS idx_memory_sections_importance
ON memory_sections(importance DESC);

-- 索引: 按更新时间
CREATE INDEX IF NOT EXISTS idx_memory_sections_updated
ON memory_sections(updated_at DESC);

-- ============================================
-- 记忆统计表
-- ============================================

CREATE TABLE IF NOT EXISTS memory_stats (
  -- 统计日期 (YYYY-MM-DD)
  date TEXT PRIMARY KEY,

  -- Daily Notes 总条数
  daily_notes_count INTEGER DEFAULT 0,

  -- MEMORY.md 条目数
  memory_sections_count INTEGER DEFAULT 0,

  -- 缓存 Embedding 数
  cached_embeddings_count INTEGER DEFAULT 0,

  -- 索引文件数
  indexed_files_count INTEGER DEFAULT 0,

  -- 总搜索次数
  total_searches INTEGER DEFAULT 0,

  -- Vector Search 次数
  vector_searches INTEGER DEFAULT 0,

  -- BM25 Search 次数
  bm25_searches INTEGER DEFAULT 0,

  -- 混合搜索次数
  hybrid_searches INTEGER DEFAULT 0,

  -- 缓存命中次数
  cache_hits INTEGER DEFAULT 0,

  -- 缓存未命中次数
  cache_misses INTEGER DEFAULT 0,

  -- 平均搜索延迟 (ms)
  avg_search_latency REAL DEFAULT 0,

  -- 更新时间
  updated_at INTEGER NOT NULL
);

-- 索引: 按日期降序
CREATE INDEX IF NOT EXISTS idx_memory_stats_date_desc
ON memory_stats(date DESC);

-- ============================================
-- 初始化默认数据
-- ============================================

-- 插入今日统计记录
INSERT OR IGNORE INTO memory_stats (date, updated_at)
VALUES (date('now'), strftime('%s', 'now') * 1000);
