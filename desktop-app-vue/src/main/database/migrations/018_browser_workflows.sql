-- Browser Automation Phase 4-5 Tables Migration
-- v0.30.0: Browser workflow system, recording, and diagnostics

-- ==================== Phase 4: Workflow System ====================

-- Browser Workflows - Saved automation workflows
CREATE TABLE IF NOT EXISTS browser_workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    steps TEXT NOT NULL,              -- JSON array of workflow steps
    variables TEXT DEFAULT '{}',       -- JSON object of default variables
    triggers TEXT DEFAULT '[]',        -- JSON array of trigger configurations
    tags TEXT DEFAULT '[]',            -- JSON array of tags
    is_template INTEGER DEFAULT 0,     -- Whether this is a template
    is_enabled INTEGER DEFAULT 1,      -- Whether workflow is enabled
    usage_count INTEGER DEFAULT 0,     -- Execution count
    success_count INTEGER DEFAULT 0,   -- Successful execution count
    last_executed_at INTEGER,          -- Last execution timestamp
    avg_duration INTEGER,              -- Average execution duration (ms)
    created_by TEXT,                   -- Creator user/agent ID
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Workflow Executions - Execution history and logs
CREATE TABLE IF NOT EXISTS browser_workflow_executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_name TEXT,                -- Denormalized for history
    target_id TEXT,                    -- Browser tab ID
    status TEXT NOT NULL DEFAULT 'pending',  -- pending/running/paused/completed/failed/cancelled
    variables_snapshot TEXT,           -- JSON of variables at start
    results TEXT DEFAULT '[]',         -- JSON array of step results
    current_step INTEGER DEFAULT 0,    -- Current step index
    total_steps INTEGER DEFAULT 0,     -- Total number of steps
    error_message TEXT,                -- Error message if failed
    error_step INTEGER,                -- Step where error occurred
    retry_count INTEGER DEFAULT 0,     -- Number of retries
    started_at INTEGER NOT NULL,
    paused_at INTEGER,
    completed_at INTEGER,
    duration INTEGER,                  -- Total duration (ms)
    FOREIGN KEY (workflow_id) REFERENCES browser_workflows(id) ON DELETE SET NULL
);

-- Workflow Steps (Optional - for complex step management)
CREATE TABLE IF NOT EXISTS browser_workflow_steps (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step_type TEXT NOT NULL,           -- action/condition/loop/variable/wait/subprocess
    action TEXT,                       -- Action type for action steps
    config TEXT NOT NULL,              -- JSON configuration
    description TEXT,
    is_critical INTEGER DEFAULT 1,     -- Stop on failure?
    timeout INTEGER DEFAULT 30000,     -- Step timeout (ms)
    retry_config TEXT,                 -- JSON retry configuration
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES browser_workflows(id) ON DELETE CASCADE
);

-- ==================== Phase 5: Recording System ====================

-- Browser Recordings - Recorded user actions
CREATE TABLE IF NOT EXISTS browser_recordings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,                 -- Starting URL
    events TEXT NOT NULL,              -- JSON array of recorded events
    screenshots TEXT DEFAULT '[]',     -- JSON array of screenshot references
    duration INTEGER,                  -- Recording duration (ms)
    event_count INTEGER DEFAULT 0,     -- Number of events
    tags TEXT DEFAULT '[]',            -- JSON array of tags
    workflow_id TEXT,                  -- Converted workflow ID (if any)
    recording_options TEXT,            -- JSON of recording options used
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES browser_workflows(id) ON DELETE SET NULL
);

-- Screenshot Baselines - Visual regression baselines
CREATE TABLE IF NOT EXISTS browser_baselines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    target_url TEXT,                   -- Page URL for this baseline
    element_ref TEXT,                  -- Element reference (if element-specific)
    screenshot BLOB NOT NULL,          -- Binary screenshot data
    thumbnail BLOB,                    -- Thumbnail for preview
    width INTEGER,                     -- Screenshot width
    height INTEGER,                    -- Screenshot height
    hash TEXT,                         -- Content hash for quick comparison
    workflow_id TEXT,                  -- Associated workflow (if any)
    tags TEXT DEFAULT '[]',            -- JSON array of tags
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES browser_workflows(id) ON DELETE SET NULL
);

