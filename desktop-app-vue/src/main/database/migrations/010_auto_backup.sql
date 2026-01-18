-- =============================================================================
-- Auto Backup System Tables
-- =============================================================================
-- Version: 1.0.0
-- Created: 2026-01-18
-- Description: Tables for automatic backup management including backup history,
--              schedules, and manifest tracking.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Backup History Table
-- -----------------------------------------------------------------------------
-- Records all backup operations with their status and metadata
CREATE TABLE IF NOT EXISTS backup_history (
  id TEXT PRIMARY KEY,                      -- Unique backup ID (UUID)
  backup_type TEXT NOT NULL,                -- 'full', 'incremental', 'scheduled'
  backup_scope TEXT NOT NULL,               -- 'patterns', 'preferences', 'sessions', 'all'
  file_path TEXT NOT NULL,                  -- Path to the backup file
  file_size INTEGER,                        -- File size in bytes
  items_backed_up INTEGER,                  -- Number of items in the backup
  items_changed INTEGER,                    -- Number of items changed (for incremental)
  checksum TEXT,                            -- SHA-256 checksum for integrity
  parent_backup_id TEXT,                    -- Parent backup ID (for incremental)
  status TEXT DEFAULT 'completed',          -- 'pending', 'in_progress', 'completed', 'failed'
  error_message TEXT,                       -- Error message if failed
  started_at INTEGER NOT NULL,              -- Backup start timestamp
  completed_at INTEGER,                     -- Backup completion timestamp
  created_at INTEGER NOT NULL,              -- Record creation timestamp
  FOREIGN KEY (parent_backup_id) REFERENCES backup_history(id) ON DELETE SET NULL
);

-- Index for type and scope filtering
CREATE INDEX IF NOT EXISTS idx_backup_history_type_scope
  ON backup_history(backup_type, backup_scope);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_backup_history_status
  ON backup_history(status);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_backup_history_created
  ON backup_history(created_at DESC);

