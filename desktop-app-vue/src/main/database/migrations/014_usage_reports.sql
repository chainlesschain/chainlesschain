-- =============================================================================
-- Usage Reports System Tables
-- =============================================================================
-- Version: 1.0.0
-- Created: 2026-01-18
-- Description: Tables for usage analytics and report generation including
--              weekly/monthly reports, cost analysis, and report subscriptions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Usage Reports Table
-- -----------------------------------------------------------------------------
-- Stores generated usage reports
CREATE TABLE IF NOT EXISTS usage_reports (
  id TEXT PRIMARY KEY,                      -- Unique report ID (UUID)
  report_type TEXT NOT NULL,                -- 'weekly', 'monthly', 'custom'
  report_scope TEXT NOT NULL,               -- 'llm', 'features', 'full'
  period_start INTEGER NOT NULL,            -- Period start timestamp
  period_end INTEGER NOT NULL,              -- Period end timestamp
  summary TEXT NOT NULL,                    -- JSON summary data
  details TEXT,                             -- JSON detailed breakdown
  recommendations TEXT,                     -- JSON AI-generated recommendations
  file_path TEXT,                           -- Path to exported file (if any)
  format TEXT DEFAULT 'markdown',           -- 'markdown', 'json', 'csv', 'html'
  generation_time_ms INTEGER,               -- Time taken to generate
  generated_at INTEGER NOT NULL,            -- Generation timestamp
  created_at INTEGER NOT NULL
);

-- Index for report type and period
CREATE INDEX IF NOT EXISTS idx_usage_reports_type_period
  ON usage_reports(report_type, period_start DESC);

-- Index for recent reports
CREATE INDEX IF NOT EXISTS idx_usage_reports_created
  ON usage_reports(created_at DESC);

-- Index for report scope
CREATE INDEX IF NOT EXISTS idx_usage_reports_scope
  ON usage_reports(report_scope);

-- -----------------------------------------------------------------------------
-- 2. Report Subscriptions Table
-- -----------------------------------------------------------------------------
-- Manages automatic report generation subscriptions
CREATE TABLE IF NOT EXISTS report_subscriptions (
  id TEXT PRIMARY KEY,                      -- Unique subscription ID (UUID)
  subscription_name TEXT NOT NULL,          -- Human-readable name
  report_type TEXT NOT NULL,                -- 'weekly', 'monthly'
  report_scope TEXT DEFAULT 'full',         -- 'llm', 'features', 'full'
  frequency TEXT NOT NULL,                  -- 'weekly', 'monthly'
  day_of_week INTEGER DEFAULT 1,            -- Day for weekly (0=Sunday, 1=Monday)
  day_of_month INTEGER DEFAULT 1,           -- Day for monthly (1-31)
  hour INTEGER DEFAULT 9,                   -- Hour to generate (0-23)
  export_format TEXT DEFAULT 'markdown',    -- Default export format
  auto_export INTEGER DEFAULT 1,            -- Automatically export to file
  export_directory TEXT,                    -- Directory for exported files
  is_enabled INTEGER DEFAULT 1,             -- Whether subscription is active
  last_generated_at INTEGER,                -- Last generation timestamp
  last_report_id TEXT,                      -- Last generated report ID
  next_generation_at INTEGER,               -- Next scheduled generation
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (last_report_id) REFERENCES usage_reports(id) ON DELETE SET NULL
);

-- Index for enabled subscriptions
CREATE INDEX IF NOT EXISTS idx_report_subscriptions_enabled
  ON report_subscriptions(is_enabled, next_generation_at);

-- -----------------------------------------------------------------------------
-- 3. Cost Analysis Cache Table
-- -----------------------------------------------------------------------------
-- Caches aggregated cost data for faster report generation
CREATE TABLE IF NOT EXISTS cost_analysis_cache (
  id TEXT PRIMARY KEY,                      -- Unique cache ID
  period_type TEXT NOT NULL,                -- 'daily', 'weekly', 'monthly'
  period_key TEXT NOT NULL,                 -- Period identifier (e.g., '2026-01-18', '2026-W03')
  provider TEXT NOT NULL,                   -- LLM provider name
  model TEXT,                               -- Model name (optional for provider totals)
  total_calls INTEGER DEFAULT 0,            -- Total API calls
  total_input_tokens INTEGER DEFAULT 0,     -- Total input tokens
  total_output_tokens INTEGER DEFAULT 0,    -- Total output tokens
  total_tokens INTEGER DEFAULT 0,           -- Total tokens
  total_cost_usd REAL DEFAULT 0,            -- Total cost in USD
  total_cost_cny REAL DEFAULT 0,            -- Total cost in CNY
  cached_calls INTEGER DEFAULT 0,           -- Calls using cached responses
  compressed_calls INTEGER DEFAULT 0,       -- Calls using prompt compression
  avg_response_time REAL,                   -- Average response time (ms)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(period_type, period_key, provider, model)
);

