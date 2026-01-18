-- =============================================================================
-- Context Association System Tables
-- =============================================================================
-- Version: 1.0.0
-- Created: 2026-01-18
-- Description: Tables for intelligent context association including session
--              knowledge extraction, cross-session associations, and
--              conversation context tracking.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Session Knowledge Table
-- -----------------------------------------------------------------------------
-- Stores extracted knowledge from sessions
CREATE TABLE IF NOT EXISTS session_knowledge (
  id TEXT PRIMARY KEY,                      -- Unique knowledge ID (UUID)
  session_id TEXT NOT NULL,                 -- Source session ID
  knowledge_type TEXT NOT NULL,             -- 'topic', 'decision', 'code_snippet', 'reference', 'question', 'answer'
  content TEXT NOT NULL,                    -- The extracted knowledge content
  summary TEXT,                             -- Short summary
  tags TEXT,                                -- JSON array of tags
  entities TEXT,                            -- JSON array of extracted entities
  importance REAL DEFAULT 0.5,              -- Importance score (0-1)
  confidence REAL DEFAULT 0.5,              -- Extraction confidence (0-1)
  source_message_id TEXT,                   -- Source message ID (if applicable)
  metadata TEXT,                            -- JSON additional metadata
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for session queries
CREATE INDEX IF NOT EXISTS idx_session_knowledge_session
  ON session_knowledge(session_id);

-- Index for knowledge type queries
CREATE INDEX IF NOT EXISTS idx_session_knowledge_type
  ON session_knowledge(knowledge_type, importance DESC);

-- Index for importance ranking
CREATE INDEX IF NOT EXISTS idx_session_knowledge_importance
  ON session_knowledge(importance DESC);

-- Full-text search (if FTS5 is available)
-- CREATE VIRTUAL TABLE IF NOT EXISTS session_knowledge_fts USING fts5(
--   content, summary, tags,
--   content=session_knowledge
-- );

-- -----------------------------------------------------------------------------
-- 2. Session Associations Table
-- -----------------------------------------------------------------------------
-- Stores relationships between sessions
CREATE TABLE IF NOT EXISTS session_associations (
  id TEXT PRIMARY KEY,                      -- Unique association ID (UUID)
  session_id_1 TEXT NOT NULL,               -- First session ID
  session_id_2 TEXT NOT NULL,               -- Second session ID
  association_type TEXT NOT NULL,           -- 'topic_similarity', 'continuation', 'reference', 'follow_up'
  similarity_score REAL,                    -- Similarity score (0-1)
  shared_topics TEXT,                       -- JSON array of shared topics
  shared_entities TEXT,                     -- JSON array of shared entities
  confidence REAL DEFAULT 0.5,              -- Confidence in the association
  is_confirmed INTEGER DEFAULT 0,           -- Whether user confirmed
  created_at INTEGER NOT NULL
);

-- Index for session queries (both directions)
CREATE INDEX IF NOT EXISTS idx_session_associations_session1
  ON session_associations(session_id_1);

CREATE INDEX IF NOT EXISTS idx_session_associations_session2
  ON session_associations(session_id_2);

-- Index for association type
CREATE INDEX IF NOT EXISTS idx_session_associations_type
  ON session_associations(association_type, similarity_score DESC);

-- Unique constraint to prevent duplicate associations
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_associations_unique
  ON session_associations(session_id_1, session_id_2, association_type);

-- -----------------------------------------------------------------------------
-- 3. Conversation Context Table
-- -----------------------------------------------------------------------------
-- Tracks the current context of conversations
CREATE TABLE IF NOT EXISTS conversation_context (
  id TEXT PRIMARY KEY,                      -- Unique context ID (UUID)
  conversation_id TEXT NOT NULL UNIQUE,     -- Conversation ID
  topics TEXT,                              -- JSON array of current topics
  key_decisions TEXT,                       -- JSON array of decisions made
  unresolved_questions TEXT,                -- JSON array of open questions
  mentioned_entities TEXT,                  -- JSON array of entities mentioned
  code_references TEXT,                     -- JSON array of code snippets/files
  context_vector TEXT,                      -- Embedding vector (if available)
  last_activity_type TEXT,                  -- Last type of activity
  message_count INTEGER DEFAULT 0,          -- Number of messages
  turn_count INTEGER DEFAULT 0,             -- Number of conversation turns
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for conversation lookup
CREATE INDEX IF NOT EXISTS idx_conversation_context_conversation
  ON conversation_context(conversation_id);

-- Index for topic-based queries
CREATE INDEX IF NOT EXISTS idx_conversation_context_updated
  ON conversation_context(updated_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Topic Taxonomy Table
-- -----------------------------------------------------------------------------
-- Hierarchical topic organization
CREATE TABLE IF NOT EXISTS topic_taxonomy (
  id TEXT PRIMARY KEY,                      -- Unique topic ID (UUID)
  topic_name TEXT NOT NULL UNIQUE,          -- Topic name
  parent_topic_id TEXT,                     -- Parent topic ID
  description TEXT,                         -- Topic description
  usage_count INTEGER DEFAULT 0,            -- How often this topic appears
  related_topics TEXT,                      -- JSON array of related topic IDs
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_topic_id) REFERENCES topic_taxonomy(id) ON DELETE SET NULL
);

-- Index for parent lookups
CREATE INDEX IF NOT EXISTS idx_topic_taxonomy_parent
  ON topic_taxonomy(parent_topic_id);

-- Index for usage ranking
CREATE INDEX IF NOT EXISTS idx_topic_taxonomy_usage
  ON topic_taxonomy(usage_count DESC);

-- -----------------------------------------------------------------------------
-- 5. Knowledge Graph Edges Table
-- -----------------------------------------------------------------------------
-- Stores relationships between knowledge items
CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
  id TEXT PRIMARY KEY,                      -- Unique edge ID
  source_id TEXT NOT NULL,                  -- Source knowledge ID
  target_id TEXT NOT NULL,                  -- Target knowledge ID
  edge_type TEXT NOT NULL,                  -- 'related_to', 'answers', 'contradicts', 'extends', 'references'
  weight REAL DEFAULT 1.0,                  -- Edge weight/strength
  metadata TEXT,                            -- JSON additional metadata
  created_at INTEGER NOT NULL
);

-- Index for graph traversal
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_source
  ON knowledge_graph_edges(source_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_target
  ON knowledge_graph_edges(target_id);

-- Unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_graph_unique
  ON knowledge_graph_edges(source_id, target_id, edge_type);

-- =============================================================================
-- Views for Context Analysis
-- =============================================================================

-- Knowledge overview by session
CREATE VIEW IF NOT EXISTS session_knowledge_overview AS
SELECT
  session_id,
  COUNT(*) as knowledge_count,
  GROUP_CONCAT(DISTINCT knowledge_type) as knowledge_types,
  AVG(importance) as avg_importance,
  MAX(created_at) as last_updated
FROM session_knowledge
GROUP BY session_id
ORDER BY last_updated DESC;

-- Topic frequency view
CREATE VIEW IF NOT EXISTS topic_frequency AS
SELECT
  json_each.value as topic,
  COUNT(*) as frequency,
  AVG(sk.importance) as avg_importance
FROM session_knowledge sk,
     json_each(sk.tags)
WHERE sk.tags IS NOT NULL
GROUP BY json_each.value
ORDER BY frequency DESC
LIMIT 50;

-- Related sessions view
CREATE VIEW IF NOT EXISTS related_sessions AS
SELECT
  sa.session_id_1,
  sa.session_id_2,
  sa.association_type,
  sa.similarity_score,
  sa.shared_topics,
  sa.is_confirmed
FROM session_associations sa
WHERE sa.similarity_score >= 0.5
ORDER BY sa.similarity_score DESC;

-- Active conversations context
CREATE VIEW IF NOT EXISTS active_conversation_contexts AS
SELECT
  cc.conversation_id,
  cc.topics,
  cc.key_decisions,
  cc.unresolved_questions,
  cc.message_count,
  cc.turn_count,
  cc.updated_at
FROM conversation_context cc
WHERE cc.updated_at >= (strftime('%s', 'now') * 1000 - 7 * 24 * 60 * 60 * 1000)
ORDER BY cc.updated_at DESC;

-- Knowledge connections view
CREATE VIEW IF NOT EXISTS knowledge_connections AS
SELECT
  kge.source_id,
  sk1.content as source_content,
  sk1.knowledge_type as source_type,
  kge.edge_type,
  kge.target_id,
  sk2.content as target_content,
  sk2.knowledge_type as target_type,
  kge.weight
FROM knowledge_graph_edges kge
JOIN session_knowledge sk1 ON kge.source_id = sk1.id
JOIN session_knowledge sk2 ON kge.target_id = sk2.id
ORDER BY kge.weight DESC;

-- =============================================================================
-- Migration Complete
-- =============================================================================
