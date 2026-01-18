-- =============================================================================
-- Behavior Tracking System Tables
-- =============================================================================
-- Version: 1.0.0
-- Created: 2026-01-18
-- Description: Tables for automatic behavior learning, pattern detection,
--              and smart recommendations based on user interactions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Behavior Events Table
-- -----------------------------------------------------------------------------
-- Records all user behavior events for pattern analysis
CREATE TABLE IF NOT EXISTS behavior_events (
  id TEXT PRIMARY KEY,                      -- Unique event ID (UUID)
  event_type TEXT NOT NULL,                 -- 'page_visit', 'feature_use', 'llm_interaction', 'error', 'search'
  event_name TEXT NOT NULL,                 -- Specific event name (e.g., 'knowledge_base_create')
  event_data TEXT,                          -- JSON additional event data
  session_id TEXT,                          -- Browser/app session ID
  context TEXT,                             -- JSON context data (page, previous actions, etc.)
  duration_ms INTEGER,                      -- Event duration in milliseconds
  success INTEGER DEFAULT 1,                -- Whether action succeeded
  created_at INTEGER NOT NULL               -- Event timestamp
);

-- Index for event type queries
CREATE INDEX IF NOT EXISTS idx_behavior_events_type
  ON behavior_events(event_type, created_at DESC);

-- Index for event name queries
CREATE INDEX IF NOT EXISTS idx_behavior_events_name
  ON behavior_events(event_name, created_at DESC);

-- Index for session queries
CREATE INDEX IF NOT EXISTS idx_behavior_events_session
  ON behavior_events(session_id, created_at DESC);