-- Index for period queries
CREATE INDEX IF NOT EXISTS idx_cost_analysis_cache_period
  ON cost_analysis_cache(period_type, period_key);

-- Index for provider queries
CREATE INDEX IF NOT EXISTS idx_cost_analysis_cache_provider
  ON cost_analysis_cache(provider);

-- -----------------------------------------------------------------------------
-- 4. Feature Usage Summary Table
-- -----------------------------------------------------------------------------
-- Aggregated feature usage statistics
CREATE TABLE IF NOT EXISTS feature_usage_summary (
  id TEXT PRIMARY KEY,                      -- Unique summary ID
  period_type TEXT NOT NULL,                -- 'daily', 'weekly', 'monthly'
  period_key TEXT NOT NULL,                 -- Period identifier
  feature TEXT NOT NULL,                    -- Feature name
  action TEXT,                              -- Action type (optional)
  usage_count INTEGER DEFAULT 0,            -- Number of times used
  unique_sessions INTEGER DEFAULT 0,        -- Unique sessions
  total_duration_ms INTEGER DEFAULT 0,      -- Total duration
  success_count INTEGER DEFAULT 0,          -- Successful operations
  error_count INTEGER DEFAULT 0,            -- Failed operations
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(period_type, period_key, feature, action)
);

-- Index for feature queries
CREATE INDEX IF NOT EXISTS idx_feature_usage_summary_feature
  ON feature_usage_summary(feature, period_type, period_key);

-- =============================================================================
-- Views for Report Generation
-- =============================================================================

-- Daily LLM cost summary view
CREATE VIEW IF NOT EXISTS daily_llm_cost_summary AS
SELECT
  date(created_at / 1000, 'unixepoch') as date,
  provider,
  model,
  COUNT(*) as calls,
  SUM(input_tokens) as input_tokens,
  SUM(output_tokens) as output_tokens,
  SUM(total_tokens) as total_tokens,
  SUM(cost_usd) as cost_usd,
  SUM(cost_cny) as cost_cny,
  SUM(CASE WHEN was_cached = 1 THEN 1 ELSE 0 END) as cached_calls,
  AVG(response_time) as avg_response_time
FROM llm_usage_log
GROUP BY date, provider, model
ORDER BY date DESC, cost_usd DESC;

-- Weekly report summary view
CREATE VIEW IF NOT EXISTS weekly_report_summary AS
SELECT
  strftime('%Y-W%W', created_at / 1000, 'unixepoch') as week,
  COUNT(*) as total_calls,
  SUM(total_tokens) as total_tokens,
  SUM(cost_usd) as total_cost_usd,
  SUM(cost_cny) as total_cost_cny,
  COUNT(DISTINCT provider) as unique_providers,
  COUNT(DISTINCT model) as unique_models,
  SUM(CASE WHEN was_cached = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as cache_hit_rate
FROM llm_usage_log
GROUP BY week
ORDER BY week DESC;

-- Provider cost ranking view
CREATE VIEW IF NOT EXISTS provider_cost_ranking AS
SELECT
  provider,
  COUNT(*) as total_calls,
  SUM(total_tokens) as total_tokens,
  SUM(cost_usd) as total_cost_usd,
  ROUND(SUM(cost_usd) * 100.0 / (SELECT SUM(cost_usd) FROM llm_usage_log), 2) as cost_percentage
FROM llm_usage_log
WHERE created_at >= (strftime('%s', 'now') * 1000 - 30 * 24 * 60 * 60 * 1000)
GROUP BY provider
ORDER BY total_cost_usd DESC;

-- Model cost ranking view (top 10)
CREATE VIEW IF NOT EXISTS model_cost_ranking AS
SELECT
  provider,
  model,
  COUNT(*) as total_calls,
  SUM(total_tokens) as total_tokens,
  SUM(cost_usd) as total_cost_usd,
  AVG(cost_usd) as avg_cost_per_call
FROM llm_usage_log
WHERE created_at >= (strftime('%s', 'now') * 1000 - 30 * 24 * 60 * 60 * 1000)
GROUP BY provider, model
ORDER BY total_cost_usd DESC
LIMIT 10;

-- Recent reports view
CREATE VIEW IF NOT EXISTS recent_usage_reports AS
SELECT
  id,
  report_type,
  report_scope,
  period_start,
  period_end,
  format,
  file_path,
  generation_time_ms,
  generated_at
FROM usage_reports
ORDER BY generated_at DESC
LIMIT 20;

-- =============================================================================
-- Migration Complete
-- =============================================================================