-- Index for scope-specific queries
CREATE INDEX IF NOT EXISTS idx_backup_history_scope
  ON backup_history(backup_scope, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Backup Schedule Table
-- -----------------------------------------------------------------------------
-- Manages scheduled backup configurations
CREATE TABLE IF NOT EXISTS backup_schedule (
  id TEXT PRIMARY KEY,                      -- Unique schedule ID (UUID)
  schedule_name TEXT NOT NULL,              -- Human-readable name
  backup_scope TEXT NOT NULL,               -- 'patterns', 'preferences', 'sessions', 'all'
  backup_type TEXT DEFAULT 'full',          -- 'full' or 'incremental'
  frequency TEXT NOT NULL,                  -- 'hourly', 'daily', 'weekly', 'monthly'
  hour INTEGER DEFAULT 3,                   -- Hour of day (0-23) for daily/weekly/monthly
  minute INTEGER DEFAULT 0,                 -- Minute of hour (0-59)
  day_of_week INTEGER,                      -- Day of week (0-6, Sunday=0) for weekly
  day_of_month INTEGER,                     -- Day of month (1-31) for monthly
  retention_count INTEGER DEFAULT 10,       -- Number of backups to retain
  retention_days INTEGER DEFAULT 30,        -- Days to retain backups
  is_enabled INTEGER DEFAULT 1,             -- Whether schedule is active
  last_run_at INTEGER,                      -- Last execution timestamp
  next_run_at INTEGER,                      -- Next scheduled execution
  last_run_status TEXT,                     -- Status of last run
  last_run_backup_id TEXT,                  -- ID of last backup created
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (last_run_backup_id) REFERENCES backup_history(id) ON DELETE SET NULL
);

-- Index for enabled schedules
CREATE INDEX IF NOT EXISTS idx_backup_schedule_enabled
  ON backup_schedule(is_enabled, next_run_at);

-- Index for schedule frequency
CREATE INDEX IF NOT EXISTS idx_backup_schedule_frequency
  ON backup_schedule(frequency);

-- -----------------------------------------------------------------------------
-- 3. Backup Manifest Table
-- -----------------------------------------------------------------------------
-- Tracks individual items in backups for incremental backup support
CREATE TABLE IF NOT EXISTS backup_manifest (
  id TEXT PRIMARY KEY,                      -- Unique manifest entry ID
  backup_id TEXT NOT NULL,                  -- Associated backup ID
  item_type TEXT NOT NULL,                  -- 'prompt_pattern', 'code_snippet', 'preference', etc.
  item_id TEXT NOT NULL,                    -- Original item ID
  item_hash TEXT,                           -- Hash of item content for change detection
  item_version INTEGER DEFAULT 1,           -- Version number of the item
  created_at INTEGER NOT NULL,
  FOREIGN KEY (backup_id) REFERENCES backup_history(id) ON DELETE CASCADE
);

-- Index for backup-specific queries
CREATE INDEX IF NOT EXISTS idx_backup_manifest_backup_id
  ON backup_manifest(backup_id);

-- Index for item tracking
CREATE INDEX IF NOT EXISTS idx_backup_manifest_item
  ON backup_manifest(item_type, item_id);

-- Composite index for change detection
CREATE INDEX IF NOT EXISTS idx_backup_manifest_item_hash
  ON backup_manifest(item_type, item_id, item_hash);

-- -----------------------------------------------------------------------------
-- 4. Backup Settings Table
-- -----------------------------------------------------------------------------
-- Global backup settings
CREATE TABLE IF NOT EXISTS backup_settings (
  key TEXT PRIMARY KEY,                     -- Setting key
  value TEXT NOT NULL,                      -- Setting value (JSON)
  description TEXT,                         -- Setting description
  updated_at INTEGER NOT NULL
);

-- Insert default settings
INSERT OR IGNORE INTO backup_settings (key, value, description, updated_at)
VALUES
  ('backup_directory', '".chainlesschain/memory/backups"', 'Base directory for backups', strftime('%s', 'now') * 1000),
  ('max_backup_size_mb', '100', 'Maximum backup file size in MB', strftime('%s', 'now') * 1000),
  ('compression_enabled', 'true', 'Enable backup compression', strftime('%s', 'now') * 1000),
  ('encryption_enabled', 'false', 'Enable backup encryption', strftime('%s', 'now') * 1000),
  ('auto_cleanup_enabled', 'true', 'Enable automatic cleanup of old backups', strftime('%s', 'now') * 1000);

-- =============================================================================
-- Views for Backup Statistics
-- =============================================================================

-- Backup statistics by scope
CREATE VIEW IF NOT EXISTS backup_stats_by_scope AS
SELECT
  backup_scope,
  backup_type,
  COUNT(*) as backup_count,
  SUM(file_size) as total_size_bytes,
  SUM(items_backed_up) as total_items,
  MAX(created_at) as last_backup_at,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_count,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
FROM backup_history
GROUP BY backup_scope, backup_type
ORDER BY last_backup_at DESC;

-- Recent backups view
CREATE VIEW IF NOT EXISTS recent_backups AS
SELECT
  bh.id,
  bh.backup_type,
  bh.backup_scope,
  bh.file_path,
  bh.file_size,
  bh.items_backed_up,
  bh.status,
  bh.created_at,
  bh.completed_at,
  bs.schedule_name
FROM backup_history bh
LEFT JOIN backup_schedule bs ON bh.id = bs.last_run_backup_id
ORDER BY bh.created_at DESC
LIMIT 50;

-- Active schedules view
CREATE VIEW IF NOT EXISTS active_backup_schedules AS
SELECT
  id,
  schedule_name,
  backup_scope,
  backup_type,
  frequency,
  hour,
  minute,
  day_of_week,
  retention_count,
  last_run_at,
  next_run_at,
  last_run_status
FROM backup_schedule
WHERE is_enabled = 1
ORDER BY next_run_at;

-- =============================================================================
-- Migration Complete
-- =============================================================================