-- Index for time-based analysis
CREATE INDEX IF NOT EXISTS idx_behavior_events_created
  ON behavior_events(created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Behavior Patterns Table
-- -----------------------------------------------------------------------------
-- Stores detected behavior patterns
CREATE TABLE IF NOT EXISTS behavior_patterns (
  id TEXT PRIMARY KEY,                      -- Unique pattern ID (UUID)
  pattern_type TEXT NOT NULL,               -- 'sequence', 'time_preference', 'feature_combo', 'navigation'
  pattern_name TEXT,                        -- Human-readable pattern name
  pattern_data TEXT NOT NULL,               -- JSON pattern definition
  confidence REAL DEFAULT 0.5,              -- Confidence score (0-1)
  occurrence_count INTEGER DEFAULT 1,       -- Number of times pattern observed
  last_occurrence_at INTEGER,               -- Last time pattern was observed
  is_active INTEGER DEFAULT 1,              -- Whether pattern is active
  is_confirmed INTEGER DEFAULT 0,           -- Whether user confirmed pattern
  metadata TEXT,                            -- JSON additional metadata
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for pattern type
CREATE INDEX IF NOT EXISTS idx_behavior_patterns_type
  ON behavior_patterns(pattern_type, confidence DESC);

-- Index for active patterns
CREATE INDEX IF NOT EXISTS idx_behavior_patterns_active
  ON behavior_patterns(is_active, confidence DESC);

-- Index for pattern occurrences
CREATE INDEX IF NOT EXISTS idx_behavior_patterns_occurrences
  ON behavior_patterns(occurrence_count DESC);

-- -----------------------------------------------------------------------------
-- 3. Smart Recommendations Table
-- -----------------------------------------------------------------------------
-- Stores AI-generated recommendations based on behavior
CREATE TABLE IF NOT EXISTS smart_recommendations (
  id TEXT PRIMARY KEY,                      -- Unique recommendation ID (UUID)
  recommendation_type TEXT NOT NULL,        -- 'feature', 'workflow', 'setting', 'optimization'
  target TEXT NOT NULL,                     -- Target of recommendation (feature name, setting key, etc.)
  title TEXT NOT NULL,                      -- Short title
  description TEXT,                         -- Detailed description
  reason TEXT,                              -- Why this is recommended (based on patterns)
  action_data TEXT,                         -- JSON data for executing the recommendation
  score REAL DEFAULT 0,                     -- Relevance score (0-1)
  priority TEXT DEFAULT 'medium',           -- 'low', 'medium', 'high'
  shown_count INTEGER DEFAULT 0,            -- Times recommendation was shown
  accepted_count INTEGER DEFAULT 0,         -- Times recommendation was accepted
  dismissed_count INTEGER DEFAULT 0,        -- Times recommendation was dismissed
  is_active INTEGER DEFAULT 1,              -- Whether recommendation is active
  expires_at INTEGER,                       -- Optional expiration timestamp
  source_pattern_id TEXT,                   -- Pattern that triggered this recommendation
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_pattern_id) REFERENCES behavior_patterns(id) ON DELETE SET NULL
);

-- Index for recommendation type
CREATE INDEX IF NOT EXISTS idx_smart_recommendations_type
  ON smart_recommendations(recommendation_type, score DESC);

-- Index for active recommendations
CREATE INDEX IF NOT EXISTS idx_smart_recommendations_active
  ON smart_recommendations(is_active, priority DESC, score DESC);

-- Index for target
CREATE INDEX IF NOT EXISTS idx_smart_recommendations_target
  ON smart_recommendations(target);

-- -----------------------------------------------------------------------------
-- 4. Time Preferences Table
-- -----------------------------------------------------------------------------
-- Tracks user time-based preferences
CREATE TABLE IF NOT EXISTS time_preferences (
  id TEXT PRIMARY KEY,                      -- Unique preference ID
  preference_type TEXT NOT NULL,            -- 'active_hours', 'feature_timing', 'session_length'
  day_of_week INTEGER,                      -- 0-6 (Sunday-Saturday), NULL for all days
  hour INTEGER,                             -- 0-23, NULL for all hours
  feature TEXT,                             -- Feature name, NULL for general
  event_count INTEGER DEFAULT 0,            -- Number of events in this time slot
  avg_duration_ms REAL,                     -- Average duration of events
  success_rate REAL,                        -- Success rate in this time slot
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(preference_type, day_of_week, hour, feature)
);

-- Index for time queries
CREATE INDEX IF NOT EXISTS idx_time_preferences_time
  ON time_preferences(day_of_week, hour);

-- Index for feature queries
CREATE INDEX IF NOT EXISTS idx_time_preferences_feature
  ON time_preferences(feature);

-- -----------------------------------------------------------------------------
-- 5. Feature Sequences Table
-- -----------------------------------------------------------------------------
-- Tracks common feature usage sequences
CREATE TABLE IF NOT EXISTS feature_sequences (
  id TEXT PRIMARY KEY,                      -- Unique sequence ID
  sequence TEXT NOT NULL,                   -- JSON array of feature names in order
  sequence_length INTEGER NOT NULL,         -- Number of features in sequence
  occurrence_count INTEGER DEFAULT 1,       -- Times this sequence was observed
  avg_interval_ms REAL,                     -- Average time between steps
  completion_rate REAL,                     -- Rate at which sequence is completed
  last_seen_at INTEGER,                     -- Last observation timestamp
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(sequence)
);

-- Index for sequence length
CREATE INDEX IF NOT EXISTS idx_feature_sequences_length
  ON feature_sequences(sequence_length, occurrence_count DESC);

-- Index for occurrence count
CREATE INDEX IF NOT EXISTS idx_feature_sequences_count
  ON feature_sequences(occurrence_count DESC);

-- =============================================================================
-- Views for Behavior Analysis
-- =============================================================================

-- Hourly activity distribution view
CREATE VIEW IF NOT EXISTS hourly_activity_distribution AS
SELECT
  strftime('%H', created_at / 1000, 'unixepoch') as hour,
  event_type,
  COUNT(*) as event_count,
  AVG(duration_ms) as avg_duration,
  SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
FROM behavior_events
WHERE created_at >= (strftime('%s', 'now') * 1000 - 30 * 24 * 60 * 60 * 1000)
GROUP BY hour, event_type
ORDER BY hour, event_count DESC;

-- Feature usage ranking view
CREATE VIEW IF NOT EXISTS feature_usage_ranking AS
SELECT
  event_name,
  COUNT(*) as usage_count,
  AVG(duration_ms) as avg_duration,
  SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
  MAX(created_at) as last_used_at
FROM behavior_events
WHERE event_type = 'feature_use'
  AND created_at >= (strftime('%s', 'now') * 1000 - 30 * 24 * 60 * 60 * 1000)
GROUP BY event_name
ORDER BY usage_count DESC
LIMIT 20;

-- Top patterns view
CREATE VIEW IF NOT EXISTS top_behavior_patterns AS
SELECT
  id,
  pattern_type,
  pattern_name,
  confidence,
  occurrence_count,
  is_confirmed,
  last_occurrence_at
FROM behavior_patterns
WHERE is_active = 1 AND confidence >= 0.5
ORDER BY confidence DESC, occurrence_count DESC
LIMIT 20;

-- Pending recommendations view
CREATE VIEW IF NOT EXISTS pending_recommendations AS
SELECT
  id,
  recommendation_type,
  target,
  title,
  description,
  score,
  priority,
  shown_count,
  accepted_count
FROM smart_recommendations
WHERE is_active = 1
  AND (expires_at IS NULL OR expires_at > (strftime('%s', 'now') * 1000))
ORDER BY priority DESC, score DESC;

-- Day of week activity view
CREATE VIEW IF NOT EXISTS day_of_week_activity AS
SELECT
  CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER) as day_of_week,
  COUNT(*) as event_count,
  COUNT(DISTINCT date(created_at / 1000, 'unixepoch')) as active_days,
  AVG(duration_ms) as avg_duration
FROM behavior_events
WHERE created_at >= (strftime('%s', 'now') * 1000 - 30 * 24 * 60 * 60 * 1000)
GROUP BY day_of_week
ORDER BY day_of_week;

-- =============================================================================
-- Migration Complete
-- =============================================================================
