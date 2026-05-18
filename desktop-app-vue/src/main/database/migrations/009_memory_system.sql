-- =============================================================================
-- Memory Bank System Tables
-- =============================================================================
-- Version: 1.0.0
-- Created: 2026-01-17
-- Description: Tables for user preferences, usage history, search history,
--              prompt patterns, error fix patterns, code snippets, and
--              workflow patterns.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. User Preferences Table
-- -----------------------------------------------------------------------------
-- Stores all user preferences organized by category and key
CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,                      -- Unique ID (UUID)
  category TEXT NOT NULL,                   -- Category: ui, feature, search, llm, etc.
  key TEXT NOT NULL,                        -- Preference key within category
  value TEXT NOT NULL,                      -- JSON encoded value
  value_type TEXT DEFAULT 'string',         -- Type hint: string, number, boolean, array, object
  description TEXT,                          -- Optional description of the preference
  created_at INTEGER NOT NULL,              -- Creation timestamp
  updated_at INTEGER NOT NULL,              -- Last update timestamp
  UNIQUE(category, key)
);

-- Index for fast category lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_category
  ON user_preferences(category);

-- Index for updated_at for recent changes
CREATE INDEX IF NOT EXISTS idx_user_preferences_updated
  ON user_preferences(updated_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Usage History Table
-- -----------------------------------------------------------------------------
-- Records feature usage for learning user patterns
CREATE TABLE IF NOT EXISTS usage_history (
  id TEXT PRIMARY KEY,                      -- Unique ID (UUID)
  feature TEXT NOT NULL,                    -- Feature name (e.g., 'knowledge-base', 'ai-chat')
  action TEXT,                               -- Action performed (e.g., 'create', 'edit', 'search')
  metadata TEXT,                             -- JSON encoded additional data
  duration_ms INTEGER,                       -- Duration of the action in milliseconds
  success INTEGER DEFAULT 1,                 -- Whether the action succeeded (0=no, 1=yes)
  created_at INTEGER NOT NULL               -- Timestamp when action occurred
);

-- Index for feature filtering
CREATE INDEX IF NOT EXISTS idx_usage_history_feature
  ON usage_history(feature);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_usage_history_created
  ON usage_history(created_at DESC);

-- Composite index for feature + time queries
CREATE INDEX IF NOT EXISTS idx_usage_history_feature_time
  ON usage_history(feature, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Search History Table
-- -----------------------------------------------------------------------------
-- Records search queries and results for improving search suggestions
CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY,                      -- Unique ID (UUID)
  query TEXT NOT NULL,                      -- The search query
  context TEXT,                              -- Search context (e.g., 'knowledge-base', 'global')
  result_count INTEGER DEFAULT 0,           -- Number of results returned
  selected_result TEXT,                      -- ID or title of selected result (if any)
  selected_position INTEGER,                 -- Position of selected result in list
  created_at INTEGER NOT NULL               -- Timestamp of the search
);

-- Index for query suggestions (prefix matching)
CREATE INDEX IF NOT EXISTS idx_search_history_query
  ON search_history(query);

-- Index for context-specific history
CREATE INDEX IF NOT EXISTS idx_search_history_context
  ON search_history(context);

-- Index for recent searches
CREATE INDEX IF NOT EXISTS idx_search_history_created
  ON search_history(created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Prompt Patterns Table
-- -----------------------------------------------------------------------------
-- Stores successful prompt templates for reuse
CREATE TABLE IF NOT EXISTS prompt_patterns (
  id TEXT PRIMARY KEY,                      -- Unique ID (UUID)
  template TEXT NOT NULL,                   -- The prompt template (may contain placeholders)
  category TEXT,                             -- Category: coding, writing, analysis, etc.
  tags TEXT,                                 -- JSON array of tags
  use_count INTEGER DEFAULT 0,              -- Number of times this pattern was used
  success_count INTEGER DEFAULT 0,          -- Number of successful outcomes
  preferred_model TEXT,                      -- Which LLM model works best with this prompt
  avg_response_quality REAL,                -- Average quality score (0-1)
  example_input TEXT,                        -- Example input that works well
  example_output TEXT,                       -- Example of good output
  metadata TEXT,                             -- Additional JSON metadata
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_prompt_patterns_category
  ON prompt_patterns(category);

-- Index for most used patterns
CREATE INDEX IF NOT EXISTS idx_prompt_patterns_use_count
  ON prompt_patterns(use_count DESC);

-- Index for recently used
CREATE INDEX IF NOT EXISTS idx_prompt_patterns_last_used
  ON prompt_patterns(last_used_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Error Fix Patterns Table
-- -----------------------------------------------------------------------------
-- Stores learned error-fix associations (integrates with ErrorMonitor)
CREATE TABLE IF NOT EXISTS error_fix_patterns (
  id TEXT PRIMARY KEY,                      -- Unique ID (UUID)
  error_pattern TEXT NOT NULL,              -- Regex or substring pattern to match errors
  error_classification TEXT,                -- Classification: DATABASE, NETWORK, etc.
  error_message_sample TEXT,                 -- Sample error message
  fix_strategy TEXT NOT NULL,               -- Strategy: retry, timeout_increase, fallback, etc.
  fix_steps TEXT,                            -- JSON array of fix steps
  fix_code TEXT,                             -- Code snippet that fixes the error
  success_count INTEGER DEFAULT 0,          -- Times this fix succeeded
  failure_count INTEGER DEFAULT 0,          -- Times this fix failed
  confidence REAL,                           -- Confidence score (0-1)
  auto_apply INTEGER DEFAULT 0,             -- Auto-apply this fix (0=no, 1=yes)
  source TEXT,                               -- Source: user, ai, system
  metadata TEXT,                             -- Additional JSON metadata
  created_at INTEGER NOT NULL,
  last_applied_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Index for error classification
CREATE INDEX IF NOT EXISTS idx_error_fix_patterns_classification
  ON error_fix_patterns(error_classification);

-- Index for most successful patterns
CREATE INDEX IF NOT EXISTS idx_error_fix_patterns_success
  ON error_fix_patterns(success_count DESC);

-- Index for auto-apply patterns
CREATE INDEX IF NOT EXISTS idx_error_fix_patterns_auto
  ON error_fix_patterns(auto_apply);

-- -----------------------------------------------------------------------------
-- 6. Code Snippets Table
-- -----------------------------------------------------------------------------
-- Stores reusable code snippets collected from usage
CREATE TABLE IF NOT EXISTS code_snippets (
  id TEXT PRIMARY KEY,                      -- Unique ID (UUID)
  title TEXT NOT NULL,                      -- Snippet title
  description TEXT,                          -- Description of what it does
  language TEXT NOT NULL,                   -- Programming language
  code TEXT NOT NULL,                       -- The code snippet
  tags TEXT,                                 -- JSON array of tags
  use_count INTEGER DEFAULT 0,              -- Number of times used
  source TEXT,                               -- Source: manual, ai-generated, imported
  source_url TEXT,                           -- Source URL if imported
  is_favorite INTEGER DEFAULT 0,            -- Marked as favorite (0=no, 1=yes)
  metadata TEXT,                             -- Additional JSON metadata
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Index for language filtering
CREATE INDEX IF NOT EXISTS idx_code_snippets_language
  ON code_snippets(language);

-- Index for favorite snippets
CREATE INDEX IF NOT EXISTS idx_code_snippets_favorite
  ON code_snippets(is_favorite DESC, use_count DESC);

-- Full-text index for title and description
-- CREATE VIRTUAL TABLE IF NOT EXISTS code_snippets_fts USING fts5(
--   title, description, tags,
--   content=code_snippets
-- );

-- -----------------------------------------------------------------------------
-- 7. Workflow Patterns Table
-- -----------------------------------------------------------------------------
-- Records common user workflows for suggestions
CREATE TABLE IF NOT EXISTS workflow_patterns (
  id TEXT PRIMARY KEY,                      -- Unique ID (UUID)
  name TEXT NOT NULL,                       -- Workflow name
  description TEXT,                          -- Description of the workflow
  steps TEXT NOT NULL,                      -- JSON array of workflow steps
  trigger_context TEXT,                      -- When to suggest this workflow (JSON)
  use_count INTEGER DEFAULT 0,              -- Number of times used
  completion_rate REAL,                      -- How often users complete it (0-1)
  avg_duration_ms INTEGER,                   -- Average duration to complete
  category TEXT,                             -- Category: development, writing, etc.
  metadata TEXT,                             -- Additional JSON metadata
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_workflow_patterns_category
  ON workflow_patterns(category);

-- Index for most used workflows
CREATE INDEX IF NOT EXISTS idx_workflow_patterns_use_count
  ON workflow_patterns(use_count DESC);

-- =============================================================================
-- Views for Statistics and Analytics
-- =============================================================================

-- Preference statistics by category
CREATE VIEW IF NOT EXISTS preference_stats_by_category AS
SELECT
  category,
  COUNT(*) as preference_count,
  MAX(updated_at) as last_updated
FROM user_preferences
GROUP BY category
ORDER BY preference_count DESC;

-- Usage statistics by feature (last 7 days)
CREATE VIEW IF NOT EXISTS usage_stats_recent AS
SELECT
  feature,
  action,
  COUNT(*) as action_count,
  AVG(duration_ms) as avg_duration_ms,
  SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
FROM usage_history
WHERE created_at > (strftime('%s', 'now') * 1000 - 7 * 24 * 60 * 60 * 1000)
GROUP BY feature, action
ORDER BY action_count DESC;

-- Popular search queries
CREATE VIEW IF NOT EXISTS popular_searches AS
SELECT
  query,
  context,
  COUNT(*) as search_count,
  AVG(result_count) as avg_results,
  MAX(created_at) as last_searched
FROM search_history
GROUP BY query, context
ORDER BY search_count DESC
LIMIT 50;

-- Top prompt patterns by success rate
CREATE VIEW IF NOT EXISTS top_prompt_patterns AS
SELECT
  id,
  template,
  category,
  use_count,
  success_count,
  CASE WHEN use_count > 0
    THEN success_count * 100.0 / use_count
    ELSE 0
  END as success_rate,
  preferred_model
FROM prompt_patterns
WHERE use_count >= 3
ORDER BY success_rate DESC, use_count DESC
LIMIT 20;

-- =============================================================================
-- Migration Complete
-- =============================================================================