-- Screenshot Comparisons - Diff results
CREATE TABLE IF NOT EXISTS browser_screenshot_diffs (
    id TEXT PRIMARY KEY,
    baseline_id TEXT NOT NULL,
    execution_id TEXT,                 -- Associated workflow execution
    screenshot BLOB NOT NULL,          -- New screenshot
    diff_image BLOB,                   -- Visual diff image
    match_percentage REAL,             -- 0-100 similarity score
    diff_pixels INTEGER,               -- Number of different pixels
    status TEXT NOT NULL,              -- passed/failed/warning
    threshold REAL DEFAULT 0.95,       -- Pass threshold used
    created_at INTEGER NOT NULL,
    FOREIGN KEY (baseline_id) REFERENCES browser_baselines(id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES browser_workflow_executions(id) ON DELETE SET NULL
);

-- ==================== Phase 5: Diagnostics ====================

-- OCR Results - Text recognition results
CREATE TABLE IF NOT EXISTS browser_ocr_results (
    id TEXT PRIMARY KEY,
    target_id TEXT,                    -- Browser tab ID
    execution_id TEXT,                 -- Associated workflow execution
    screenshot BLOB,                   -- Source screenshot
    text TEXT NOT NULL,                -- Recognized text
    confidence REAL,                   -- Overall confidence (0-1)
    language TEXT DEFAULT 'eng',       -- Detected/specified language
    regions TEXT,                      -- JSON array of text regions with bounds
    processing_time INTEGER,           -- Processing time (ms)
    created_at INTEGER NOT NULL,
    FOREIGN KEY (execution_id) REFERENCES browser_workflow_executions(id) ON DELETE SET NULL
);

-- Diagnostic Reports - Smart diagnosis results
CREATE TABLE IF NOT EXISTS browser_diagnostic_reports (
    id TEXT PRIMARY KEY,
    execution_id TEXT,                 -- Associated workflow execution
    workflow_id TEXT,                  -- Associated workflow
    report_type TEXT NOT NULL,         -- failure_analysis/performance/accessibility
    summary TEXT,                      -- Brief summary
    details TEXT NOT NULL,             -- JSON detailed report
    recommendations TEXT,              -- JSON array of recommendations
    severity TEXT DEFAULT 'info',      -- info/warning/error/critical
    ai_analysis TEXT,                  -- AI-generated analysis (if any)
    created_at INTEGER NOT NULL,
    FOREIGN KEY (execution_id) REFERENCES browser_workflow_executions(id) ON DELETE SET NULL,
    FOREIGN KEY (workflow_id) REFERENCES browser_workflows(id) ON DELETE SET NULL
);

-- ==================== Indexes ====================

-- Workflows
CREATE INDEX IF NOT EXISTS idx_browser_workflows_name ON browser_workflows(name);
CREATE INDEX IF NOT EXISTS idx_browser_workflows_tags ON browser_workflows(tags);
CREATE INDEX IF NOT EXISTS idx_browser_workflows_template ON browser_workflows(is_template);
CREATE INDEX IF NOT EXISTS idx_browser_workflows_enabled ON browser_workflows(is_enabled);
CREATE INDEX IF NOT EXISTS idx_browser_workflows_updated ON browser_workflows(updated_at DESC);

-- Executions
CREATE INDEX IF NOT EXISTS idx_browser_executions_workflow ON browser_workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_browser_executions_status ON browser_workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_browser_executions_started ON browser_workflow_executions(started_at DESC);

-- Steps
CREATE INDEX IF NOT EXISTS idx_browser_steps_workflow ON browser_workflow_steps(workflow_id, step_index);

-- Recordings
CREATE INDEX IF NOT EXISTS idx_browser_recordings_name ON browser_recordings(name);
CREATE INDEX IF NOT EXISTS idx_browser_recordings_url ON browser_recordings(url);
CREATE INDEX IF NOT EXISTS idx_browser_recordings_created ON browser_recordings(created_at DESC);

-- Baselines
CREATE INDEX IF NOT EXISTS idx_browser_baselines_name ON browser_baselines(name);
CREATE INDEX IF NOT EXISTS idx_browser_baselines_url ON browser_baselines(target_url);
CREATE INDEX IF NOT EXISTS idx_browser_baselines_workflow ON browser_baselines(workflow_id);

-- Diffs
CREATE INDEX IF NOT EXISTS idx_browser_diffs_baseline ON browser_screenshot_diffs(baseline_id);
CREATE INDEX IF NOT EXISTS idx_browser_diffs_execution ON browser_screenshot_diffs(execution_id);
CREATE INDEX IF NOT EXISTS idx_browser_diffs_status ON browser_screenshot_diffs(status);

-- OCR
CREATE INDEX IF NOT EXISTS idx_browser_ocr_execution ON browser_ocr_results(execution_id);
CREATE INDEX IF NOT EXISTS idx_browser_ocr_created ON browser_ocr_results(created_at DESC);

-- Diagnostics
CREATE INDEX IF NOT EXISTS idx_browser_diagnostics_execution ON browser_diagnostic_reports(execution_id);
CREATE INDEX IF NOT EXISTS idx_browser_diagnostics_workflow ON browser_diagnostic_reports(workflow_id);
CREATE INDEX IF NOT EXISTS idx_browser_diagnostics_type ON browser_diagnostic_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_browser_diagnostics_severity ON browser_diagnostic_reports(severity);
